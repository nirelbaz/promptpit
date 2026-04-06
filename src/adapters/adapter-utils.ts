import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import type { SkillEntry, RuleEntry, McpConfig, AgentEntry } from "../shared/schema.js";
import { skillFrontmatterSchema, ruleFrontmatterSchema, agentFrontmatterSchema } from "../shared/schema.js";
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

// Infer missing name/description from filename and body content.
// Shared between readAgentsFromDir and validateStack.
export function inferAgentDefaults(
  data: Record<string, unknown>,
  nameFromFile: string,
  bodyContent: string,
): Record<string, unknown> {
  const result = { ...data };
  if (!result.name) result.name = nameFromFile;
  if (!result.description) {
    const firstLine = bodyContent
      .split("\n")
      .find((l) => { const t = l.trim(); return t.length > 0 && !t.startsWith("#"); })
      ?.trim();
    if (firstLine) result.description = firstLine.slice(0, 200);
  }
  return result;
}

// Inject name from filename when missing. Shared between readRulesFromDir and validateStack.
export function inferRuleDefaults(
  data: Record<string, unknown>,
  nameFromFile: string,
): Record<string, unknown> {
  return { ...data, name: data.name ?? nameFromFile };
}

export async function readAgentsFromDir(
  agentsDir: string,
  opts: { glob?: string; ext?: string } = {},
): Promise<AgentEntry[]> {
  const pattern = opts.glob ?? "*.md";
  const ext = opts.ext ?? ".md";

  const agentFiles = await fg(pattern, {
    cwd: agentsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const agents: AgentEntry[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const agentName = path.basename(file, file.endsWith(ext) ? ext : path.extname(file));
    const data = inferAgentDefaults(parsed.data as Record<string, unknown>, agentName, parsed.content);

    const validation = agentFrontmatterSchema.safeParse(data);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      log.warn(`Skipping ${file}: invalid agent frontmatter (${reasons})`);
      continue;
    }

    // Rebuild content with inferred frontmatter so round-trips preserve name
    let content = raw;
    if (!parsed.data.name || !parsed.data.description) {
      content = matter.stringify(parsed.content.trim() + "\n", validation.data);
    }

    agents.push({
      name: agentName,
      path: `agents/${agentName}`,
      frontmatter: validation.data,
      content,
    });
  }
  return agents;
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
    const ruleName = path.basename(file, ".md");

    const dataWithDefaults = inferRuleDefaults(parsed.data as Record<string, unknown>, ruleName);
    const validation = ruleFrontmatterSchema.safeParse(dataWithDefaults);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      log.warn(`Skipping rule ${file}: invalid frontmatter (${reasons})`);
      continue;
    }

    rules.push({
      name: ruleName,
      path: `rules/${ruleName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return rules;
}

// Strip YAML frontmatter fences without re-parsing through gray-matter
function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n*/);
  return match ? raw.slice(match[0].length).trim() : raw.trim();
}

export function formatAgentsInlineSection(agents: AgentEntry[]): string {
  if (agents.length === 0) return "";

  const sections = agents.map((agent) => {
    const fm = agent.frontmatter;
    const body = stripFrontmatter(agent.content);

    let header = `### ${fm.name}\n> ${fm.description}`;
    if (fm.tools && fm.tools.length > 0) {
      header += `\n> Tools: ${fm.tools.join(", ")}`;
    }

    return `${header}\n\n${body}`;
  });

  return `## Custom Agents\n\n${sections.join("\n\n")}`;
}

// Build marker content with optional inline agents section
export function buildInlineContent(agentInstructions: string, agents: AgentEntry[]): string | null {
  if (!agentInstructions && agents.length === 0) return null;
  let content = agentInstructions || "";
  const agentSection = formatAgentsInlineSection(agents);
  if (agentSection) {
    content = content ? `${content}\n\n${agentSection}` : agentSection;
  }
  return content;
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
