import path from "node:path";
import { readStack } from "../core/stack.js";
import { installCanonical } from "../core/skill-store.js";
import { readManifest, writeManifest, upsertInstall, computeHash, computeMcpServerHash } from "../core/manifest.js";
import { detectAdapters } from "../adapters/registry.js";
import { validateEnvNames } from "../core/security.js";
import { writeFileEnsureDir, removeDir, readFileOrNull, exists } from "../shared/utils.js";
import { log, spinner, printDryRunReport } from "../shared/io.js";
import { parseGitHubSource, cloneAndResolve } from "../sources/github.js";
import { ruleToClaudeFormat } from "../adapters/claude-code.js";
import { ruleToMdc } from "../adapters/cursor.js";
import { ruleToInstructionsMd, agentToGitHubAgent } from "../adapters/copilot.js";
import { agentToCodexToml } from "../adapters/toml-utils.js";
import { buildInlineContent } from "../adapters/adapter-utils.js";
import type { WriteOptions, DryRunEntry } from "../adapters/types.js";
import type { DryRunSection } from "../shared/io.js";
import type { InstallEntry, AdapterInstallRecord } from "../shared/schema.js";
import { canonicalSkillBase } from "../core/skill-store.js";

export interface InstallOptions {
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  forceStandards?: boolean;
  preferUniversal?: boolean;
  save?: boolean;
}

