import path from "node:path";
import { readStack } from "../core/stack.js";
import { installCanonical } from "../core/skill-store.js";
import { readManifest, writeManifest, upsertInstall, computeHash } from "../core/manifest.js";
import { detectAdapters } from "../adapters/registry.js";
import { validateEnvNames } from "../core/security.js";
import { writeFileEnsureDir, removeDir, readFileOrNull, exists } from "../shared/utils.js";
import { log, spinner } from "../shared/io.js";
import { parseGitHubSource, cloneAndResolve } from "../sources/github.js";
import type { WriteOptions } from "../adapters/types.js";
import type { InstallEntry, AdapterInstallRecord } from "../shared/schema.js";

export interface InstallOptions {
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export async function installStack(
  source: string,
  target: string,
  opts: InstallOptions,
): Promise<void> {
  let resolvedSource = source;
  let tmpDir: string | null = null;

  // Default source: resolve .promptpit relative to target directory
  if (source === ".promptpit") {
    resolvedSource = path.resolve(target, ".promptpit");
    if (!(await exists(path.join(resolvedSource, "stack.json")))) {
      throw new Error(
        "No .promptpit/ found in this directory.\n" +
          "Usage:\n" +
          "  pit install                              # install from .promptpit/ in current dir\n" +
          "  pit install ./path/to/.promptpit          # install from local path\n" +
          "  pit install github:user/repo              # install from GitHub",
      );
    }
  }

  const gh = parseGitHubSource(source);
  if (gh) {
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

    // Validate inbound env var names (security)
    if (Object.keys(bundle.envExample).length > 0) {
      const dangerous = validateEnvNames(bundle.envExample);
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
    if (Object.keys(bundle.mcpServers).length > 0) {
      log.warn(
        `This stack includes ${Object.keys(bundle.mcpServers).length} MCP server(s): ` +
          `${Object.keys(bundle.mcpServers).join(", ")}. ` +
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

    // Always include agents-md for writing — AGENTS.md is the universal cross-tool output
    if (!detected.some((d) => d.adapter.id === "agents-md")) {
      const { agentsMdAdapter } = await import("../adapters/agents-md.js");
      detected.push({
        adapter: agentsMdAdapter,
        detection: { detected: true, configPaths: [] },
      });
    }

    // Always include mcp-standard for writing when stack has MCP servers
    if (
      Object.keys(bundle.mcpServers).length > 0 &&
      !detected.some((d) => d.adapter.id === "mcp-standard")
    ) {
      const { mcpStandardAdapter } = await import("../adapters/mcp-standard.js");
      detected.push({
        adapter: mcpStandardAdapter,
        detection: { detected: true, configPaths: [] },
      });
    }

    // Write skills to canonical .agents/skills/ location
    let canonicalSkillPaths: Map<string, string> | undefined;
    if (bundle.skills.length > 0 && !opts.dryRun) {
      const canonSpin = spinner("Writing canonical skills...");
      canonicalSkillPaths = await installCanonical(target, bundle.skills, {
        global: opts.global,
      });
      canonSpin.succeed(
        `Canonical: ${canonicalSkillPaths.size} skills in .agents/skills/`,
      );
    }

    // Write to each detected adapter
    const writeOpts: WriteOptions = {
      dryRun: opts.dryRun,
      force: opts.force,
      global: opts.global,
      canonicalSkillPaths,
    };

    for (const { adapter } of detected) {
      const writeSpin = spinner(`Installing to ${adapter.displayName}...`);
      const result = await adapter.write(target, bundle, writeOpts);
      writeSpin.succeed(
        `${adapter.displayName}: ${result.filesWritten.length} files written`,
      );
      for (const w of result.warnings) {
        log.warn(w);
      }
    }

    // Write manifest (tracks what was installed for status/dedup)
    if (!opts.dryRun) {
      const manifestSpin = spinner("Writing install manifest...");
      const manifest = await readManifest(target);

      // Build adapter records with content hashes
      const adapterRecords: Record<string, AdapterInstallRecord> = {};
      for (const { adapter } of detected) {
        const record: AdapterInstallRecord = {};

        // Hash instructions — only for adapters that write marker-based instruction files.
        // mcp-standard writes JSON (no instructions), so skip it.
        if (bundle.agentInstructions && adapter.id !== "mcp-standard") {
          const configPath = adapter.paths.project(target).config;
          if (configPath) {
            record.instructions = { hash: computeHash(bundle.agentInstructions.trim()) };
          }
        }

        // Hash skills from in-memory content
        if (bundle.skills.length > 0) {
          const skills: Record<string, { hash: string }> = {};
          for (const skill of bundle.skills) {
            skills[skill.name] = { hash: computeHash(skill.content) };
          }
          if (Object.keys(skills).length > 0) {
            record.skills = skills;
          }
        }

        // Hash MCP for any adapter that supports it
        if (adapter.capabilities.mcpStdio && Object.keys(bundle.mcpServers).length > 0) {
          const mcp: Record<string, { hash: string }> = {};
          for (const [serverName, serverConfig] of Object.entries(bundle.mcpServers)) {
            mcp[serverName] = { hash: computeHash(JSON.stringify(serverConfig)) };
          }
          record.mcp = mcp;
        }

        if (record.instructions || record.skills || record.mcp) {
          adapterRecords[adapter.id] = record;
        }
      }

      const entry: InstallEntry = {
        stack: bundle.manifest.name,
        stackVersion: bundle.manifest.version,
        source: gh ? source : undefined,
        installedAt: new Date().toISOString(),
        adapters: adapterRecords,
      };

      const updated = upsertInstall(manifest, entry);
      await writeManifest(target, updated);
      manifestSpin.succeed("Manifest updated");
    }

    // Write .env file with placeholders (don't overwrite existing)
    if (Object.keys(bundle.envExample).length > 0 && !opts.dryRun) {
      const envPath = path.join(target, ".env");
      const existing = await readFileOrNull(envPath);
      if (existing != null) {
        const existingKeys = new Set(
          existing.split("\n")
            .map((line) => line.split("=")[0]?.trim())
            .filter(Boolean),
        );
        const missingKeys = Object.keys(bundle.envExample).filter(
          (key) => !existingKeys.has(key),
        );
        if (missingKeys.length > 0) {
          const additions = missingKeys
            .map((key) => `${key}= ${bundle.envExample[key]}`)
            .join("\n");
          await writeFileEnsureDir(envPath, existing + "\n" + additions + "\n");
          log.info(
            `Appended ${missingKeys.length} new placeholder(s) to existing .env.`,
          );
        } else {
          log.info("All env vars already present in .env, skipping.");
        }
      } else {
        const envLines = Object.entries(bundle.envExample)
          .map(([key, comment]) => `${key}= ${comment}`)
          .join("\n");
        await writeFileEnsureDir(envPath, envLines + "\n");
        log.info(
          `Created .env with ${Object.keys(bundle.envExample).length} placeholder(s). Fill in your values.`,
        );
      }
    }

    log.success("Stack installed successfully!");
  } finally {
    if (tmpDir) {
      await removeDir(tmpDir);
    }
  }
}
