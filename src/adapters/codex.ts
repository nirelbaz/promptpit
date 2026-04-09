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
import type { StackBundle, McpServerConfig } from "../shared/schema.js";
import {
  readFileOrNull,
  writeFileEnsureDir,
  exists,
} from "../shared/utils.js";
import { readSkillsFromDir, writeWithMarkers, rethrowPermissionError, markersDryRunEntry, fileDryRunEntry, warnMcpOverwrites, writeSkillsNative } from "./adapter-utils.js";
import { readAgentsFromToml, readMcpFromToml, writeMcpToToml, agentToCodexToml } from "./toml-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".codex", "skills"),
    mcp: path.join(root, ".codex", "config.toml"),
    agents: path.join(root, ".codex", "agents"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".codex", "AGENTS.md"),
    skills: path.join(home, ".codex", "skills"),
    mcp: path.join(home, ".codex", "config.toml"),
    agents: path.join(home, ".codex", "agents"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const codexDir = path.join(root, ".codex");

  const [configExists, skillsExists, mcpExists, codexDirExists] =
    await Promise.all([exists(p.config), exists(p.skills), exists(p.mcp), exists(codexDir)]);

  // Require .codex/ directory to distinguish from Standards adapter.
  // Both use AGENTS.md, so without .codex/ an AGENTS.md-only project is Standards.
  if (!codexDirExists) {
    return { detected: false, configPaths: [] };
  }

  const found: string[] = [];
  if (configExists) found.push(p.config);
  if (skillsExists) found.push(p.skills);
  if (mcpExists) found.push(p.mcp);
  if (found.length === 0) found.push(codexDir);

  return { detected: true, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const [agentInstructions, skills, tomlContent, agents] = await Promise.all([
    readFileOrNull(p.config).then((r) => r ?? ""),
    readSkillsFromDir(p.skills, { includeStandalone: true }),
    readFileOrNull(p.mcp).then((r) => r ?? ""),
    readAgentsFromToml(p.agents),
  ]);
  const mcpServers = readMcpFromToml(tomlContent);

  return {
    adapterId: "codex",
    agentInstructions,
    skills,
    agents,
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
    // Write instructions to AGENTS.md (agents go to native .codex/agents/*.toml)
    // Skip when preferUniversal — Standards writes AGENTS.md as the universal file
    if (!opts.preferUniversal || !codexAdapter.capabilities.nativelyReads?.instructions) {
      if (stack.agentInstructions) {
        const result = await writeWithMarkers(
          p.config,
          stack.agentInstructions,
          stackName,
          version,
          "codex",
          opts.dryRun,
        );
        if (result.written) filesWritten.push(result.written);
        if (opts.dryRun) {
          dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
        }
      }
    }

    await writeSkillsNative(p.skills, stack.skills, opts, dryRunEntries, filesWritten);

    // Write agents to .codex/agents/*.toml (native format)
    for (const agent of stack.agents) {
      const dest = path.join(p.agents!, `${agent.name}.toml`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .toml"));
      } else {
        const tomlContent = agentToCodexToml(agent.content);
        await writeFileEnsureDir(dest, tomlContent);
        filesWritten.push(dest);
      }
    }

    if (Object.keys(stack.mcpServers).length > 0 && !opts.dryRun) {
      const existingToml = (await readFileOrNull(p.mcp)) ?? "";
      const existingMcp = readMcpFromToml(existingToml);
      warnMcpOverwrites(stack.mcpServers, existingMcp as Record<string, McpServerConfig>, "config.toml", warnings);
      const updated = writeMcpToToml(existingToml, stack.mcpServers);
      await writeFileEnsureDir(p.mcp, updated);
      filesWritten.push(p.mcp);
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "Codex CLI paths");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}

export const codexAdapter: PlatformAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "symlink",
    rules: false,
    skillFormat: "skill.md",
    mcpStdio: true,
    mcpRemote: false,
    mcpFormat: "toml",
    mcpRootKey: "mcp_servers",
    agentsmd: true,
    hooks: false,
    agents: "native",
    commands: false,
    nativelyReads: { instructions: true },
  },
  detect,
  read,
  write,
};