export async function installStack(
  source: string,
  target: string,
  opts: InstallOptions,
): Promise<void> {
  let resolvedSource = source;
  let tmpDir: string | null = null;

  // --save requires an explicit source (can't save ".promptpit" to extends)
  if (opts.save && source === ".promptpit") {
    throw new Error("Cannot use --save without specifying a stack source.");
  }

  // Default source: resolve .promptpit relative to target directory
  if (source === ".promptpit") {
    resolvedSource = path.resolve(target, ".promptpit");
    if (!(await exists(path.join(resolvedSource, "stack.json")))) {
      throw new Error(
        "No .promptpit/ found in this directory.\n\n" +
          "To create one:\n" +
          "  pit init       scaffold a new stack from scratch\n" +
          "  pit collect    bundle existing AI tool configs\n\n" +
          "Or install from another source:\n" +
          "  pit install ./path/to/.promptpit\n" +
          "  pit install github:user/repo",
      );
    }
  }

  const gh = parseGitHubSource(source);
  if (gh) {
    if (opts.dryRun) {
      log.info("Fetching stack metadata from GitHub (required for dry-run preview)...");
    }
    const resolved = await cloneAndResolve(gh);
    resolvedSource = resolved.stackDir;
    tmpDir = resolved.tmpDir;
  }

  try {
    const spin = spinner("Reading stack bundle...");

    const bundle = await readStack(resolvedSource);
    spin.succeed(
      `Stack: ${bundle.manifest.name}@${bundle.manifest.version}`,
    );

    // --save: save to extends FIRST, then resolve the full chain
    if (opts.save) {
      const localStackJsonPath = path.join(target, ".promptpit", "stack.json");
      const localRaw = await readFileOrNull(localStackJsonPath);
      if (!localRaw) {
        throw new Error(
          'No stack.json found. Run "pit init" first, or install without --save.',
        );
      }
      const localManifest = JSON.parse(localRaw);
      const existingExtends: string[] = localManifest.extends ?? [];
      if (!existingExtends.includes(source)) {
        localManifest.extends = [...existingExtends, source];
        await writeFileEnsureDir(
          localStackJsonPath,
          JSON.stringify(localManifest, null, 2) + "\n",
        );
        log.info(`Added "${source}" to extends in .promptpit/stack.json`);
      } else {
        log.info(`"${source}" already in extends, skipping.`);
      }

      // Now install from local .promptpit (which has the updated extends)
      resolvedSource = path.resolve(target, ".promptpit");
      const updatedBundle = await readStack(resolvedSource);
      // Replace bundle reference for extends resolution below
      Object.assign(bundle, updatedBundle);
    }

    // Resolve extends if present
    let finalBundle = bundle;
    let resolvedExtendsEntries: Array<{
      source: string;
      version?: string;
      resolvedCommit?: string;
      resolvedAt: string;
    }> = [];

    if (bundle.manifest.extends && bundle.manifest.extends.length > 0) {
      const resolveSpin = spinner("Resolving extends...");
      const { resolveGraph, mergeGraph } = await import("../core/resolve.js");
      const graph = await resolveGraph(resolvedSource);
      // For --save: skip root instructions in the marker because they're already
      // in the target file (we just saved to extends and are re-installing from
      // the local .promptpit/ which was previously collected from the target).
      // For plain no-args install: include root instructions (the bundle may
      // have been created manually, not from collect).
      const merged = mergeGraph(graph, {
        instructionStrategy: bundle.manifest.instructionStrategy ?? "concatenate",
        skipRootInstructions: !!opts.save,
      });
      resolveSpin.succeed(
        `Resolved ${graph.nodes.length - 1} extended stack(s)`,
      );

      for (const conflict of merged.conflicts) {
        log.warn(
          `${conflict.type} "${conflict.name}" defined in both ${path.basename(conflict.from)} and ${path.basename(conflict.winner)} — using ${path.basename(conflict.winner)}`,
        );
      }

      finalBundle = merged.bundle;

      resolvedExtendsEntries = graph.nodes
        .filter((n) => n.depth > 0)
        .map((n) => ({
          source: n.source,
          version: n.bundle.manifest.version,
          resolvedCommit: n.resolvedCommit,
          resolvedAt: new Date().toISOString(),
        }));
    }

    // Validate inbound env var names (security)
    if (Object.keys(finalBundle.envExample).length > 0) {
      const dangerous = validateEnvNames(finalBundle.envExample);
      if (dangerous.length > 0) {
        log.error(
          `Stack contains dangerous env var names: ${dangerous.join(", ")}. ` +
            `These could be used for code injection. Aborting.`,
        );
        throw new Error(
          `Dangerous env var names detected: ${dangerous.join(", ")}`,
        );
      }
    }

    // Warn about inbound MCP servers (security)
    if (Object.keys(finalBundle.mcpServers).length > 0) {
      log.warn(
        `This stack includes ${Object.keys(finalBundle.mcpServers).length} MCP server(s): ` +
          `${Object.keys(finalBundle.mcpServers).join(", ")}. ` +
          `MCP servers run as executables on your machine.`,
      );
    }

    // Detect target adapters
    const detectSpin = spinner("Detecting AI tools in target...");
    const detected = await detectAdapters(target);

    if (detected.length === 0) {
      detectSpin.warn("No AI tools detected in target");
      log.info("Creating Claude Code config by default");
      const { claudeCodeAdapter } = await import(
        "../adapters/claude-code.js"
      );
      detected.push({
        adapter: claudeCodeAdapter,
        detection: { detected: true, configPaths: [] },
      });
    } else {
      detectSpin.succeed(
        `Target tools: ${detected.map((d) => d.adapter.displayName).join(", ")}`,
      );
    }

    // Always include standards for writing — AGENTS.md + .mcp.json are universal cross-tool outputs
    if (!detected.some((d) => d.adapter.id === "standards")) {
      const { standardsAdapter } = await import("../adapters/standards.js");
      detected.push({
        adapter: standardsAdapter,
        detection: { detected: true, configPaths: [] },
      });
    }

    // Dedup: prevent universal/tool-specific duplication
    if (opts.forceStandards && opts.preferUniversal) {
      throw new Error("--force-standards and --prefer-universal are mutually exclusive");
    }

    // Write skills to canonical .agents/skills/ location
    let canonicalSkillPaths: Map<string, string> | undefined;
    const canonicalEntries: DryRunEntry[] = [];
    if (finalBundle.skills.length > 0) {
      if (opts.dryRun) {
        const base = canonicalSkillBase(target, opts.global);
        for (const skill of finalBundle.skills) {
          const dest = path.join(base, skill.name, "SKILL.md");
          const skillExists = await exists(dest);
          canonicalEntries.push({
            file: dest,
            action: skillExists ? "modify" : "create",
          });
        }
      } else {
        const canonSpin = spinner("Writing canonical skills...");
        canonicalSkillPaths = await installCanonical(target, finalBundle.skills, {
          global: opts.global,
        });
        canonSpin.succeed(
          `Canonical: ${canonicalSkillPaths.size} skills in .agents/skills/`,
        );
      }
    }

    // Build writeOpts with dedup flags
    const writeOpts: WriteOptions = {
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      force: opts.force,
      global: opts.global,
      canonicalSkillPaths,
    };

    if (opts.preferUniversal) {
      writeOpts.preferUniversal = true;
      // Warn about Copilot's opt-in AGENTS.md reading
      const hasCopilot = detected.some((d) => d.adapter.id === "copilot");
      if (hasCopilot) {
        log.warn(
          "Copilot: skipped .github/copilot-instructions.md — ensure chat.useAgentsMdFile is enabled in VS Code settings",
        );
      }
    } else if (!opts.forceStandards) {
      // Single pass: collect adapter names that natively read each universal file
      const mcpReaders: string[] = [];
      const instrReaders: string[] = [];
      for (const d of detected) {
        if (d.adapter.id === "standards") continue;
        if (d.adapter.capabilities.nativelyReads?.mcp) mcpReaders.push(d.adapter.displayName);
        if (d.adapter.capabilities.nativelyReads?.instructions) instrReaders.push(d.adapter.displayName);
      }

      const hasMcp = Object.keys(finalBundle.mcpServers).length > 0;
      const hasInstructions = !!(finalBundle.agentInstructions || finalBundle.agents.length > 0);
      let skippedAny = false;

      if (mcpReaders.length > 0) {
        writeOpts.skipMcp = true;
        if (hasMcp) {
          skippedAny = true;
          log.info(
            `Standards: skipped .mcp.json (${mcpReaders.join(", ")} read${mcpReaders.length === 1 ? "s" : ""} it natively, causing duplicate MCP servers)`,
          );
        }
      }
      if (instrReaders.length > 0) {
        writeOpts.skipInstructions = true;
        if (hasInstructions) {
          skippedAny = true;
          log.info(
            `Standards: skipped AGENTS.md (${instrReaders.join(", ")} read${instrReaders.length === 1 ? "s" : ""} it natively, causing duplicate instructions)`,
          );
        }
      }
      if (skippedAny) {
        log.info(
          "Tip: use --force-standards to write universal files even when detected tools read them natively",
        );
      }
    }

    // Write to each detected adapter

    const adapterSections: DryRunSection[] = [];

    for (const { adapter } of detected) {
      if (opts.dryRun) {
        const result = await adapter.write(target, finalBundle, writeOpts);
        if (result.dryRunEntries && result.dryRunEntries.length > 0) {
          adapterSections.push({
            label: adapter.displayName,
            entries: result.dryRunEntries,
          });
        }
        for (const w of result.warnings) {
          log.warn(w);
        }
      } else {
        const writeSpin = spinner(`Installing to ${adapter.displayName}...`);
        const result = await adapter.write(target, finalBundle, writeOpts);
        writeSpin.succeed(
          `${adapter.displayName}: ${result.filesWritten.length} files written`,
        );
        for (const w of result.warnings) {
          log.warn(w);
        }
      }
    }

    if (opts.dryRun) {
      const otherEntries: DryRunEntry[] = [];

      otherEntries.push({
        file: path.join(target, ".promptpit", "installed.json"),
        action: (await exists(path.join(target, ".promptpit", "installed.json")))
          ? "modify"
          : "create",
        detail: "install manifest",
      });

      const envCount = Object.keys(finalBundle.envExample).length;
      if (envCount > 0) {
        const envPath = path.join(target, ".env");
        const envExists = await exists(envPath);
        otherEntries.push({
          file: envPath,
          action: envExists ? "modify" : "create",
          detail: `${envCount} placeholder${envCount !== 1 ? "s" : ""}`,
        });
      }

      const sections: DryRunSection[] = [];
      if (canonicalEntries.length > 0) {
        sections.push({ label: "Canonical skills", entries: canonicalEntries });
      }
      sections.push(...adapterSections);
      if (otherEntries.length > 0) {
        sections.push({ label: "Other", entries: otherEntries });
      }

      printDryRunReport(
        `Dry run — would install ${finalBundle.manifest.name}@${finalBundle.manifest.version}:`,
        sections,
        !!opts.verbose,
      );
      return;
    }

    // Write manifest (tracks what was installed for status/dedup)
    {
      const manifestSpin = spinner("Writing install manifest...");
      const manifest = await readManifest(target);

      // Build adapter records with content hashes
      const adapterRecords: Record<string, AdapterInstallRecord> = {};
      for (const { adapter } of detected) {
        const record: AdapterInstallRecord = {};

        // Hash instructions — inline-agent adapters embed agents in the marker block,
        // so hash what actually gets written to disk (buildInlineContent result)
        // Skip recording if the adapter was told not to write instructions
        const skipAdapterInstructions =
          (adapter.id === "standards" && writeOpts.skipInstructions) ||
          (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.instructions);
        if (!skipAdapterInstructions && (finalBundle.agentInstructions || (finalBundle.agents.length > 0 && adapter.capabilities.agents === "inline"))) {
          const configPath = adapter.paths.project(target).config;
          if (configPath) {
            const written = adapter.capabilities.agents === "inline"
              ? buildInlineContent(finalBundle.agentInstructions, finalBundle.agents) ?? ""
              : finalBundle.agentInstructions;
            record.instructions = { hash: computeHash(written.trim()) };
          }
        }

        // Hash skills from in-memory content
        if (finalBundle.skills.length > 0) {
          const skills: Record<string, { hash: string }> = {};
          for (const skill of finalBundle.skills) {
            skills[skill.name] = { hash: computeHash(skill.content) };
          }
          if (Object.keys(skills).length > 0) {
            record.skills = skills;
          }
        }

        // Hash agents — native adapters translate per-file, so hash translated content
        if (finalBundle.agents.length > 0 && adapter.capabilities.agents === "native") {
          const agents: Record<string, { hash: string }> = {};
          for (const agent of finalBundle.agents) {
            let translated = agent.content;
            if (adapter.id === "copilot") translated = agentToGitHubAgent(agent.content);
            else if (adapter.id === "codex") translated = agentToCodexToml(agent.content);
            agents[agent.name] = { hash: computeHash(translated) };
          }
          if (Object.keys(agents).length > 0) {
            record.agents = agents;
          }
        }

        // Hash rules (translated content per adapter)
        if (finalBundle.rules.length > 0 && adapter.capabilities.rules) {
          const rules: Record<string, { hash: string }> = {};
          for (const rule of finalBundle.rules) {
            // Hash the translated content (what's actually written to disk)
            let translated = rule.content;
            if (adapter.id === "claude-code") translated = ruleToClaudeFormat(rule.content);
            else if (adapter.id === "cursor") translated = ruleToMdc(rule.content);
            else if (adapter.id === "copilot") translated = ruleToInstructionsMd(rule.content);
            rules[rule.name] = { hash: computeHash(translated) };
          }
          if (Object.keys(rules).length > 0) {
            record.rules = rules;
          }
        }

        // Hash MCP for any adapter that supports it
        // Skip recording if the adapter was told not to write MCP
        const skipAdapterMcp =
          (adapter.id === "standards" && writeOpts.skipMcp) ||
          (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.mcp);
        if (!skipAdapterMcp && adapter.capabilities.mcpStdio && Object.keys(finalBundle.mcpServers).length > 0) {
          const mcp: Record<string, { hash: string }> = {};
          for (const [serverName, serverConfig] of Object.entries(finalBundle.mcpServers)) {
            mcp[serverName] = { hash: computeMcpServerHash(serverConfig) };
          }
          record.mcp = mcp;
        }

        // Hash commands
        if (finalBundle.commands.length > 0 && adapter.capabilities.commands) {
          const commands: Record<string, { hash: string }> = {};
          for (const command of finalBundle.commands) {
            commands[command.name] = { hash: computeHash(command.content) };
          }
          record.commands = commands;
        }

        if (record.instructions || record.skills || record.agents || record.rules || record.mcp || record.commands) {
          adapterRecords[adapter.id] = record;
        }
      }

      const entry: InstallEntry = {
        stack: finalBundle.manifest.name,
        stackVersion: finalBundle.manifest.version,
        source: gh ? source : undefined,
        installedAt: new Date().toISOString(),
        ...(opts.forceStandards && { installMode: "force-standards" as const }),
        ...(opts.preferUniversal && { installMode: "prefer-universal" as const }),
        ...(resolvedExtendsEntries.length > 0 && { resolvedExtends: resolvedExtendsEntries }),
        adapters: adapterRecords,
      };

      const updated = upsertInstall(manifest, entry);
      await writeManifest(target, updated);
      manifestSpin.succeed("Manifest updated");
    }

    // Write .env file with placeholders (don't overwrite existing)
    if (Object.keys(finalBundle.envExample).length > 0) {
      const envPath = path.join(target, ".env");
      const existing = await readFileOrNull(envPath);
      if (existing != null) {
        const existingKeys = new Set(
          existing.split("\n")
            .map((line) => line.split("=")[0]?.trim())
            .filter(Boolean),
        );
        const missingKeys = Object.keys(finalBundle.envExample).filter(
          (key) => !existingKeys.has(key),
        );
        if (missingKeys.length > 0) {
          const additions = missingKeys
            .map((key) => `${key}= ${finalBundle.envExample[key]}`)
            .join("\n");
          await writeFileEnsureDir(envPath, existing + "\n" + additions + "\n");
          log.info(
            `Appended ${missingKeys.length} new placeholder(s) to existing .env.`,
          );
        } else {
          log.info("All env vars already present in .env, skipping.");
        }
      } else {
        const envLines = Object.entries(finalBundle.envExample)
          .map(([key, comment]) => `${key}= ${comment}`)
          .join("\n");
        await writeFileEnsureDir(envPath, envLines + "\n");
        log.info(
          `Created .env with ${Object.keys(finalBundle.envExample).length} placeholder(s). Fill in your values.`,
        );
      }
    }

    log.success("Stack installed successfully!");
    log.info("Next: Run 'pit status' to verify.");
  } finally {
    if (tmpDir) {
      await removeDir(tmpDir);
    }
  }
}
