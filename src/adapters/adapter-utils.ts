import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import type { SkillEntry, RuleEntry, McpConfig } from "../shared/schema.js";
import { skillFrontmatterSchema, ruleFrontmatterSchema } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";
import { log } from "../shared/io.js";
import { hasMarkers, insertMarkers, replaceMarkerContent } from "../shared/markers.js";
import type { DryRunEntry } from "./types.js";

// Safe YAML parsing — prevents !!js/function RCE from untrusted SKILL.md (eng review #12)
export const SAFE_MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }),
      stringify: (obj: unknown) => yaml.dump(obj),
    },
  },
};

export async function readSkillsFromDir(
  skillsDir: string,
): Promise<SkillEntry[]> {
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
      const reasons = validation.error.errors.map((e) => e.message).join(", ");
      log.warn(`Skipping ${file}: invalid frontmatter (${reasons})`);
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

export async function readRulesFromDir(
  rulesDir: string,
): Promise<RuleEntry[]> {
  const ruleFiles = await fg("*.md", {
    cwd: rulesDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const rules: RuleEntry[] = [];
  for (const file of ruleFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const validation = ruleFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => e.message).join(", ");
      log.warn(`Skipping rule ${file}: invalid frontmatter (${reasons})`);
      continue;
    }

    const ruleName = path.basename(file, ".md");
    rules.push({
      name: ruleName,
      path: `rules/${ruleName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return rules;
}

export async function readMcpFromSettings(
  settingsPath: string,
  mcpKey = "mcpServers",
): Promise<McpConfig> {
  const raw = await readFileOrNull(settingsPath);
  if (!raw) return {};

  try {
    const settings = JSON.parse(raw);
    return settings[mcpKey] ?? {};
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    log.warn(`Could not parse ${settingsPath}: ${msg}`);
    return {};
  }
}

export interface MergeMcpResult {
  written: string | null;
  existed: boolean;
  oldContent?: string;
  newContent?: string;
}

export async function mergeMcpIntoJson(
  filePath: string,
  mcpServers: McpConfig,
  warnings: string[],
  dryRun?: boolean,
): Promise<MergeMcpResult> {
  if (Object.keys(mcpServers).length === 0) return { written: null, existed: false };

  const existingRaw = await readFileOrNull(filePath);
  let config: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      config = JSON.parse(existingRaw);
    } catch {
      warnings.push(`Could not parse existing ${filePath}, creating new`);
    }
  }
  const existed = existingRaw != null;
  const currentMcp = (config.mcpServers as Record<string, unknown>) ?? {};
  if (!dryRun) {
    for (const name of Object.keys(mcpServers)) {
      if (name in currentMcp) {
        warnings.push(`MCP server "${name}" already exists in ${filePath} — overwriting with stack version`);
      }
    }
  }
  config.mcpServers = { ...currentMcp, ...mcpServers };
  const newContent = JSON.stringify(config, null, 2) + "\n";

  if (dryRun) return { written: null, existed, oldContent: existingRaw ?? undefined, newContent };
  await writeFileEnsureDir(filePath, newContent);
  return { written: filePath, existed };
}

export function rethrowPermissionError(
  err: unknown,
  isGlobal: boolean,
  label: string,
): never {
  if (err instanceof Error && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      const target = isGlobal ? "user-level" : "project-level";
      throw new Error(
        `Cannot write to ${target} ${label}. Check file permissions.`,
      );
    }
  }
  throw err;
}

export interface WriteWithMarkersResult {
  written: string | null;
  content: string;
  oldContent: string;
  existed: boolean;
}

export async function writeWithMarkers(
  filePath: string,
  content: string,
  stackName: string,
  version: string,
  adapterId: string,
  dryRun?: boolean,
): Promise<WriteWithMarkersResult> {
  const existing = (await readFileOrNull(filePath)) ?? "";
  const existed = existing.length > 0;

  let updated: string;
  if (hasMarkers(existing, stackName)) {
    updated = replaceMarkerContent(existing, content, stackName, version, adapterId);
  } else {
    updated = insertMarkers(existing, content, stackName, version, adapterId);
  }

  if (dryRun) {
    return { written: null, content: updated, oldContent: existing, existed };
  }

  await writeFileEnsureDir(filePath, updated);
  return { written: filePath, content: updated, oldContent: existing, existed };
}

export function fileDryRunEntry(
  dest: string,
  fileExists: boolean,
  detail?: string,
): DryRunEntry {
  return {
    file: dest,
    action: fileExists ? "modify" : "create",
    detail,
  };
}

export function markersDryRunEntry(
  filePath: string,
  result: WriteWithMarkersResult,
  verbose?: boolean,
): DryRunEntry {
  return {
    file: filePath,
    action: result.existed ? "modify" : "create",
    detail: result.existed ? "update marker block" : "insert marker block",
    ...(verbose && result.existed && {
      oldContent: result.oldContent,
      newContent: result.content,
    }),
  };
}

export function mcpDryRunEntry(
  filePath: string,
  serverCount: number,
  mcpResult: MergeMcpResult,
  verbose?: boolean,
): DryRunEntry {
  return {
    file: filePath,
    action: mcpResult.existed ? "modify" : "create",
    detail: `add ${serverCount} MCP server${serverCount !== 1 ? "s" : ""}`,
    ...(verbose && mcpResult.existed && mcpResult.oldContent != null && {
      oldContent: mcpResult.oldContent,
      newContent: mcpResult.newContent,
    }),
  };
}
