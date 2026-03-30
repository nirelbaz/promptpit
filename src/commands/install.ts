import path from "node:path";
import { readStack } from "../core/stack.js";
import { detectAdapters } from "../adapters/registry.js";
import { validateEnvNames } from "../core/security.js";
import { writeFileEnsureDir, removeDir, readFileOrNull, exists } from "../shared/utils.js";
import { log, spinner } from "../shared/io.js";
import { parseGitHubSource, cloneAndResolve } from "../sources/github.js";
import type { WriteOptions } from "../adapters/types.js";

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

    // Write to each detected adapter
    const writeOpts: WriteOptions = {
      dryRun: opts.dryRun,
      force: opts.force,
      global: opts.global,
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

    // Write .env file with placeholders (don't overwrite existing)
    if (Object.keys(bundle.envExample).length > 0 && !opts.dryRun) {
      const envPath = path.join(target, ".env");
      if (await exists(envPath)) {
        const existing = await readFileOrNull(envPath);
        const existingLines = existing?.split("\n") ?? [];
        const missingKeys = Object.keys(bundle.envExample).filter(
          (key) =>
            !existingLines.some(
              (line) =>
                line.startsWith(`${key}=`) || line.startsWith(`${key} =`),
            ),
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
