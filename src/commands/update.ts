import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { readManifest, writeManifest, upsertInstall, buildAdapterRecords } from "../core/manifest.js";
import type { AdapterWriteContext } from "../core/manifest.js";
import { readStack } from "../core/stack.js";
import { installCanonical, canonicalSkillBase } from "../core/skill-store.js";
import { reconcileAll, buildExpectedContent } from "../core/reconcile.js";
import type { ArtifactType } from "../core/reconcile.js";
import { detectAdapters, getAdapter } from "../adapters/registry.js";
import { parseGitHubSource, cloneAndResolve, getRepoCommitSha } from "../sources/github.js";
import { removeDir, readFileOrNull, exists, writeFileEnsureDir, removeFileOrSymlink } from "../shared/utils.js";
import { log, spinner } from "../shared/io.js";
import { agentFileName, ruleFileNames, removeCheckedFile, removeEmptyDir, isSkillShared, isArtifactShared } from "../core/artifact-ops.js";
import { removeMcpFromJson } from "../adapters/adapter-utils.js";
import { removeMcpSectionsFromToml } from "../adapters/toml-utils.js";
import { stripMarkerBlock } from "../shared/markers.js";
import { collectScripts, executeScripts } from "../core/scripts.js";
import { applyExcluded } from "../core/merger.js";
import { chooseDriftAction, requireInteractive, type DriftAction } from "../shared/interactive.js";
import { renderSingleArtifactDiff } from "./diff.js";
import type { WriteOptions } from "../adapters/types.js";
import type { InstallManifest, InstallEntry, StackBundle, AdapterInstallRecord } from "../shared/schema.js";

export interface UpdateOptions {
  stackName?: string;
  check?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  ignoreScripts?: boolean;
  trust?: boolean;
  json?: boolean;
  interactive?: boolean;
  /** Override source for local stacks (used by tests) */
  localSource?: string;
}

// --- Delta types ---

export interface ArtifactDelta {
  type: "skill" | "agent" | "rule" | "command" | "mcp" | "instructions";
  name: string;
}

export interface StackUpdateResult {
  stack: string;
  oldVersion: string;
  newVersion: string;
  source?: string;
  added: ArtifactDelta[];
  modified: ArtifactDelta[];
  removed: ArtifactDelta[];
  skipped: Array<ArtifactDelta & { reason: string }>;
  unchanged: number;
}

export interface UpdateResult {
  updated: boolean;
  stacks: StackUpdateResult[];
}

// --- Check upstream ---

function checkRemoteCommit(source: string, currentCommit?: string): string | null {
  const gh = parseGitHubSource(source);
  if (!gh) return null;
  // Pinned ref means no auto-update
  if (gh.ref) return null;
  // No baseline commit — can't compare (pre-resolvedCommit installs)
  if (!currentCommit) return null;

  try {
    const output = execFileSync("git", [
      "ls-remote",
      `https://github.com/${gh.owner}/${gh.repo}.git`,
      "HEAD",
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 10000 }).toString();
    const latestSha = output.split("\t")[0]?.trim();
    if (latestSha && latestSha !== currentCommit) {
      return latestSha;
    }
    return null;
  } catch {
    return null;
  }
}

// --- Delta computation ---

function collectArtifactHashes(record: AdapterInstallRecord, map: Map<string, string>): void {
  if (record.instructions) {
    // For forked artifacts, compare against the baseline (last upstream at
    // fork time) so delta detects NEW upstream changes rather than showing
    // the user's own kept changes as "modified".
    map.set(
      "instructions:instructions",
      record.instructions.baselineHash ?? record.instructions.hash,
    );
  }
  for (const [name, entry] of Object.entries(record.skills ?? {})) {
    map.set(`skill:${name}`, entry.baselineHash ?? entry.hash);
  }
  for (const [name, entry] of Object.entries(record.agents ?? {})) {
    map.set(`agent:${name}`, entry.baselineHash ?? entry.hash);
  }
  for (const [name, entry] of Object.entries(record.rules ?? {})) {
    map.set(`rule:${name}`, entry.baselineHash ?? entry.hash);
  }
  for (const [name, entry] of Object.entries(record.commands ?? {})) {
    map.set(`command:${name}`, entry.baselineHash ?? entry.hash);
  }
  for (const [name, entry] of Object.entries(record.mcp ?? {})) {
    map.set(`mcp:${name}`, entry.baselineHash ?? entry.hash);
  }
}

