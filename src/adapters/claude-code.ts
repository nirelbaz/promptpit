import path from "node:path";
import { homedir } from "node:os";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists, removeFileOrSymlink, symlinkOrCopy } from "../shared/utils.js";
import { readSkillsFromDir, readMcpFromSettings, writeWithMarkers } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "CLAUDE.md"),
    skills: path.join(root, ".claude", "skills"),
    mcp: path.join(root, ".claude", "settings.json"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".claude", "CLAUDE.md"),
    skills: path.join(home, ".claude", "skills"),
    mcp: path.join(home, ".claude", "settings.json"),
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

  return {
    adapterId: "claude-code",
    agentInstructions,
    skills,
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
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    // Write agent instructions to CLAUDE.md
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "claude-code",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }

    // Install skills (symlink from canonical location, or direct write as fallback)
    for (const skill of stack.skills) {
      const skillDir = path.join(p.skills, skill.name);
      const dest = path.join(skillDir, "SKILL.md");
      if (!opts.dryRun) {
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

    // Write MCP config
    if (Object.keys(stack.mcpServers).length > 0) {
      const existingRaw = await readFileOrNull(p.mcp);
      let settings: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          settings = JSON.parse(existingRaw);
        } catch {
          warnings.push(`Could not parse existing ${p.mcp}, creating new`);
        }
      }
      settings.mcpServers = {
        ...((settings.mcpServers as Record<string, unknown>) ?? {}),
        ...stack.mcpServers,
      };

      if (!opts.dryRun) {
        await writeFileEnsureDir(p.mcp, JSON.stringify(settings, null, 2));
        filesWritten.push(p.mcp);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        const target = opts.global ? "user-level" : "project-level";
        throw new Error(
          `Cannot write to ${target} paths. Check file permissions.\n` +
            `Attempted path: ${(err as NodeJS.ErrnoException).path ?? "unknown"}`,
        );
      }
    }
    throw err;
  }

  return { filesWritten, filesSkipped: [], warnings };
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
    agentsmd: false,
    hooks: true,
  },
  detect,
  read,
  write,
};
