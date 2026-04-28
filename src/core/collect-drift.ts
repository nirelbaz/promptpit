import path from "node:path";
import { mkdir, cp, rm } from "node:fs/promises";
import matter from "gray-matter";
import { reconcileAll, type ArtifactType, type ReconciledArtifact, type ReconcileOutput, type ReconcileResult } from "./reconcile.js";
import { readManifest, writeManifest } from "./manifest.js";
import { readFileOrNull, writeFileEnsureDir, exists, errorMessage } from "../shared/utils.js";
import { tryReadMcpConfig } from "./stack.js";
import { getAdapter } from "../adapters/registry.js";
import { readMcpFromToml } from "../adapters/toml-utils.js";
import { parseJsonc, SAFE_MATTER_OPTIONS } from "../adapters/adapter-utils.js";
import type { DryRunEntry } from "../adapters/types.js";
import type {
  AdapterInstallRecord,
  InstallManifest,
  McpServerConfig,
} from "../shared/schema.js";

/** A drifted artifact the user chose to accept back into the bundle. */
export interface CollectDriftSelection {
  adapterId: string;
  type: ArtifactType;
  name: string;
}

export interface CollectDriftAccepted {
  adapterId: string;
  type: ArtifactType;
  name: string;
  bundlePath: string;
}

export interface CollectDriftSkipped {
  adapterId: string;
  type: ArtifactType;
  name: string;
  reason: string;
}

export interface CollectDriftResult {
  outputDir: string;
  /** What we wrote / would write to the bundle. */
  accepted: CollectDriftAccepted[];
  /** Selected items we couldn't apply (no longer drifted, missing source, …). */
  skipped: CollectDriftSkipped[];
  manifestUpdated: boolean;
  dryRun: boolean;
  /** Files touched (or that would be on dry-run). */
  plannedFiles?: DryRunEntry[];
}

/** Pull *local edits to installed artifacts* back into the bundle as the new
 *  source of truth. Scoped to the artifacts the caller selects and only those
 *  already tracked in `installed.json` (the user can't smuggle untracked files
 *  in this way — that's `pit collect` territory).
 *
 *  Writes adapter-format content to the bundle. The `pit install` translator
 *  is deliberately idempotent on already-translated content, so a rule
 *  collected from cursor's `.mdc` round-trips through the bundle and reinstalls
 *  cleanly. */
export async function collectDriftBack(
  root: string,
  selection: CollectDriftSelection[],
  opts: { dryRun?: boolean } = {},
): Promise<CollectDriftResult> {
  const outputDir = path.join(root, ".promptpit");
  const manifest = await readManifest(root);
  if (manifest.installs.length === 0) {
    throw new Error("No stacks installed; nothing to collect drift from.");
  }

  const reconcile = await reconcileAll(root);
  if (!reconcile.hasManifest || reconcile.stacks.length === 0) {
    throw new Error("No installed stacks to reconcile.");
  }

  const accepted: CollectDriftAccepted[] = [];
  const skipped: CollectDriftSkipped[] = [];
  const plannedFiles: DryRunEntry[] = [];
  // Mutable working copy of the manifest — we rehash records as we apply
  // selections, then write the whole thing once at the end.
  const nextManifest: InstallManifest = structuredClone(manifest);

  for (const sel of selection) {
    const stack = pickStackForAdapter(reconcile.stacks, sel.adapterId);
    const adapterReconcile = stack?.adapters.find((a) => a.adapterId === sel.adapterId);
    const artifact = adapterReconcile?.artifacts.find(
      (a) => a.type === sel.type && a.name === sel.name,
    );
    if (!stack || !artifact) {
      skipped.push({ ...sel, reason: "not found in current install" });
      continue;
    }
    if (artifact.state !== "drifted") {
      skipped.push({ ...sel, reason: `artifact is ${artifact.state}, not drifted` });
      continue;
    }

    const installEntry = nextManifest.installs.find((e) => e.stack === stack.stack);
    const adapterRecord = installEntry?.adapters[sel.adapterId];
    if (!installEntry || !adapterRecord) {
      skipped.push({ ...sel, reason: "missing manifest record" });
      continue;
    }

    try {
      const change = await applyDriftBack({
        root,
        outputDir,
        adapterId: sel.adapterId,
        artifact,
        dryRun: !!opts.dryRun,
      });
      if (!change) {
        skipped.push({ ...sel, reason: "could not read source" });
        continue;
      }
      plannedFiles.push(change);
      accepted.push({
        adapterId: sel.adapterId,
        type: sel.type,
        name: sel.name,
        bundlePath: change.file,
      });

      // Rehash the manifest record so this artifact reads as `synced` after
      // writing. The new hash is the on-disk content's hash, captured by
      // reconcile when it computed `actualHash`.
      if (artifact.actualHash) {
        rehashManifestRecord(adapterRecord, sel.type, sel.name, artifact.actualHash);
      }
    } catch (err: unknown) {
      skipped.push({ ...sel, reason: errorMessage(err) });
    }
  }

  const manifestUpdated = accepted.length > 0;

  if (!opts.dryRun && manifestUpdated) {
    await writeManifest(root, nextManifest);
  }

  return {
    outputDir,
    accepted,
    skipped,
    manifestUpdated,
    dryRun: !!opts.dryRun,
    plannedFiles: opts.dryRun ? plannedFiles : undefined,
  };
}

