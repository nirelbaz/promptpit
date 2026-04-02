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
import {
  readFileOrNull,
  writeFileEnsureDir,
  exists,
  removeFileOrSymlink,
  symlinkOrCopy,
} from "../shared/utils.js";
import { readSkillsFromDir, writeWithMarkers, rethrowPermissionError, markersDryRunEntry, skillDryRunEntry, formatAgentsInlineSection } from "./adapter-utils.js";
import { readMcpFromToml, writeMcpToToml } from "./toml-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".codex", "skills"),
    mcp: path.join(root, ".codex", "config.toml"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".codex", "AGENTS.md"),
    skills: path.join(home, ".codex", "skills"),
    mcp: path.join(home, ".codex", "config.toml"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const codexDir = path.join(root, ".codex");

  const [configExists, skillsExists, mcpExists, codexDirExists] =
    await Promise.all([exists(p.config), exists(p.skills), exists(p.mcp), exists(codexDir)]);

  const found: string[] = [];
  if (configExists) found.push(p.config);
  if (skillsExists) found.push(p.skills);
  if (mcpExists) found.push(p.mcp);
  // Freshly-initialized Codex repos may only have .codex/ with no config files yet
  if (found.length === 0 && codexDirExists) found.push(codexDir);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const [agentInstructions, skills, tomlContent] = await Promise.all([
    readFileOrNull(p.config).then((r) => r ?? ""),
    readSkillsFromDir(p.skills),
    readFileOrNull(p.mcp).then((r) => r ?? ""),
  ]);
  const mcpServers = readMcpFromToml(tomlContent);

  return {
    adapterId: "codex",
    agentInstructions,
    skills,
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
    if (stack.agentInstructions || stack.agents.length > 0) {
      let content = stack.agentInstructions || "";
      const agentSection = formatAgentsInlineSection(stack.agents);
      if (agentSection) {
        content = content ? `${content}\n\n${agentSection}` : agentSection;
      }
      const result = await writeWithMarkers(
        p.config,
        content,
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

    for (const skill of stack.skills) {
      const skillDir = path.join(p.skills, skill.name);
      const dest = path.join(skillDir, "SKILL.md");
      if (opts.dryRun) {
        dryRunEntries.push(skillDryRunEntry(dest, await exists(dest), "symlink"));
      } else {
        const canonicalPath = opts.canonicalSkillPaths?.get(skill.name);
        if (canonicalPath) {
          await symlinkOrCopy(canonicalPath, dest);
        } else {
          await removeFileOrSymlink(skillDir);
          await writeFileEnsureDir(dest, skill.content);
        }
        filesWritten.push(dest);
      }
    }

    if (Object.keys(stack.mcpServers).length > 0 && !opts.dryRun) {
      const existingToml = (await readFileOrNull(p.mcp)) ?? "";
      const existingMcp = readMcpFromToml(existingToml);
      for (const name of Object.keys(stack.mcpServers)) {
        if (name in existingMcp) {
          warnings.push(`MCP server "${name}" already exists in config.toml — overwriting with stack version`);
        }
      }
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
    agents: "inline",
  },
  detect,
  read,
  write,
};