function computeDelta(
  oldRecords: Record<string, AdapterInstallRecord>,
  newRecords: Record<string, AdapterInstallRecord>,
): { added: ArtifactDelta[]; modified: ArtifactDelta[]; removed: ArtifactDelta[]; unchanged: number } {
  const oldArtifacts = new Map<string, string>();
  const newArtifacts = new Map<string, string>();

  for (const record of Object.values(oldRecords)) {
    collectArtifactHashes(record, oldArtifacts);
  }
  for (const record of Object.values(newRecords)) {
    collectArtifactHashes(record, newArtifacts);
  }

  const added: ArtifactDelta[] = [];
  const modified: ArtifactDelta[] = [];
  const removed: ArtifactDelta[] = [];
  let unchanged = 0;

  // Single pass over new artifacts: classify as added, modified, or unchanged
  for (const [key, newHash] of newArtifacts) {
    const [type, name] = key.split(":", 2) as [ArtifactDelta["type"], string];
    const oldHash = oldArtifacts.get(key);
    if (!oldHash) {
      added.push({ type, name });
    } else if (oldHash !== newHash) {
      modified.push({ type, name });
    } else {
      unchanged++;
    }
  }

  // Removed: in old but not in new
  for (const [key] of oldArtifacts) {
    if (!newArtifacts.has(key)) {
      const [type, name] = key.split(":", 2) as [ArtifactDelta["type"], string];
      removed.push({ type, name });
    }
  }

  return { added, modified, removed, unchanged };
}

// --- Drift check ---

function isDrifted(
  reconciled: Awaited<ReturnType<typeof reconcileAll>>,
  stackName: string,
  type: string,
  name: string,
): boolean {
  const stack = reconciled.stacks.find((s) => s.stack === stackName);
  if (!stack) return false;
  for (const adapter of stack.adapters) {
    for (const artifact of adapter.artifacts) {
      if (artifact.type === type && artifact.name === name && artifact.state === "drifted") {
        return true;
      }
    }
  }
  return false;
}

// --- Interactive drift resolution ---

/**
 * A conflict where an artifact has drifted locally AND is about to be
 * modified by the incoming update. These are the cases `--interactive`
 * prompts on.
 */
interface DriftCandidate {
  type: ArtifactDelta["type"];
  name: string;
  /** Hash of the user's current file content (from reconcile's actualContent). */
  localHash: string;
  /** Hash of the new upstream content (from the incoming bundle). */
  upstreamHash: string;
  /** The adapter where drift was detected (first match). Used for diff rendering. */
  adapterId: string;
  /** The artifact's on-disk path in that adapter, for diff labeling. */
  filePath: string;
  /** Current on-disk content, for rendering the diff. */
  actualContent: string;
}

/**
 * Collect all artifacts that are both drifted locally and changing upstream.
 * Pure function: reads reconciled + delta, returns the list. Prompting is
 * deferred to `promptDriftResolutions` so no I/O happens during the filter.
 */
function collectDriftCandidates(
  stackName: string,
  delta: ReturnType<typeof computeDelta>,
  reconciled: Awaited<ReturnType<typeof reconcileAll>>,
  newRecords: Record<string, AdapterInstallRecord>,
): DriftCandidate[] {
  const candidates: DriftCandidate[] = [];
  const changing = [...delta.added, ...delta.modified];
  const stack = reconciled.stacks.find((s) => s.stack === stackName);
  if (!stack) return candidates;

  for (const a of changing) {
    // Find drifted artifact (first match across adapters). Requires
    // `actualHash` which reconcile sets for every drifted artifact using
    // the type-specific hash function (computeSkillHash for skills,
    // computeMcpServerHash for mcp, computeHash for text). Using the raw
    // actualContent here would be wrong for skills and mcp.
    let drifted: {
      adapterId: string;
      path: string;
      actualContent: string;
      localHash: string;
    } | null = null;
    for (const adapter of stack.adapters) {
      for (const artifact of adapter.artifacts) {
        if (
          artifact.type === a.type &&
          artifact.name === a.name &&
          artifact.state === "drifted" &&
          artifact.actualHash
        ) {
          drifted = {
            adapterId: adapter.adapterId,
            path: artifact.path,
            actualContent: artifact.actualContent ?? "",
            localHash: artifact.actualHash,
          };
          break;
        }
      }
      if (drifted) break;
    }
    if (!drifted) continue;

    // Pull upstream hash from the new adapter records.
    let upstreamHash: string | undefined;
    for (const record of Object.values(newRecords)) {
      upstreamHash = getRecordHash(record, a.type, a.name);
      if (upstreamHash) break;
    }
    if (!upstreamHash) continue;

    candidates.push({
      type: a.type,
      name: a.name,
      localHash: drifted.localHash,
      upstreamHash,
      adapterId: drifted.adapterId,
      filePath: drifted.path,
      actualContent: drifted.actualContent,
    });
  }

  return candidates;
}

