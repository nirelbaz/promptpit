import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import stripJsonComments from "strip-json-comments";
import type { SkillEntry, RuleEntry, McpConfig, McpServerConfig, AgentEntry, CommandEntry } from "../shared/schema.js";
import { computeMcpServerHash } from "../core/manifest.js";

// .vscode/ and .cursor/ ecosystems use JSONC (JSON with // and /* */ comments)
export function parseJsonc(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw));
}
import { skillFrontmatterSchema, ruleFrontmatterSchema, agentFrontmatterSchema } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists, removeFileOrSymlink, symlinkOrCopy } from "../shared/utils.js";
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

function formatYamlError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.split("\n")[0] ?? "YAML parse error";
  }
  return "YAML parse error";
}

function safeParseMatter(raw: string, relPath: string, label = ""): matter.GrayMatterFile<string> | null {
  try {
    return matter(raw, SAFE_MATTER_OPTIONS as never);
  } catch (err: unknown) {
    log.warn(`Skipping ${label}${relPath}: invalid frontmatter (${formatYamlError(err)})`);
    return null;
  }
}

export async function readSkillsFromDir(
  skillsDir: string,
  opts?: { includeStandalone?: boolean },
): Promise<SkillEntry[]> {
  const patterns = opts?.includeStandalone
    ? ["*/SKILL.md", "*.md"]
    : ["*/SKILL.md"];
  const skillFiles = await fg(patterns, {
    cwd: skillsDir,
    absolute: true,
  });

  const skills: SkillEntry[] = [];
  const seen = new Set<string>();

  // Directory-based skills first so they win name collisions with standalone files
  const dirFiles = skillFiles.filter((f) => path.basename(f) === "SKILL.md");
  const standaloneFiles = skillFiles.filter((f) => path.basename(f) !== "SKILL.md");

  for (const file of dirFiles) {
    const rel = path.relative(process.cwd(), file);
    const raw = await readFileOrNull(file);
    if (!raw) continue;
    const parsed = safeParseMatter(raw, rel);
    if (!parsed) continue;
    const validation = skillFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      log.warn(`Skipping ${rel}: invalid frontmatter (${validation.error.errors.map((e) => e.message).join(", ")})`);
      continue;
    }
    const skillName = path.basename(path.dirname(file));
    if (seen.has(skillName)) continue;
    seen.add(skillName);
    skills.push({ name: skillName, path: `skills/${skillName}`, frontmatter: validation.data, content: raw });
  }

  for (const file of standaloneFiles) {
    const rel = path.relative(process.cwd(), file);
    const raw = await readFileOrNull(file);
    if (!raw) continue;
    const parsed = safeParseMatter(raw, rel);
    if (!parsed) continue;
    const validation = skillFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      log.warn(`Skipping ${rel}: invalid frontmatter (${validation.error.errors.map((e) => e.message).join(", ")})`);
      continue;
    }
    const skillName = path.basename(file, ".md");
    if (seen.has(skillName)) continue;
    seen.add(skillName);
    skills.push({ name: skillName, path: `skills/${skillName}`, frontmatter: validation.data, content: raw });
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
    const rel = path.relative(process.cwd(), file);
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = safeParseMatter(raw, rel);
    if (!parsed) continue;
    const agentName = path.basename(file, file.endsWith(ext) ? ext : path.extname(file));
    const data = inferAgentDefaults(parsed.data as Record<string, unknown>, agentName, parsed.content);

    const validation = agentFrontmatterSchema.safeParse(data);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      log.warn(`Skipping ${rel}: invalid agent frontmatter (${reasons})`);
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
    const rel = path.relative(process.cwd(), file);
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = safeParseMatter(raw, rel, "rule ");
    if (!parsed) continue;
    const ruleName = path.basename(file, ".md");

    const dataWithDefaults = inferRuleDefaults(parsed.data as Record<string, unknown>, ruleName);
    const validation = ruleFrontmatterSchema.safeParse(dataWithDefaults);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      log.warn(`Skipping rule ${rel}: invalid frontmatter (${reasons})`);
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

