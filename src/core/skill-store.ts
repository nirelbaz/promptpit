import path from "node:path";
import os from "node:os";
import { writeFileEnsureDir, writeFileBufferEnsureDir } from "../shared/utils.js";
import type { SkillEntry } from "../shared/schema.js";

export function canonicalSkillBase(root: string, global?: boolean): string {
  return global
    ? path.join(os.homedir(), ".agents", "skills")
    : path.join(root, ".agents", "skills");
}

export async function installCanonical(
  root: string,
  skills: SkillEntry[],
  opts?: { global?: boolean },
): Promise<Map<string, string>> {
  const base = canonicalSkillBase(root, opts?.global);

  const pathMap = new Map<string, string>();

  for (const skill of skills) {
    const dest = path.join(base, skill.name, "SKILL.md");
    await writeFileEnsureDir(dest, skill.content);
    pathMap.set(skill.name, dest);

    const skillDir = path.join(base, skill.name);
    for (const file of skill.supportingFiles ?? []) {
      const resolved = path.resolve(skillDir, file.relativePath);
      if (!resolved.startsWith(skillDir + path.sep)) continue;
      await writeFileBufferEnsureDir(resolved, file.content);
    }
  }

  return pathMap;
}