function getRecordHash(
  record: AdapterInstallRecord,
  type: ArtifactDelta["type"],
  name: string,
): string | undefined {
  switch (type) {
    case "instructions":
      return record.instructions?.hash;
    case "skill":
      return record.skills?.[name]?.hash;
    case "agent":
      return record.agents?.[name]?.hash;
    case "rule":
      return record.rules?.[name]?.hash;
    case "command":
      return record.commands?.[name]?.hash;
    case "mcp":
      return record.mcp?.[name]?.hash;
  }
}


/**
 * Copy the entry for a skipped (drifted) artifact from the old manifest
 * record into the new one. When `forkInfo` is present, the entry is stamped
 * with the local hash plus the upstream baseline so `pit status` can show
 * the fork and future updates can diff against the baseline. Without
 * `forkInfo`, the old entry is preserved verbatim (default "skip" behavior).
 */
function preserveSkippedArtifact(
  rec: AdapterInstallRecord,
  oldRecord: AdapterInstallRecord,
  type: ArtifactDelta["type"],
  name: string,
  forkInfo: { localHash: string; baselineHash: string } | undefined,
): void {
  const forked = forkInfo && {
    forked: true as const,
    hash: forkInfo.localHash,
    baselineHash: forkInfo.baselineHash,
  };

  switch (type) {
    case "instructions": {
      if (!oldRecord.instructions || rec.instructions) return;
      rec.instructions = forked ?? oldRecord.instructions;
      return;
    }
    case "skill": {
      const old = oldRecord.skills?.[name];
      if (!old || rec.skills?.[name]) return;
      rec.skills = rec.skills ?? {};
      // Preserve supportingFiles on fork — reconcile's per-tracked-path scan
      // degrades to a full-dir scan otherwise.
      rec.skills[name] = forked ? { ...old, ...forked } : old;
      return;
    }
    case "agent": {
      const old = oldRecord.agents?.[name];
      if (!old || rec.agents?.[name]) return;
      rec.agents = rec.agents ?? {};
      rec.agents[name] = forked ?? old;
      return;
    }
    case "rule": {
      const old = oldRecord.rules?.[name];
      if (!old || rec.rules?.[name]) return;
      rec.rules = rec.rules ?? {};
      rec.rules[name] = forked ?? old;
      return;
    }
    case "command": {
      const old = oldRecord.commands?.[name];
      if (!old || rec.commands?.[name]) return;
      rec.commands = rec.commands ?? {};
      rec.commands[name] = forked ?? old;
      return;
    }
    case "mcp": {
      const old = oldRecord.mcp?.[name];
      if (!old || rec.mcp?.[name]) return;
      rec.mcp = rec.mcp ?? {};
      rec.mcp[name] = forked ?? old;
      return;
    }
  }
}

/**
 * Prompt the user to resolve each drift candidate. Returns a map of
 * `"type:name"` → chosen action. The `d` (view diff) branch loops: we
 * print the diff, then re-ask until the user picks a terminal option.
 */
async function promptDriftResolutions(
  candidates: DriftCandidate[],
  bundle: StackBundle,
): Promise<
  Map<string, { action: DriftAction; localHash: string; upstreamHash: string }>
> {
  const resolutions = new Map<
    string,
    { action: DriftAction; localHash: string; upstreamHash: string }
  >();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const key = `${c.type}:${c.name}`;
    let choice: DriftAction;
    // Loop for the 'd' (view diff) branch.
    while (true) {
      choice = await chooseDriftAction(
        `[${i + 1}/${candidates.length}] ${c.type} "${c.name}" changed upstream AND locally`,
      );
      if (choice !== "diff") break;

      const expected = buildExpectedContent(
        bundle,
        c.adapterId,
        c.type as ArtifactType,
        c.name,
      );
      if (expected == null) {
        log.info("(source unavailable for diff)");
        continue;
      }
      const rendered = renderSingleArtifactDiff(
        expected,
        c.actualContent,
        c.filePath,
      );
      console.log(rendered);
    }

    resolutions.set(key, {
      action: choice,
      localHash: c.localHash,
      upstreamHash: c.upstreamHash,
    });
  }

  return resolutions;
}

// --- Filter bundle for drift ---