export async function readCommandsFromDir(
  commandsDir: string,
  opts: { glob?: string; ext?: string } = {},
): Promise<CommandEntry[]> {
  const pattern = opts.glob ?? "**/*.md";
  const ext = opts.ext ?? ".md";

  const commandFiles = await fg(pattern, {
    cwd: commandsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const commands: CommandEntry[] = [];
  for (const file of commandFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const relPath = path.relative(commandsDir, file);
    const commandName = relPath.endsWith(ext)
      ? relPath.slice(0, -ext.length)
      : relPath.slice(0, -path.extname(relPath).length);

    commands.push({
      name: commandName,
      path: `commands/${commandName}`,
      content: raw,
    });
  }
  return commands;
}

export function detectCommandParamSyntax(
  content: string,
): "claude-code" | "cursor" | "copilot" | null {
  if (/\$ARGUMENTS/.test(content)) return "claude-code";
  if (/\$\{input:[^}]+\}/.test(content)) return "copilot";
  if (/\$\d+/.test(content)) return "cursor";
  return null;
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
    const settings = parseJsonc(raw) as Record<string, McpConfig>;
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
      config = parseJsonc(existingRaw) as Record<string, unknown>;
    } catch {
      warnings.push(`Could not parse existing ${filePath}, creating new`);
    }
  }
  const existed = existingRaw != null;
  const currentMcp = (config.mcpServers as Record<string, unknown>) ?? {};
  if (!dryRun) {
    warnMcpOverwrites(mcpServers, currentMcp as Record<string, McpServerConfig>, filePath, warnings);
  }
  config.mcpServers = { ...currentMcp, ...mcpServers };
  const newContent = JSON.stringify(config, null, 2) + "\n";

  if (dryRun) return { written: null, existed, oldContent: existingRaw ?? undefined, newContent };
  await writeFileEnsureDir(filePath, newContent);
  return { written: filePath, existed };
}

// Warn about MCP overwrites, but skip when content is identical (idempotent re-install).
// Uses computeMcpServerHash for key-order-independent comparison.
export function warnMcpOverwrites(
  incoming: McpConfig,
  existing: Record<string, McpServerConfig>,
  label: string,
  warnings: string[],
): void {
  for (const [name, server] of Object.entries(incoming)) {
    if (name in existing) {
      if (computeMcpServerHash(server) !== computeMcpServerHash(existing[name]!)) {
        warnings.push(`MCP server "${name}" already exists in ${label} — overwriting with stack version`);
      }
    }
  }
}

// Resolve rule destination path, preferring an existing unprefixed file over creating
// a new rule-prefixed one (prevents duplication when re-installing over collected rules).
export async function resolveRuleDest(
  rulesDir: string,
  ruleName: string,
  ext: string,
): Promise<string> {
  const prefixedName = ruleName.startsWith("rule-") ? ruleName : `rule-${ruleName}`;
  if (!ruleName.startsWith("rule-")) {
    const unprefixedDest = path.join(rulesDir, `${ruleName}${ext}`);
    if (await exists(unprefixedDest)) return unprefixedDest;
  }
  return path.join(rulesDir, `${prefixedName}${ext}`);
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

// Shared skill write loop for symlink-strategy adapters (claude-code, codex, cursor).
// Symlinks from canonical .agents/skills/ when canonicalSkillPaths is provided,
// falls back to direct file write otherwise.
export async function writeSkillsNative(
  skillsDir: string,
  skills: SkillEntry[],
  opts: { dryRun?: boolean; canonicalSkillPaths?: Map<string, string> },
  dryRunEntries: DryRunEntry[],
  filesWritten: string[],
): Promise<void> {
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    const dest = path.join(skillDir, "SKILL.md");
    if (opts.dryRun) {
      dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "symlink"));
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
    ...(verbose && {
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
    ...(verbose && mcpResult.newContent != null && {
      oldContent: mcpResult.oldContent ?? "",
      newContent: mcpResult.newContent,
    }),
  };
}