function pickStackForAdapter(
  stacks: ReconcileOutput["stacks"],
  adapterId: string,
): ReconcileResult | undefined {
  // Multi-install in one project is an open question (CHUNK2 known-unknown
  // #3). v0.5.5 ships single-install only. Pick the first stack whose adapter
  // map contains the requested id; a UI flash above this layer warns when
  // multiple installs are detected.
  return stacks.find((s) => s.adapters.some((a) => a.adapterId === adapterId));
}

interface ApplyArgs {
  root: string;
  outputDir: string;
  adapterId: string;
  artifact: ReconciledArtifact;
  dryRun: boolean;
}

async function applyDriftBack(args: ApplyArgs): Promise<DryRunEntry | null> {
  const { root, outputDir, adapterId, artifact, dryRun } = args;

  switch (artifact.type) {
    case "skill":
      return applySkillDrift({ root, outputDir, name: artifact.name, dryRun });
    case "instructions":
      return applyInstructionsDrift({ outputDir, artifact, dryRun });
    case "mcp":
      return applyMcpDrift({ adapterId, outputDir, artifact, dryRun });
    case "rule":
      return applyContentDrift({
        outputDir,
        subdir: "rules",
        name: artifact.name,
        artifact,
        dryRun,
      });
    case "command":
      return applyContentDrift({
        outputDir,
        subdir: "commands",
        name: artifact.name,
        artifact,
        dryRun,
      });
    case "agent":
      return applyContentDrift({
        outputDir,
        subdir: "agents",
        name: artifact.name,
        artifact,
        dryRun,
      });
    default:
      return null;
  }
}

// --- Skill: copy from canonical store to bundle ---

async function applySkillDrift({
  root,
  outputDir,
  name,
  dryRun,
}: {
  root: string;
  outputDir: string;
  name: string;
  dryRun: boolean;
}): Promise<DryRunEntry | null> {
  const sourceDir = path.join(root, ".agents", "skills", name);
  const targetDir = path.join(outputDir, "skills", name);
  const sourceSkillMd = path.join(sourceDir, "SKILL.md");
  if (!(await exists(sourceSkillMd))) return null;

  const action: DryRunEntry["action"] = (await exists(targetDir)) ? "modify" : "create";
  if (!dryRun) {
    // Wipe the destination first: cp doesn't prune, so previously-tracked
    // supporting files that no longer exist upstream would otherwise linger.
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
  }
  return { file: targetDir, action, detail: "skill (canonical → bundle)" };
}

// --- Instructions: extract marker from adapter's config file ---

async function applyInstructionsDrift({
  outputDir,
  artifact,
  dryRun,
}: {
  outputDir: string;
  artifact: ReconciledArtifact;
  dryRun: boolean;
}): Promise<DryRunEntry | null> {
  const content = artifact.actualContent;
  if (content == null) return null;

  const targetFile = path.join(outputDir, "agent.promptpit.md");
  const action: DryRunEntry["action"] = (await exists(targetFile)) ? "modify" : "create";

  if (!dryRun) {
    // Preserve any existing frontmatter — only rewrite the body. If the
    // bundle has no agent.promptpit.md yet, skip; collect-drift only updates
    // tracked artifacts, and an instructions record without a bundle file is
    // a corrupt-state edge case (Chunk 3 territory).
    const existing = await readFileOrNull(targetFile);
    if (existing == null) return null;
    const parsed = matter(existing, SAFE_MATTER_OPTIONS as never);
    const next = matter.stringify(content, parsed.data);
    await writeFileEnsureDir(targetFile, next);
  }
  return { file: targetFile, action, detail: "instructions" };
}