function filterBundleForDrift(
  bundle: StackBundle,
  stackName: string,
  delta: ReturnType<typeof computeDelta>,
  reconciled: Awaited<ReturnType<typeof reconcileAll>>,
  force: boolean,
): { filtered: StackBundle; skipped: Array<ArtifactDelta & { reason: string }> } {
  const skipped: Array<ArtifactDelta & { reason: string }> = [];

  if (force) {
    return { filtered: bundle, skipped };
  }

  const changingArtifacts = [...delta.added, ...delta.modified];

  // Check if instructions are drifted + changing
  const instrDrifted = isDrifted(reconciled, stackName, "instructions", "instructions");
  const instrChanging = changingArtifacts.some((a) => a.type === "instructions");
  let skipInstructions = false;
  if (instrDrifted && instrChanging) {
    skipped.push({ type: "instructions", name: "instructions", reason: "drifted" });
    skipInstructions = true;
  }

  const filteredSkills = bundle.skills.filter((skill) => {
    if (!isDrifted(reconciled, stackName, "skill", skill.name)) return true;
    const changing = changingArtifacts.some((a) => a.type === "skill" && a.name === skill.name);
    if (changing) {
      skipped.push({ type: "skill", name: skill.name, reason: "drifted" });
      return false;
    }
    return true;
  });

  const filteredAgents = bundle.agents.filter((agent) => {
    if (!isDrifted(reconciled, stackName, "agent", agent.name)) return true;
    const changing = changingArtifacts.some((a) => a.type === "agent" && a.name === agent.name);
    if (changing) {
      skipped.push({ type: "agent", name: agent.name, reason: "drifted" });
      return false;
    }
    return true;
  });

  const filteredRules = bundle.rules.filter((rule) => {
    if (!isDrifted(reconciled, stackName, "rule", rule.name)) return true;
    const changing = changingArtifacts.some((a) => a.type === "rule" && a.name === rule.name);
    if (changing) {
      skipped.push({ type: "rule", name: rule.name, reason: "drifted" });
      return false;
    }
    return true;
  });

  const filteredCommands = bundle.commands.filter((cmd) => {
    if (!isDrifted(reconciled, stackName, "command", cmd.name)) return true;
    const changing = changingArtifacts.some((a) => a.type === "command" && a.name === cmd.name);
    if (changing) {
      skipped.push({ type: "command", name: cmd.name, reason: "drifted" });
      return false;
    }
    return true;
  });

  // Filter MCP servers
  const filteredMcpServers: typeof bundle.mcpServers = {};
  for (const [name, config] of Object.entries(bundle.mcpServers)) {
    if (!isDrifted(reconciled, stackName, "mcp", name)) {
      filteredMcpServers[name] = config;
      continue;
    }
    const changing = changingArtifacts.some((a) => a.type === "mcp" && a.name === name);
    if (changing) {
      skipped.push({ type: "mcp", name, reason: "drifted" });
    } else {
      filteredMcpServers[name] = config;
    }
  }

  return {
    filtered: {
      ...bundle,
      agentInstructions: skipInstructions ? "" : bundle.agentInstructions,
      skills: filteredSkills,
      agents: filteredAgents,
      rules: filteredRules,
      commands: filteredCommands,
      mcpServers: filteredMcpServers,
    },
    skipped,
  };
}

// --- Remove deleted artifacts ---

