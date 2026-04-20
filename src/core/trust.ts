import path from "node:path";
import { createHash } from "node:crypto";
import { rename, mkdir } from "node:fs/promises";
import { trustSchema, type PitTrust } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";
import { log } from "../shared/io.js";

const TRUST_SUBPATH = ".promptpit/trust.json";
const PREVIEW_CAP = 256 * 1024;
const HARD_CAP   = 1 * 1024 * 1024;

function trustPath(home: string): string { return path.join(home, TRUST_SUBPATH); }

export function hashScript(content: string): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

export type ScriptCategory = "previewable" | "too-large-to-preview" | "too-large-to-run";

export function classifyScript(content: string): { category: ScriptCategory; byteLength: number } {
  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > HARD_CAP) return { category: "too-large-to-run", byteLength };
  if (byteLength > PREVIEW_CAP) return { category: "too-large-to-preview", byteLength };
  return { category: "previewable", byteLength };
}

export async function loadTrust(
  home: string,
  opts: { silent?: boolean } = {},
): Promise<PitTrust> {
  const raw = await readFileOrNull(trustPath(home));
  if (!raw) return trustSchema.parse({ version: 1 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    if (!opts.silent) log.warn(`Trust store at ${trustPath(home)} is invalid JSON. Using empty trust in memory. Inspect the file manually — pit will not auto-overwrite it.`);
    return trustSchema.parse({ version: 1 });
  }
  const result = trustSchema.safeParse(parsed);
  if (!result.success) {
    if (!opts.silent) log.warn(`Trust store at ${trustPath(home)} failed schema validation. Using empty trust.`);
    return trustSchema.parse({ version: 1 });
  }
  return result.data;
}

export async function saveTrust(home: string, trust: PitTrust): Promise<void> {
  const validated = trustSchema.parse(trust);
  const dest = trustPath(home);
  const tmp = dest + ".tmp";
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFileEnsureDir(tmp, JSON.stringify(validated, null, 2) + "\n");
  await rename(tmp, dest);
}

export function trustSource(
  trust: PitTrust,
  source: string,
  scripts: Record<string, string>,
): PitTrust {
  return {
    ...trust,
    trusted: {
      ...trust.trusted,
      [source]: { trustedAt: new Date().toISOString(), scripts },
    },
  };
}

export function forgetSource(trust: PitTrust, source: string): PitTrust {
  const next = { ...trust.trusted };
  delete next[source];
  return { ...trust, trusted: next };
}

export function isTrusted(trust: PitTrust, source: string, phase: string, hash: string): boolean {
  return trust.trusted[source]?.scripts[phase] === hash;
}
