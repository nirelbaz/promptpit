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
import {
  readFileOrNull,
  writeFileEnsureDir,
  exists,
  removeFileOrSymlink,
  symlinkOrCopy,
} from "../shared/utils.js";
import { readSkillsFromDir, writeWithMarkers } from "./adapter-utils.js";
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
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.skills)) found.push(p.skills);
  if (await exists(p.mcp)) found.push(p.mcp);

  // Also detect .codex/ directory itself
  const codexDir = path.join(root, ".codex");
  if (found.length === 0 && (await exists(codexDir))) {
    found.push(codexDir);
  }

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const skills = await readSkillsFromDir(p.skills);

  // Read MCP from TOML config
  const tomlContent = (await readFileOrNull(p.mcp)) ?? "";
  const mcpServers = readMcpFromToml(tomlContent);

  return {
    adapterId: "codex",
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
    // Write agent instructions to AGENTS.md
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "codex",
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

    // Write MCP config to config.toml
    if (Object.keys(stack.mcpServers).length > 0 && !opts.dryRun) {
      const existingToml = (await readFileOrNull(p.mcp)) ?? "";
      const updated = writeMcpToToml(existingToml, stack.mcpServers);
      await writeFileEnsureDir(p.mcp, updated);
      filesWritten.push(p.mcp);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        const target = opts.global ? "user-level" : "project-level";
        throw new Error(
          `Cannot write to ${target} Codex CLI paths. Check file permissions.\n` +
            `Attempted path: ${(err as NodeJS.ErrnoException).path ?? "unknown"}`,
        );
      }
    }
    throw err;
  }

  return { filesWritten, filesSkipped: [], warnings };
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
    agentsmd: true,
    hooks: false,
  },
  detect,
  read,
  write,
};