async function removeDeletedArtifacts(
  target: string,
  stackName: string,
  manifest: InstallManifest,
  oldEntry: InstallEntry,
  removedArtifacts: ArtifactDelta[],
  opts: { force?: boolean; dryRun?: boolean },
): Promise<void> {
  for (const artifact of removedArtifacts) {
    for (const [adapterId, record] of Object.entries(oldEntry.adapters)) {
      let adapter;
      try {
        adapter = getAdapter(adapterId);
      } catch {
        continue;
      }
      const p = adapter.paths.project(target);

      switch (artifact.type) {
        case "instructions": {
          if (record.instructions && p.config) {
            const content = await readFileOrNull(p.config);
            if (content != null) {
              const stripped = stripMarkerBlock(content, stackName);
              if (stripped !== content && !opts.dryRun) {
                if (stripped.trim() === "") {
                  await removeFileOrSymlink(p.config);
                } else {
                  await writeFileEnsureDir(p.config, stripped);
                }
              }
            }
          }
          break;
        }

        case "skill": {
          if (!record.skills?.[artifact.name]) break;
          if (isSkillShared(manifest, stackName, artifact.name)) break;
          const canonicalDir = path.join(canonicalSkillBase(target), artifact.name);
          if (!opts.dryRun) {
            await removeCheckedFile(
              path.join(canonicalDir, "SKILL.md"),
              record.skills[artifact.name]!.hash,
              opts,
            );
            await removeEmptyDir(canonicalDir);
          }
          if (adapter.capabilities.skillLinkStrategy === "symlink") {
            const adapterSkillDir = path.join(p.skills, artifact.name);
            if (!opts.dryRun) await removeFileOrSymlink(adapterSkillDir);
          }
          break;
        }

        case "agent": {
          if (!record.agents?.[artifact.name] || adapter.capabilities.agents !== "native" || !p.agents) break;
          if (isArtifactShared(manifest, stackName, adapterId, "agents", artifact.name)) break;
          const agentPath = path.join(p.agents, agentFileName(adapterId, artifact.name));
          if (!opts.dryRun) await removeCheckedFile(agentPath, record.agents[artifact.name]!.hash, opts);
          break;
        }

        case "rule": {
          if (!record.rules?.[artifact.name] || !adapter.capabilities.rules || !p.rules) break;
          if (isArtifactShared(manifest, stackName, adapterId, "rules", artifact.name)) break;
          const candidates = ruleFileNames(adapterId, artifact.name);
          for (const fileName of candidates) {
            const rulePath = path.join(p.rules, fileName);
            if (!opts.dryRun) {
              const status = await removeCheckedFile(rulePath, record.rules[artifact.name]!.hash, opts);
              if (status !== "skipped-missing") break;
            }
          }
          break;
        }

        case "command": {
          if (!record.commands?.[artifact.name] || !adapter.capabilities.commands || !p.commands) break;
          if (isArtifactShared(manifest, stackName, adapterId, "commands", artifact.name)) break;
          const commandPath = path.join(p.commands, `${artifact.name}.md`);
          if (!opts.dryRun) await removeCheckedFile(commandPath, record.commands[artifact.name]!.hash, opts);
          break;
        }

        case "mcp": {
          if (!record.mcp?.[artifact.name]) break;
          if (isArtifactShared(manifest, stackName, adapterId, "mcp", artifact.name)) break;
          if (!opts.dryRun) {
            if (adapter.capabilities.mcpFormat === "toml") {
              const raw = await readFileOrNull(p.mcp);
              if (raw) {
                const updated = removeMcpSectionsFromToml(raw, [artifact.name]);
                await writeFileEnsureDir(p.mcp, updated);
              }
            } else {
              await removeMcpFromJson(p.mcp, [artifact.name], adapter.capabilities.mcpRootKey);
            }
          }
          break;
        }
      }
    }
  }
}

// --- Main update function ---

