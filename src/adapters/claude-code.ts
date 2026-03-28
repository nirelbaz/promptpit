import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle, SkillEntry, McpConfig } from "../shared/schema.js";
import { skillFrontmatterSchema } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import {
  hasMarkers,
  insertMarkers,
  replaceMarkerContent,
} from "../shared/markers.js";
import { log } from "../shared/io.js";

// Safe YAML parsing — prevents !!js/function RCE from untrusted SKILL.md
const SAFE_MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }),
      stringify: (obj: unknown) => yaml.dump(obj),
    },
  },
};

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

async function readSkills(skillsDir: string): Promise<SkillEntry[]> {
  const skillFiles = await fg("*/SKILL.md", {
    cwd: skillsDir,
    absolute: true,
  });

  const skills: SkillEntry[] = [];
  for (const file of skillFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const validation = skillFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      log.warn(`Skipping ${file}: invalid frontmatter`);
      continue;
    }

    const skillName = path.basename(path.dirname(file));
    skills.push({
      name: skillName,
      path: `skills/${skillName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return skills;
}

async function readMcpConfig(mcpPath: string): Promise<McpConfig> {
  const raw = await readFileOrNull(mcpPath);
  if (!raw) return {};

  try {
    const settings = JSON.parse(raw);
    return settings.mcpServers ?? {};
  } catch {
    log.warn(`Could not parse ${mcpPath}`);
    return {};
  }
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const skills = (await exists(p.skills)) ? await readSkills(p.skills) : [];
  const mcpServers = await readMcpConfig(p.mcp);

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
      const existing = (await readFileOrNull(p.config)) ?? "";

      let updated: string;
      if (hasMarkers(existing, stackName)) {
        updated = replaceMarkerContent(
          existing,
          stack.agentInstructions,
          stackName,
          version,
          "claude-code",
        );
      } else {
        updated = insertMarkers(
          existing,
          stack.agentInstructions,
          stackName,
          version,
          "claude-code",
        );
      }

      if (!opts.dryRun) {
        await writeFileEnsureDir(p.config, updated);
        filesWritten.push(p.config);
      }
    }

    // Copy skills
    for (const skill of stack.skills) {
      const dest = path.join(p.skills, skill.name, "SKILL.md");
      if (!opts.dryRun) {
        await writeFileEnsureDir(dest, skill.content);
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
    skills: true,
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
