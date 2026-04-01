import path from "node:path";
import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
import { installManifestSchema } from "../shared/schema.js";
import type { InstallManifest, InstallEntry } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";

const MANIFEST_FILE = "installed.json";

function manifestPath(root: string): string {
  return path.join(root, ".promptpit", MANIFEST_FILE);
}

export function emptyManifest(): InstallManifest {
  return { version: 1, installs: [] };
}

export async function readManifest(root: string): Promise<InstallManifest> {
  const raw = await readFileOrNull(manifestPath(root));
  if (!raw) return emptyManifest();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Corrupt manifest at ${manifestPath(root)}: invalid JSON. ` +
        `Delete the file and run \`pit install\` again.`,
    );
  }

  const result = installManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid manifest at ${manifestPath(root)}: ${result.error.errors.map((e) => e.message).join(", ")}. ` +
        `Delete the file and run \`pit install\` again.`,
    );
  }

  return result.data;
}

// Atomic write: write to .tmp then rename
export async function writeManifest(
  root: string,
  manifest: InstallManifest,
): Promise<void> {
  const dest = manifestPath(root);
  const tmp = dest + ".tmp";
  await writeFileEnsureDir(tmp, JSON.stringify(manifest, null, 2) + "\n");
  await rename(tmp, dest);
}

// Upsert: same stack name replaces, different stack name appends
export function upsertInstall(
  manifest: InstallManifest,
  entry: InstallEntry,
): InstallManifest {
  const filtered = manifest.installs.filter((e) => e.stack !== entry.stack);
  return { ...manifest, installs: [...filtered, entry] };
}

export function computeHash(content: string): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

// Normalize content for hash comparison (instructions may have whitespace diffs)
export function normalizeForHash(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}
