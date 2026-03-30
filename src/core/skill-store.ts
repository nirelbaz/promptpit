import path from "node:path";
import os from "node:os";
import { writeFileEnsureDir } from "../shared/utils.js";
import type { SkillEntry } from "../shared/schema.js";

export async function installCanonical(
  root: string,
  skills: SkillEntry[],
  opts?: { global?: boolean },
): Promise<Map<string, string>> {
  const base = opts?.global
    ? path.join(os.homedir(), ".agents", "skills")
    : path.join(root, ".agents", "skills");

  const pathMap = new Map<string, string>();

  for (const skill of skills) {
    const dest = path.join(base, skill.name, "SKILL.md");
    await writeFileEnsureDir(dest, skill.content);
    pathMap.set(skill.name, dest);
  }

  return pathMap;
}
