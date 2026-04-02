import path from "node:path";
import { detectAdapters } from "../adapters/registry.js";
import { mergeConfigs } from "../core/merger.js";
import { stripSecrets } from "../core/security.js";
import { writeStack } from "../core/stack.js";
import { stripAllMarkerBlocks } from "../shared/markers.js";
import { readFileOrNull, exists } from "../shared/utils.js";
import type { StackBundle } from "../shared/schema.js";
import { log, spinner, printDryRunReport } from "../shared/io.js";
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
      "No AI tool configs found in this project.\n\n" +
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

  // Clear MCP from standards adapter when other MCP-providing adapters are present
  // (avoids double-reading MCP servers from both .mcp.json and tool-native settings).
  const hasOtherMcpAdapter = detected.some(
    (d) => d.adapter.id !== "standards" && d.adapter.capabilities.mcpStdio,
  );
  if (hasOtherMcpAdapter) {
    for (const config of configs) {
      if (config.adapterId === "standards") {
        config.mcpServers = {};
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

  const mergeResult = mergeConfigs(configs);

  if (mergeResult.warnings && mergeResult.warnings.length > 0) {
    for (const w of mergeResult.warnings) {
      log.warn(w);
    }
  }

  const { stripped, envExample } = stripSecrets(mergeResult.mcpServers);

  const projectInfo = await detectProjectInfo(root);

  const bundle: StackBundle = {
    manifest: {
      name: projectInfo.name,
      version: "0.1.0",
      description: projectInfo.description,
      skills: mergeResult.skills.map((s) => s.path),
      rules: mergeResult.rules.map((r) => r.path),
      compatibility: detected.map((d) => d.adapter.id),
    },
    agentInstructions: mergeResult.agentInstructions,
    skills: mergeResult.skills,
    rules: mergeResult.rules,
    mcpServers: stripped,
    envExample,
  };

  if (opts.dryRun) {
    // Build list of files that would be written, checking existence in parallel
    const filePaths: string[] = [path.join(outputDir, "stack.json")];
    if (bundle.agentInstructions) {
      filePaths.push(path.join(outputDir, "agent.promptpit.md"));
    }
    for (const skill of bundle.skills) {
      filePaths.push(path.join(outputDir, "skills", skill.name, "SKILL.md"));
    }
    for (const rule of bundle.rules) {
      filePaths.push(path.join(outputDir, "rules", `${rule.name}.md`));
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
    const ruleCount = bundle.rules.length;
    const mcpCount = Object.keys(bundle.mcpServers).length;
    const secretCount = Object.keys(bundle.envExample).length;
    log.info(
      `Summary: ${bundle.agentInstructions ? "1 instruction file" : "no instructions"}, ` +
        `${skillCount} skill${skillCount !== 1 ? "s" : ""}, ` +
        `${ruleCount} rule${ruleCount !== 1 ? "s" : ""}, ` +
        `${mcpCount} MCP server${mcpCount !== 1 ? "s" : ""}, ` +
        `${secretCount} secret${secretCount !== 1 ? "s" : ""} stripped`,
    );
    return;
  }

  const writeSpin = spinner("Writing stack bundle...");
  await writeStack(outputDir, bundle);
  writeSpin.succeed(`Stack written to ${outputDir}`);

  log.success(
    `Collected: ${mergeResult.skills.length} skills, ${mergeResult.rules.length} rules, ${Object.keys(stripped).length} MCP servers, ${Object.keys(envExample).length} secrets stripped`,
  );
  log.info(
    "Next: Run 'pit validate' to check for issues, then 'git add .promptpit && git commit'.",
  );
}
