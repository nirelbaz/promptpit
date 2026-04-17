import path from "node:path";
import { detectAdapters } from "../adapters/registry.js";
import { mergeAdapterConfigs, hasVersionPins, applyExcluded } from "../core/merger.js";
import { stripSecrets } from "../core/security.js";
import { LARGE_INSTRUCTION_THRESHOLD } from "../core/validate.js";
import { writeStack } from "../core/stack.js";
import { pickExclusions } from "../core/select.js";
import { stripAllMarkerBlocks } from "../shared/markers.js";
import { readFileOrNull, exists } from "../shared/utils.js";
import type { StackBundle } from "../shared/schema.js";
import { log, spinner, printDryRunReport } from "../shared/io.js";
import { requireInteractive } from "../shared/interactive.js";
import type { DryRunEntry } from "../adapters/types.js";
import type { DryRunSection } from "../shared/io.js";

async function detectProjectInfo(
  root: string,
): Promise<{ name: string; description?: string }> {
  const raw = await readFileOrNull(path.join(root, "package.json"));
  if (raw) {
    try {
      const pkg = JSON.parse(raw);
      return {
        name: pkg.name ?? path.basename(root),
        description: pkg.description,
      };
    } catch {
      // fall through
    }
  }
  return { name: path.basename(root) };
}

export interface CollectOptions {
  dryRun?: boolean;
  verbose?: boolean;
  includeExtends?: boolean;
  select?: boolean;
}

