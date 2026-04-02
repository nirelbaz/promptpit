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
import { readFileOrNull, writeFileEnsureDir, exists, removeFileOrSymlink, symlinkOrCopy } from "../shared/utils.js";
import { readSkillsFromDir, readAgentsFromDir, readMcpFromSettings, writeWithMarkers, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, skillDryRunEntry } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "CLAUDE.md"),
    skills: path.join(root, ".claude", "skills"),
    mcp: path.join(root, ".claude", "settings.json"),
    agents: path.join(root, ".claude", "agents"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".claude", "CLAUDE.md"),
    skills: path.join(home, ".claude", "skills"),
    mcp: path.join(home, ".claude", "settings.json"),
    agents: path.join(home, ".claude", "agents"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.skills)) found.push(p.skills);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  let skills = await readSkillsFromDir(p.skills);

  // Fallback: scan repo root for */SKILL.md (handles repos like gstack
  // where the repo itself is a skills directory, not a project with .claude/skills/)
  if (skills.length === 0) {
    const rootSkills = await readSkillsFromDir(root);
    if (rootSkills.length > 0) {
      skills = rootSkills;
    }
  }
  const mcpServers = await readMcpFromSettings(p.mcp);
  const agents = await readAgentsFromDir(path.join(root, ".claude", "agents"));

  return {
    adapterId: "claude-code",
    agentInstructions,
    skills,
    agents,
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
    // Write agent instructions to CLAUDE.md
    if (stack.agentInstructions) {
      const result = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "claude-code",
        opts.dryRun,
      );
      if (result.written) filesWritten.push(result.written);
      if (opts.dryRun) {
        dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
      }
    }

    // Install skills (symlink from canonical location, or direct write as fallback)
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

    // Write agents to .claude/agents/
    for (const agent of stack.agents) {
      const dest = path.join(p.agents!, agent.name + ".md");
      if (opts.dryRun) {
        dryRunEntries.push({
          file: dest,
          action: (await exists(dest)) ? "modify" : "create",
        });
      } else {
        await writeFileEnsureDir(dest, agent.content);
        filesWritten.push(dest);
      }
    }

    // Write MCP config
    const mcpResult = await mergeMcpIntoJson(p.mcp, stack.mcpServers, warnings, opts.dryRun);
    if (mcpResult.written) filesWritten.push(mcpResult.written);
    const mcpCount = Object.keys(stack.mcpServers).length;
    if (opts.dryRun && mcpCount > 0) {
      dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, mcpResult, opts.verbose));
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "Claude Code paths");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}

export const claudeCodeAdapter: PlatformAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "symlink",
    rules: false,
    skillFormat: "skill.md",
    mcpStdio: true,
    mcpRemote: false,
    mcpFormat: "json",
    mcpRootKey: "mcpServers",
    agentsmd: false,
    hooks: true,
    agents: "native",
  },
  detect,
  read,
  write,
};
