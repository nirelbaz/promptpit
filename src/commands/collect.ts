import path from "node:path";
import { detectAdapters } from "../adapters/registry.js";
import { mergeConfigs } from "../core/merger.js";
import { stripSecrets } from "../core/security.js";
import { writeStack } from "../core/stack.js";
import { stripAllMarkerBlocks } from "../shared/markers.js";
import { readFileOrNull } from "../shared/utils.js";
import type { StackBundle } from "../shared/schema.js";
import { log, spinner } from "../shared/io.js";

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
}

export async function collectStack(
  root: string,
  outputDir: string,
  opts: CollectOptions = {},
): Promise<void> {
  const spin = spinner("Detecting AI tools...");

  const detected = await detectAdapters(root);
  if (detected.length === 0) {
    spin.fail("No AI tool configuration found");
    throw new Error(
      "No AI tool configuration found in this project. " +
        "Looked for: CLAUDE.md, .claude/, .cursorrules, .cursor/, AGENTS.md, .mcp.json",
    );
  }

  // Exclude mcp-standard from read when other MCP-providing adapters are present
  // (avoids double-reading MCP servers from both .mcp.json and .claude/settings.json).
  // If mcp-standard is the only detected adapter with MCP, keep it in the read set.
  const hasOtherMcpAdapter = detected.some(
    (d) => d.adapter.id !== "mcp-standard" && d.adapter.capabilities.mcpStdio,
  );
  const readSet = hasOtherMcpAdapter
    ? detected.filter((d) => d.adapter.id !== "mcp-standard")
    : detected;

  spin.succeed(
    `Found ${detected.length} tool(s): ${detected.map((d) => d.adapter.displayName).join(", ")}`,
  );

  const readSpin = spinner("Reading configurations...");
  const configs = await Promise.all(
    readSet.map((d) => d.adapter.read(root)),
  );

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

  if (opts.dryRun) {
    log.info("Dry run — showing what would be stripped:");
    for (const [key, comment] of Object.entries(envExample)) {
      log.info(`  ${key}: ${comment}`);
    }
    return;
  }

  const projectInfo = await detectProjectInfo(root);

  const bundle: StackBundle = {
    manifest: {
      name: projectInfo.name,
      version: "0.1.0",
      description: projectInfo.description,
      skills: mergeResult.skills.map((s) => s.path),
      compatibility: detected.map((d) => d.adapter.id),
    },
    agentInstructions: mergeResult.agentInstructions,
    skills: mergeResult.skills,
    mcpServers: stripped,
    envExample,
  };

  const writeSpin = spinner("Writing stack bundle...");
  await writeStack(outputDir, bundle);
  writeSpin.succeed(`Stack written to ${outputDir}`);

  log.success(
    `Collected: ${mergeResult.skills.length} skills, ${Object.keys(stripped).length} MCP servers, ${Object.keys(envExample).length} secrets stripped`,
  );
}