// --- MCP: read adapter file, extract server config, merge into bundle mcp.json ---

async function applyMcpDrift({
  adapterId,
  outputDir,
  artifact,
  dryRun,
}: {
  adapterId: string;
  outputDir: string;
  artifact: ReconciledArtifact;
  dryRun: boolean;
}): Promise<DryRunEntry | null> {
  const adapter = (() => {
    try {
      return getAdapter(adapterId);
    } catch {
      return null;
    }
  })();
  if (!adapter) return null;

  const raw = await readFileOrNull(artifact.path);
  if (raw == null) return null;

  let parsed: Record<string, unknown> = {};
  try {
    if (adapter.capabilities.mcpFormat === "toml") {
      parsed = readMcpFromToml(raw) as Record<string, unknown>;
    } else {
      const obj = parseJsonc(raw) as Record<string, unknown>;
      parsed = (obj[adapter.capabilities.mcpRootKey ?? "mcpServers"] ?? {}) as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  const serverConfig = parsed[artifact.name];
  if (!serverConfig) return null;

  const targetFile = path.join(outputDir, "mcp.json");
  const action: DryRunEntry["action"] = (await exists(targetFile)) ? "modify" : "create";

  if (!dryRun) {
    const current = await tryReadMcpConfig(targetFile);
    const next: Record<string, McpServerConfig> = {
      ...current,
      [artifact.name]: serverConfig as McpServerConfig,
    };
    await writeFileEnsureDir(targetFile, JSON.stringify(next, null, 2) + "\n");
  }
  return { file: targetFile, action, detail: `mcp:${artifact.name}` };
}

// --- Generic per-file content (rules, commands, agents) ---

async function applyContentDrift({
  outputDir,
  subdir,
  name,
  artifact,
  dryRun,
}: {
  outputDir: string;
  subdir: "rules" | "commands" | "agents";
  name: string;
  artifact: ReconciledArtifact;
  dryRun: boolean;
}): Promise<DryRunEntry | null> {
  const content =
    artifact.actualContent ?? (await readFileOrNull(artifact.path));
  if (content == null) return null;

  const targetFile = path.join(outputDir, subdir, `${name}.md`);
  const action: DryRunEntry["action"] = (await exists(targetFile)) ? "modify" : "create";
  if (!dryRun) {
    await writeFileEnsureDir(targetFile, content);
  }
  return { file: targetFile, action, detail: `${subdir}/${name}` };
}

// --- Manifest hash patching ---

function rehashManifestRecord(
  record: AdapterInstallRecord,
  type: ArtifactType,
  name: string,
  newHash: string,
): void {
  switch (type) {
    case "instructions":
      if (record.instructions) record.instructions.hash = newHash;
      break;
    case "skill":
      if (record.skills?.[name]) record.skills[name].hash = newHash;
      break;
    case "agent":
      if (record.agents?.[name]) record.agents[name].hash = newHash;
      break;
    case "rule":
      if (record.rules?.[name]) record.rules[name].hash = newHash;
      break;
    case "command":
      if (record.commands?.[name]) record.commands[name].hash = newHash;
      break;
    case "mcp":
      if (record.mcp?.[name]) record.mcp[name].hash = newHash;
      break;
  }
}

/** Build a flat list of selectable drift entries — the wizard renders this as
 *  a multi-select, with `selected` toggled by space. Default selection is all
 *  drifted entries. Callers stay one read away from `reconcileAll`. */
export interface DriftCandidate {
  adapterId: string;
  type: ArtifactType;
  name: string;
  /** Human-readable file path on disk (for the picker hint). */
  path: string;
}

export async function listDriftCandidates(root: string): Promise<DriftCandidate[]> {
  const reconcile = await reconcileAll(root);
  const out: DriftCandidate[] = [];
  for (const stack of reconcile.stacks) {
    for (const adapter of stack.adapters) {
      for (const artifact of adapter.artifacts) {
        if (artifact.state !== "drifted") continue;
        out.push({
          adapterId: adapter.adapterId,
          type: artifact.type,
          name: artifact.name,
          path: artifact.path,
        });
      }
    }
  }
  return out;
}

