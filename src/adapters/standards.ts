import path from "node:path";
import { homedir } from "node:os";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
  DryRunEntry,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, exists } from "../shared/utils.js";
import { writeWithMarkers, readMcpFromSettings, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, buildInlineContent } from "./adapter-utils.js";

const MCP_FILE = ".mcp.json";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".agents", "skills"),
    mcp: path.join(root, MCP_FILE),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".agents", "AGENTS.md"),
    skills: path.join(home, ".agents", "skills"),
    mcp: path.join(home, ".agents", "mcp.json"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const mcpServers = await readMcpFromSettings(p.mcp);

  return {
    adapterId: "standards",
    agentInstructions,
    skills: [],
    agents: [],
    mcpServers,
    rules: [],
  };
}

async function write(
  root: string,
  stack: StackBundle,
  opts: WriteOptions,
): Promise<WriteResult> {
  const p = opts.global ? userPaths() : projectPaths(root);
  const filesWritten: string[] = [];
  const warnings: string[] = [];
  const dryRunEntries: DryRunEntry[] = [];
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    const content = buildInlineContent(stack.agentInstructions, stack.agents);
    if (content) {
      const result = await writeWithMarkers(
        p.config,
        content,
        stackName,
        version,
        "standards",
        opts.dryRun,
      );
      if (result.written) filesWritten.push(result.written);
      if (opts.dryRun) {
        dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
      }
    }

    if (!opts.global) {
      const mcpResult = await mergeMcpIntoJson(p.mcp, stack.mcpServers, warnings, opts.dryRun);
      if (mcpResult.written) filesWritten.push(mcpResult.written);
      const mcpCount = Object.keys(stack.mcpServers).length;
      if (opts.dryRun && mcpCount > 0) {
        dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, mcpResult, opts.verbose));
      }
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "standards config");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}

export const standardsAdapter: PlatformAdapter = {
  id: "standards",
  displayName: "Standards",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "none",
    rules: false,
    skillFormat: "md",
    mcpStdio: true,
    mcpRemote: false,
    mcpFormat: "json",
    mcpRootKey: "mcpServers",
    agentsmd: true,
    hooks: false,
    agents: "inline",
  },
  detect,
  read,
  write,
};
