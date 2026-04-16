import { readdir } from "node:fs/promises";
import { computeHash } from "./manifest.js";
import { readFileOrNull, removeFileOrSymlink } from "../shared/utils.js";
import type { InstallManifest } from "../shared/schema.js";

// Check if any other installed stack references this skill (across all adapters)
export function isSkillShared(
  manifest: InstallManifest,
  stackName: string,
  skillName: string,
): boolean {
  return manifest.installs
    .filter((e) => e.stack !== stackName)
    .some((e) =>
      Object.values(e.adapters).some((a) => a.skills?.[skillName]),
    );
}

// Check if any other installed stack references this artifact for the same adapter
export function isArtifactShared(
  manifest: InstallManifest,
  stackName: string,
  adapterId: string,
  artifactType: "agents" | "rules" | "commands" | "mcp",
  artifactName: string,
): boolean {
  return manifest.installs
    .filter((e) => e.stack !== stackName)
    .some((e) => e.adapters[adapterId]?.[artifactType]?.[artifactName]);
}

// Resolve the agent file name for a given adapter
export function agentFileName(adapterId: string, name: string): string {
  if (adapterId === "codex") return `${name}.toml`;
  if (adapterId === "copilot") return `${name}.agent.md`;
  return `${name}.md`;
}

// Resolve possible rule file names (handles rule- prefix convention)
export function ruleFileNames(adapterId: string, name: string): string[] {
  switch (adapterId) {
    case "cursor":
      return [`${name}.mdc`, `rule-${name}.mdc`];
    case "copilot":
      return [`${name}.instructions.md`, `rule-${name}.instructions.md`];
    case "claude-code":
      return [`${name}.md`, `rule-${name}.md`];
    default:
      return [];
  }
}

// Remove a file if its hash matches the manifest hash (or force is set)
export async function removeCheckedFile(
  filePath: string,
  manifestHash: string,
  opts: { force?: boolean; dryRun?: boolean },
): Promise<"removed" | "skipped-modified" | "skipped-missing"> {
  const content = await readFileOrNull(filePath);
  if (content == null) return "skipped-missing";

  if (!opts.force) {
    const currentHash = computeHash(content);
    if (currentHash !== manifestHash) return "skipped-modified";
  }

  if (!opts.dryRun) await removeFileOrSymlink(filePath);
  return "removed";
}

// Try to remove an empty directory (no-op if not empty or doesn't exist)
export async function removeEmptyDir(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath);
    if (entries.length === 0) {
      await removeFileOrSymlink(dirPath);
    }
  } catch {
    // Directory doesn't exist — fine
  }
}
