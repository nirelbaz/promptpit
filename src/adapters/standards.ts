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
import { log } from "../shared/io.js";
import { writeWithMarkers, readMcpFromSettings, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, buildInlineContent } from "./adapter-utils.js";

const MCP_FILE = ".mcp.json";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".agents", "skills"),
    mcp: path.join(root, MCP_FILE),
  };
}

/** Resolve the AGENTS.md path, falling back to the singular AGENT.md when
 *  only the singular form exists on disk. Preserves the canonical path for
 *  writes (AGENTS.md) while reading whichever the user has. Some repos
 *  (e.g. Snyk) ship a single AGENT.md — we honor it for read, but warn if
 *  both files coexist and prefer the plural. */
async function resolveAgentsFile(root: string): Promise<string> {
  const plural = path.join(root, "AGENTS.md");
  const singular = path.join(root, "AGENT.md");
  const hasPlural = await exists(plural);
  const hasSingular = await exists(singular);
  if (hasPlural && hasSingular) {
    log.warn(`Both AGENTS.md and AGENT.md found at ${root}; using AGENTS.md`);
    return plural;
  }
  if (!hasPlural && hasSingular) return singular;
  return plural;
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

  const agentsFile = await resolveAgentsFile(root);
  if (await exists(agentsFile)) found.push(agentsFile);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentsFile = await resolveAgentsFile(root);
  const agentInstructions = (await readFileOrNull(agentsFile)) ?? "";
  const mcpServers = await readMcpFromSettings(p.mcp);

  return {
    adapterId: "standards",
    agentInstructions,
    skills: [],
    agents: [],
    mcpServers,
    rules: [],
    commands: [],
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
    if (!opts.skipInstructions) {
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
    }

    if (!opts.skipMcp && !opts.global) {
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
    commands: false,
  },
  detect,
  read,
  write,
};