export async function collectStack(
  root: string,
  outputDir: string,
  opts: CollectOptions = {},
): Promise<void> {
  const spin = spinner("Detecting AI tools...");

  const detected = await detectAdapters(root);
  if (detected.length === 0) {
    spin.fail("No AI tool configs found");
    throw new Error(
      "Run 'pit init' to create a stack from scratch, or add a config file for one of:\n" +
        "  Claude Code    CLAUDE.md or .claude/\n" +
        "  Cursor         .cursorrules or .cursor/\n" +
        "  Codex CLI      AGENTS.md or .codex/\n" +
        "  Copilot        .github/copilot-instructions.md\n" +
        "  Standards      AGENTS.md or .mcp.json",
    );
  }

  spin.succeed(
    `Found ${detected.length} tool(s): ${detected.map((d) => d.adapter.displayName).join(", ")}`,
  );

  const readSpin = spinner("Reading configurations...");
  const configs = await Promise.all(
    detected.map((d) => d.adapter.read(root)),
  );

  // Remove Standards MCP servers that are duplicates of another adapter's version,
  // UNLESS the Standards version has version pins that the other doesn't.
  // This preserves: (a) HTTP servers only in Standards, (b) pinned versions from .mcp.json.
  const otherMcp = new Map<string, unknown>();
  for (const c of configs) {
    if (c.adapterId !== "standards") {
      for (const [name, server] of Object.entries(c.mcpServers)) {
        otherMcp.set(name, server);
      }
    }
  }
  if (otherMcp.size > 0) {
    for (const config of configs) {
      if (config.adapterId === "standards") {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          if (!otherMcp.has(name)) continue; // Standards-only server — keep
          // Standards has a pinned version the other adapter lacks — keep it
          // so the merger can prefer the pinned version
          const otherServer = otherMcp.get(name);
          const stdPinned = hasVersionPins(server);
          const otherPinned = hasVersionPins(otherServer);
          if (stdPinned && !otherPinned) continue; // keep — merger will prefer this
          delete config.mcpServers[name];
        }
      }
    }
  }

  // Always strip installed marker blocks from instructions to prevent recursive duplication.
  // This is unconditional — even if the manifest was deleted, markers in files should be stripped.
  for (const config of configs) {
    if (config.agentInstructions) {
      config.agentInstructions = stripAllMarkerBlocks(config.agentInstructions);
    }
  }

  readSpin.succeed("Configurations read");

  // Warn about unusually large instruction files from individual adapters
  for (let i = 0; i < detected.length; i++) {
    const d = detected[i];
    const content = configs[i]?.agentInstructions;
    if (!d || !content) continue;
    const sizeBytes = Buffer.byteLength(content, "utf-8");
    if (sizeBytes > LARGE_INSTRUCTION_THRESHOLD) {
      const sizeKB = (sizeBytes / 1024).toFixed(1);
      log.warn(
        `${d.adapter.displayName} instruction file is unusually large (${sizeKB} KB). ` +
          `Files over ${Math.round(LARGE_INSTRUCTION_THRESHOLD / 1024)} KB consume significant context window space. ` +
          `Consider splitting into rules or skills.`,
      );
    }
  }

  const mergeResult = mergeAdapterConfigs(configs);

  if (mergeResult.warnings && mergeResult.warnings.length > 0) {
    for (const w of mergeResult.warnings) {
      log.warn(w);
    }
  }

  const { stripped, envExample } = stripSecrets(mergeResult.mcpServers);

  const projectInfo = await detectProjectInfo(root);

  // Preserve existing extends and instructionStrategy from stack.json
  let preservedExtends: string[] | undefined;
  let preservedInstructionStrategy: "concatenate" | "override" | undefined;
  const existingManifestRaw = await readFileOrNull(path.join(outputDir, "stack.json"));
  if (existingManifestRaw) {
    try {
      const existing = JSON.parse(existingManifestRaw);
      preservedExtends = existing.extends;
      preservedInstructionStrategy = existing.instructionStrategy;
    } catch {
      // Corrupt stack.json — skip preservation
    }
  }

  const bundle: StackBundle = {
    manifest: {
      name: projectInfo.name,
      version: "0.1.0",
      description: projectInfo.description,
      skills: mergeResult.skills.map((s) => s.path),
      agents: mergeResult.agents.map((a) => a.path),
      rules: mergeResult.rules.map((r) => r.path),
      commands: mergeResult.commands.map((c) => c.path),
      compatibility: detected.map((d) => d.adapter.id),
      ...(preservedExtends && { extends: preservedExtends }),
      ...(preservedInstructionStrategy && { instructionStrategy: preservedInstructionStrategy }),
    },
    agentInstructions: mergeResult.agentInstructions,
    skills: mergeResult.skills,
    agents: mergeResult.agents,
    rules: mergeResult.rules,
    commands: mergeResult.commands,
    mcpServers: stripped,
    envExample,
  };

  // Flatten extends into the bundle if requested
  if (opts.includeExtends && bundle.manifest.extends?.length) {
    const { resolveGraph, mergeGraph } = await import("../core/resolve.js");
    const flattenSpin = spinner("Resolving extends...");
    const graph = await resolveGraph(outputDir);
    const merged = mergeGraph(graph, {
      instructionStrategy: bundle.manifest.instructionStrategy ?? "concatenate",
    });
    flattenSpin.succeed(`Resolved ${graph.nodes.length - 1} extended stack(s)`);

    for (const conflict of merged.conflicts) {
      log.warn(`${conflict.type} "${conflict.name}" — using ${conflict.winner}`);
    }

    // Replace bundle content with merged, strip extends
    const { extends: _, instructionStrategy: __, ...cleanManifest } = merged.bundle.manifest;
    bundle.agentInstructions = merged.bundle.agentInstructions;
    bundle.skills = merged.bundle.skills;
    bundle.agents = merged.bundle.agents;
    bundle.rules = merged.bundle.rules;
    bundle.commands = merged.bundle.commands;
    bundle.mcpServers = merged.bundle.mcpServers;
    bundle.envExample = merged.bundle.envExample;
    bundle.manifest = cleanManifest;
  }

  // Interactive artifact selection (after extends-flatten so users see the
  // full picked set, not just the root stack).
  if (opts.select) {
    requireInteractive("--select");
    const excluded = await pickExclusions(bundle);
    if (excluded.length > 0) {
      const filtered = applyExcluded(bundle, excluded);
      bundle.manifest = filtered.manifest;
      bundle.skills = filtered.skills;
      bundle.agents = filtered.agents;
      bundle.rules = filtered.rules;
      bundle.commands = filtered.commands;
      bundle.mcpServers = filtered.mcpServers;
      bundle.envExample = filtered.envExample;
    }
  }

  if (opts.dryRun) {
    // Build list of files that would be written, checking existence in parallel
    const filePaths: string[] = [path.join(outputDir, "stack.json")];
    if (bundle.agentInstructions) {
      filePaths.push(path.join(outputDir, "agent.promptpit.md"));
    }
    for (const skill of bundle.skills) {
      filePaths.push(path.join(outputDir, "skills", skill.name, "SKILL.md"));
    }
    for (const agent of bundle.agents) {
      filePaths.push(path.join(outputDir, "agents", `${agent.name}.md`));
    }
    for (const rule of bundle.rules) {
      filePaths.push(path.join(outputDir, "rules", `${rule.name}.md`));
    }
    for (const command of bundle.commands) {
      filePaths.push(path.join(outputDir, "commands", `${command.name}.md`));
    }
    if (Object.keys(bundle.mcpServers).length > 0) {
      filePaths.push(path.join(outputDir, "mcp.json"));
    }
    if (Object.keys(bundle.envExample).length > 0) {
      filePaths.push(path.join(outputDir, ".env.example"));
    }

    const existsResults = await Promise.all(filePaths.map((f) => exists(f)));
    const entries: DryRunEntry[] = filePaths.map((file, i) => ({
      file,
      action: existsResults[i] ? "modify" as const : "create" as const,
    }));

    const sections: DryRunSection[] = [{ label: "Files", entries }];

    printDryRunReport(
      `Dry run — would write to ${outputDir}/:`,
      sections,
      !!opts.verbose,
    );

    const skillCount = bundle.skills.length;
    const agentCount = bundle.agents.length;
    const ruleCount = bundle.rules.length;
    const commandCount = bundle.commands.length;
    const mcpCount = Object.keys(bundle.mcpServers).length;
    const secretCount = Object.keys(bundle.envExample).length;
    log.info(
      `Summary: ${bundle.agentInstructions ? "1 instruction file" : "no instructions"}, ` +
        `${skillCount} skill${skillCount !== 1 ? "s" : ""}, ` +
        `${agentCount} agent${agentCount !== 1 ? "s" : ""}, ` +
        `${ruleCount} rule${ruleCount !== 1 ? "s" : ""}, ` +
        `${commandCount} command${commandCount !== 1 ? "s" : ""}, ` +
        `${mcpCount} MCP server${mcpCount !== 1 ? "s" : ""}, ` +
        `${secretCount} secret${secretCount !== 1 ? "s" : ""} stripped`,
    );
    return;
  }

  const writeSpin = spinner("Writing stack bundle...");
  await writeStack(outputDir, bundle);
  writeSpin.succeed(`Stack written to ${outputDir}`);

  log.success(
    `Collected: ${mergeResult.skills.length} skills, ${mergeResult.agents.length} agents, ${mergeResult.rules.length} rules, ${mergeResult.commands.length} commands, ${Object.keys(stripped).length} MCP servers, ${Object.keys(envExample).length} secrets stripped`,
  );
  log.info(
    "Next: Run 'pit validate' to check for issues, then 'git add .promptpit && git commit'.",
  );
}