export async function updateStacks(
  target: string,
  opts: UpdateOptions = {},
): Promise<UpdateResult> {
  let manifest = await readManifest(target);
  if (manifest.installs.length === 0) {
    throw new Error("No stacks installed. Run `pit install` first.");
  }

  // Filter stacks (snapshot entries before any mutations)
  const entries = opts.stackName
    ? manifest.installs.filter((e) => e.stack === opts.stackName)
    : [...manifest.installs];

  if (opts.stackName && entries.length === 0) {
    const installed = manifest.installs.map((e) => e.stack);
    throw new Error(
      `Stack "${opts.stackName}" is not installed.\n\nInstalled stacks:\n${installed.map((s) => `  - ${s}`).join("\n")}`,
    );
  }

  const results: StackUpdateResult[] = [];
  let anyUpdated = false;

  // Detect adapters once (shared across all stack updates)
  const detected = await detectAdapters(target);
  if (detected.length === 0) {
    const { claudeCodeAdapter } = await import("../adapters/claude-code.js");
    detected.push({ adapter: claudeCodeAdapter, detection: { detected: true, configPaths: [] } });
  }
  if (!detected.some((d) => d.adapter.id === "standards")) {
    const { standardsAdapter } = await import("../adapters/standards.js");
    detected.push({ adapter: standardsAdapter, detection: { detected: true, configPaths: [] } });
  }

  for (const entry of entries) {
    let tmpDir: string | null = null;
    let newBundle: StackBundle;
    let resolvedSource: string;
    let resolvedCommit: string | undefined;
    let resolvedExtendsEntries: Array<{
      source: string;
      version?: string;
      resolvedCommit?: string;
      resolvedAt: string;
    }> = [];
    let resolvedNodes: Array<{ source: string; stackDir: string; bundle: StackBundle }> = [];

    const source = entry.source;
    const gh = source ? parseGitHubSource(source) : null;

    // --- Check upstream for remote stacks ---
    if (gh) {
      if (gh.ref) {
        if (!opts.json) log.info(`${entry.stack}: pinned at ${gh.ref}, skipping`);
        results.push({
          stack: entry.stack, oldVersion: entry.stackVersion, newVersion: entry.stackVersion,
          source, added: [], modified: [], removed: [], skipped: [], unchanged: 0,
        });
        continue;
      }

      const latestCommit = checkRemoteCommit(source!, entry.resolvedCommit);
      if (latestCommit === null) {
        if (!opts.json && !opts.check) log.info(`${entry.stack}: up to date`);
        results.push({
          stack: entry.stack, oldVersion: entry.stackVersion, newVersion: entry.stackVersion,
          source, added: [], modified: [], removed: [], skipped: [], unchanged: 0,
        });
        continue;
      }

      // Fetch new bundle
      const fetchSpin = spinner(`Fetching ${entry.stack}...`);
      try {
        const resolved = await cloneAndResolve(gh);
        resolvedSource = resolved.stackDir;
        tmpDir = resolved.tmpDir;
        resolvedCommit = getRepoCommitSha(path.dirname(resolvedSource));
        newBundle = await readStack(resolvedSource);
        fetchSpin.succeed(`Fetched ${entry.stack}@${newBundle.manifest.version}`);
      } catch (err) {
        fetchSpin.fail(`Failed to fetch ${entry.stack}`);
        if (err instanceof Error) log.error(err.message);
        continue;
      }
    } else {
      // --- Local stack: re-read source ---
      resolvedSource = opts.localSource ?? path.resolve(target, ".promptpit");
      if (!(await exists(path.join(resolvedSource, "stack.json")))) {
        log.warn(`${entry.stack}: source not found at ${resolvedSource}, skipping`);
        continue;
      }
      newBundle = await readStack(resolvedSource);
    }

    try {
      // Resolve extends if present
      let finalBundle = newBundle;
      if (newBundle.manifest.extends && newBundle.manifest.extends.length > 0) {
        const { resolveGraph, mergeGraph } = await import("../core/resolve.js");
        const graph = await resolveGraph(resolvedSource);
        const merged = mergeGraph(graph, {
          instructionStrategy: newBundle.manifest.instructionStrategy ?? "concatenate",
          skipRootInstructions: !gh,
        });
        finalBundle = merged.bundle;
        const depNodes = graph.nodes.filter((n) => n.depth > 0);
        resolvedExtendsEntries = depNodes.map((n) => ({
          source: n.source,
          version: n.bundle.manifest.version,
          resolvedCommit: n.resolvedCommit,
          resolvedAt: new Date().toISOString(),
        }));
        resolvedNodes = depNodes;
      }

      // Build dedup-aware writeOpts (must match install's dedup logic for accurate delta)
      const deltaWriteOpts: WriteOptions = {};
      if (entry.installMode === "prefer-universal") {
        deltaWriteOpts.preferUniversal = true;
      } else if (!entry.installMode || entry.installMode !== "force-standards") {
        const mcpReaders = detected.filter((d) => d.adapter.id !== "standards" && d.adapter.capabilities.nativelyReads?.mcp);
        const instrReaders = detected.filter((d) => d.adapter.id !== "standards" && d.adapter.capabilities.nativelyReads?.instructions);
        if (mcpReaders.length > 0) deltaWriteOpts.skipMcp = true;
        if (instrReaders.length > 0) deltaWriteOpts.skipInstructions = true;
      }

      const contexts: AdapterWriteContext[] = detected.map(({ adapter }) => ({
        adapter,
        writeOpts: adapter.id === "standards" ? deltaWriteOpts : {},
      }));
      const newAdapterRecords = buildAdapterRecords(contexts, finalBundle, target);

      // Compute delta
      const delta = computeDelta(entry.adapters, newAdapterRecords);

      if (delta.added.length === 0 && delta.modified.length === 0 && delta.removed.length === 0) {
        if (!opts.json) log.info(`${entry.stack}: already up to date`);
        results.push({
          stack: entry.stack, oldVersion: entry.stackVersion, newVersion: finalBundle.manifest.version,
          source, added: [], modified: [], removed: [], skipped: [], unchanged: delta.unchanged,
        });
        continue;
      }

      // --check: report without applying
      if (opts.check) {
        results.push({
          stack: entry.stack, oldVersion: entry.stackVersion, newVersion: finalBundle.manifest.version,
          source, added: delta.added, modified: delta.modified, removed: delta.removed,
          skipped: [], unchanged: delta.unchanged,
        });
        if (!opts.json) {
          const parts: string[] = [];
          if (delta.added.length > 0) parts.push(`${delta.added.length} added`);
          if (delta.modified.length > 0) parts.push(`${delta.modified.length} modified`);
          if (delta.removed.length > 0) parts.push(`${delta.removed.length} removed`);
          log.info(`${entry.stack}: ${entry.stackVersion} → ${finalBundle.manifest.version} (${parts.join(", ")})`);
        }
        continue;
      }

      // Reconcile current drift state
      const reconciled = await reconcileAll(target);

      // Drift-resolution paths:
      //   - `--force`: overwrite everything (no drift filter at all)
      //   - `--interactive`: prompt per drifted+changing artifact, honor choices
      //   - default: skip drifted+changing artifacts, preserve old hash
      let filtered: StackBundle;
      let skipped: Array<ArtifactDelta & { reason: string }>;
      const forkedArtifacts: Map<
        string,
        { localHash: string; baselineHash: string }
      > = new Map();

      if (opts.interactive) {
        requireInteractive("--interactive");
        const candidates = collectDriftCandidates(
          entry.stack,
          delta,
          reconciled,
          newAdapterRecords,
        );

        if (candidates.length === 0) {
          // No drifted+changing artifacts to prompt on — apply everything.
          filtered = finalBundle;
          skipped = [];
        } else {
          const resolutions = await promptDriftResolutions(candidates, finalBundle);
          // Build the per-artifact filter from resolutions.
          const keepMine: ArtifactDelta[] = [];
          const skipList: ArtifactDelta[] = [];
          for (const candidate of candidates) {
            const key = `${candidate.type}:${candidate.name}`;
            const res = resolutions.get(key);
            if (!res) continue;
            if (res.action === "keep") {
              keepMine.push({ type: candidate.type, name: candidate.name });
              forkedArtifacts.set(key, {
                localHash: res.localHash,
                baselineHash: res.upstreamHash,
              });
            } else if (res.action === "skip") {
              skipList.push({ type: candidate.type, name: candidate.name });
            }
            // "upstream" falls through — included in the filter as normal.
          }

          filtered = applyExcluded(
            finalBundle,
            [...keepMine, ...skipList].map((a) => `${a.type}:${a.name}`),
          );
          skipped = [
            ...keepMine.map((a) => ({ ...a, reason: "kept local" as const })),
            ...skipList.map((a) => ({ ...a, reason: "skipped" as const })),
          ];
        }
      } else {
        const result = filterBundleForDrift(
          finalBundle,
          entry.stack,
          delta,
          reconciled,
          !!opts.force,
        );
        filtered = result.filtered;
        skipped = result.skipped;
      }

      // Print delta summary (for both regular and dry-run modes)
      if (!opts.json) {
        const versionChanged = entry.stackVersion !== finalBundle.manifest.version;
        const prefix = opts.dryRun ? "Would update" : "Updating";
        log.info(
          `${prefix} ${entry.stack}${versionChanged ? ` (${entry.stackVersion} → ${finalBundle.manifest.version})` : ""}...`,
        );
        for (const a of delta.added) console.log(chalk.green(`  + ${a.type}: ${a.name}`));
        for (const a of delta.modified) {
          const wasSkipped = skipped.some((s) => s.type === a.type && s.name === a.name);
          if (wasSkipped) {
            console.log(chalk.yellow(`  ! ${a.type}: ${a.name} (skipped — drifted)`));
          } else {
            console.log(chalk.cyan(`  ~ ${a.type}: ${a.name}`));
          }
        }
        for (const a of delta.removed) console.log(chalk.red(`  - ${a.type}: ${a.name}`));

        if (opts.dryRun) {
          console.log();
          log.info("Dry run — no files were modified.");
        }
      }

      if (opts.dryRun) {
        results.push({
          stack: entry.stack, oldVersion: entry.stackVersion, newVersion: finalBundle.manifest.version,
          source, added: delta.added, modified: delta.modified, removed: delta.removed,
          skipped, unchanged: delta.unchanged,
        });
        continue;
      }

      // --- Apply: write filtered bundle to adapters ---

      // Canonical skills
      if (filtered.skills.length > 0) {
        await installCanonical(target, filtered.skills, {});
      }

      // Build writeOpts — preserve original installMode dedup settings
      const writeOpts: WriteOptions = {};
      if (entry.installMode === "prefer-universal") {
        writeOpts.preferUniversal = true;
      } else if (entry.installMode === "force-standards") {
        // force-standards: no dedup needed, standards writes everything
      } else {
        // Default dedup: skip standards when tool-specific adapters read natively
        const mcpReaders = detected.filter((d) => d.adapter.id !== "standards" && d.adapter.capabilities.nativelyReads?.mcp);
        const instrReaders = detected.filter((d) => d.adapter.id !== "standards" && d.adapter.capabilities.nativelyReads?.instructions);
        if (mcpReaders.length > 0) writeOpts.skipMcp = true;
        if (instrReaders.length > 0) writeOpts.skipInstructions = true;
      }

      for (const { adapter } of detected) {
        const adapterWriteOpts: WriteOptions = { ...writeOpts };
        // Standards adapter respects skip flags, tool adapters don't need them
        if (adapter.id !== "standards") {
          delete adapterWriteOpts.skipMcp;
          delete adapterWriteOpts.skipInstructions;
        }
        await adapter.write(target, filtered, adapterWriteOpts);
      }

      // Run lifecycle scripts
      if (!opts.ignoreScripts) {
        const scriptChainEntries = [
          ...resolvedNodes.map((n) => ({ manifest: n.bundle.manifest, stackDir: n.stackDir, source: n.source })),
          { manifest: finalBundle.manifest, stackDir: resolvedSource, source: source ?? ".promptpit" },
        ];
        const postScripts = collectScripts(scriptChainEntries, "postinstall");
        if (postScripts.length > 0) {
          const isRemoteSource = (src: string) => !!parseGitHubSource(src);
          await executeScripts(postScripts, {
            targetDir: target,
            isRemote: isRemoteSource,
            trust: opts.trust,
            ignoreScriptErrors: false,
          });
        }
      }

      // Remove deleted artifacts
      if (delta.removed.length > 0) {
        await removeDeletedArtifacts(target, entry.stack, manifest, entry, delta.removed, opts);
      }

      // Update manifest — build records from filtered bundle, then merge back
      // skipped artifacts from old entry so they stay tracked
      const finalContexts: AdapterWriteContext[] = detected.map(({ adapter }) => ({
        adapter,
        writeOpts: adapter.id === "standards" ? writeOpts : {},
      }));
      const adapterRecords = buildAdapterRecords(finalContexts, filtered, target);

      // Preserve old manifest entries for skipped (drifted) artifacts — keeps
      // them trackable without changing their recorded hash. Forked entries
      // (keep-mine) record the local hash plus the upstream baseline so
      // future updates still see new upstream changes.
      for (const skip of skipped) {
        const forkInfo = forkedArtifacts.get(`${skip.type}:${skip.name}`);
        for (const [adapterId, oldRecord] of Object.entries(entry.adapters)) {
          if (!adapterRecords[adapterId]) adapterRecords[adapterId] = {};
          preserveSkippedArtifact(
            adapterRecords[adapterId]!,
            oldRecord,
            skip.type,
            skip.name,
            forkInfo,
          );
        }
      }

      const newEntry: InstallEntry = {
        stack: finalBundle.manifest.name,
        stackVersion: finalBundle.manifest.version,
        source: entry.source,
        resolvedCommit,
        installedAt: new Date().toISOString(),
        ...(entry.installMode && { installMode: entry.installMode }),
        ...(resolvedExtendsEntries.length > 0 && { resolvedExtends: resolvedExtendsEntries }),
        adapters: adapterRecords,
        // Preserve user's interactive-install decisions across updates.
        ...(entry.overrides && { overrides: entry.overrides }),
        ...(entry.excluded && { excluded: entry.excluded }),
      };

      manifest = upsertInstall(manifest, newEntry);
      await writeManifest(target, manifest);

      anyUpdated = true;
      results.push({
        stack: entry.stack, oldVersion: entry.stackVersion, newVersion: finalBundle.manifest.version,
        source, added: delta.added, modified: delta.modified, removed: delta.removed,
        skipped, unchanged: delta.unchanged,
      });

      if (skipped.length > 0 && !opts.json) {
        log.warn(`${skipped.length} artifact(s) skipped (drifted). Run with --force to overwrite.`);
      }
      log.success(`${entry.stack} updated to ${finalBundle.manifest.version}`);
    } finally {
      if (tmpDir) await removeDir(tmpDir);
    }
  }

  if (!anyUpdated && results.length > 0 && !opts.check && !opts.json && !opts.dryRun) {
    log.info("All stacks up to date.");
  }

  return { updated: anyUpdated, stacks: results };
}
