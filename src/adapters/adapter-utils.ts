import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import type { SkillEntry, McpConfig } from "../shared/schema.js";
import { skillFrontmatterSchema } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";
import { log } from "../shared/io.js";
import { hasMarkers, insertMarkers, replaceMarkerContent } from "../shared/markers.js";

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

export async function writeWithMarkers(
  filePath: string,
  content: string,
  stackName: string,
  version: string,
  adapterId: string,
  dryRun?: boolean,
): Promise<string | null> {
  const existing = (await readFileOrNull(filePath)) ?? "";

  let updated: string;
  if (hasMarkers(existing, stackName)) {
    updated = replaceMarkerContent(
      existing,
      content,
      stackName,
      version,
      adapterId,
    );
  } else {
    updated = insertMarkers(existing, content, stackName, version, adapterId);
  }

  if (dryRun) {
    return null;
  }

  await writeFileEnsureDir(filePath, updated);
  return filePath;
}
