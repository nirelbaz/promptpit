import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readMcpFromSettings } from "./adapter-utils.js";
import {
  hasMarkers,
  insertMarkers,
  replaceMarkerContent,
} from "../shared/markers.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, ".cursorrules"),
    skills: path.join(root, ".cursor", "rules"),
    mcp: path.join(root, ".cursor", "mcp.json"),
    rules: path.join(root, ".cursor", "rules"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".cursor", ".cursorrules"),
    skills: path.join(home, ".cursor", "rules"),
    mcp: path.join(home, ".cursor", "mcp.json"),
    rules: path.join(home, ".cursor", "rules"),
  };
}

export function skillToMdc(skillContent: string, skillName: string): string {
  const parsed = matter(skillContent);
  const fm = parsed.data as Record<string, unknown>;

  const mdcFrontmatter: Record<string, unknown> = {};
  if (fm.description) mdcFrontmatter.description = fm.description;
  if (fm.context) {
    mdcFrontmatter.globs = Array.isArray(fm.context)
      ? fm.context.join(",")
      : fm.context;
  }

  const fmLines = Object.entries(mdcFrontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `---\n${fmLines}\n---\n\n${parsed.content.trim()}\n`;
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.rules)) found.push(p.rules);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const mcpServers = await readMcpFromSettings(p.mcp, "mcpServers");

  const rules: string[] = [];
  if (await exists(p.rules)) {
    const mdcFiles = await fg("*.mdc", { cwd: p.rules, absolute: true });
    for (const file of mdcFiles) {
      const content = await readFileOrNull(file);
      if (content) rules.push(content);
    }
  }

  return {
    adapterId: "cursor",
    agentInstructions,
    skills: [],
    mcpServers,
    rules,
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
    if (stack.agentInstructions) {
      const existing = (await readFileOrNull(p.config)) ?? "";
      let updated: string;
      if (hasMarkers(existing, stackName)) {
        updated = replaceMarkerContent(
          existing,
          stack.agentInstructions,
          stackName,
          version,
          "cursor",
        );
      } else {
        updated = insertMarkers(
          existing,
          stack.agentInstructions,
          stackName,
          version,
          "cursor",
        );
      }
      if (!opts.dryRun) {
        await writeFileEnsureDir(p.config, updated);
        filesWritten.push(p.config);
      }
    }

    for (const skill of stack.skills) {
      const mdcContent = skillToMdc(skill.content, skill.name);
      const dest = path.join(p.rules!, `${skill.name}.mdc`);
      if (!opts.dryRun) {
        await writeFileEnsureDir(dest, mdcContent);
        filesWritten.push(dest);
      }
    }

    if (Object.keys(stack.mcpServers).length > 0) {
      const existingRaw = await readFileOrNull(p.mcp);
      let config: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          config = JSON.parse(existingRaw);
        } catch {
          warnings.push(`Could not parse existing ${p.mcp}, creating new`);
        }
      }
      config.mcpServers = {
        ...((config.mcpServers as Record<string, unknown>) ?? {}),
        ...stack.mcpServers,
      };
      if (!opts.dryRun) {
        await writeFileEnsureDir(p.mcp, JSON.stringify(config, null, 2));
        filesWritten.push(p.mcp);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        const target = opts.global ? "user-level" : "project-level";
        throw new Error(
          `Cannot write to ${target} Cursor paths. Check file permissions.`,
        );
      }
    }
    throw err;
  }

  return { filesWritten, filesSkipped: [], warnings };
}

export const cursorAdapter: PlatformAdapter = {
  id: "cursor",
  displayName: "Cursor",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skills: false,
    rules: true,
    skillFormat: "mdc",
    mcpStdio: true,
    mcpRemote: false,
    agentsmd: true,
    hooks: false,
  },
  detect,
  read,
  write,
};
