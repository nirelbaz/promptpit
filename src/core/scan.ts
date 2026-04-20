import path from "node:path";
import { statSync, type Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { detectAdapters, getAdapter } from "../adapters/registry.js";
import { reconcileAll } from "./reconcile.js";
import { exists, readFileOrNull } from "../shared/utils.js";
import { log } from "../shared/io.js";
import { DEFAULT_IGNORE } from "../shared/constants.js";
import type { ScannedStack } from "../shared/schema.js";
import type { PlatformAdapter } from "../adapters/types.js";

export interface ScanOptions {
  cwd: string;
  globalRoots: string[];
  depth?: number;
  ignoreGlobs?: string[];
  followSymlinks?: boolean;
  /** Skip the current-tree walk entirely. Only globalRoots are materialized.
   *  Used by `pit ls --scope global` — the header promises "global only" but
   *  the body used to still include cwd hits. */
  skipLocal?: boolean;
}

type AdapterArtifacts = ScannedStack["adapters"][number]["artifacts"];
type AdapterId = ScannedStack["adapters"][number]["id"];

const PROJECT_ROOT_MARKERS = [
  ".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", ".promptpit",
];

/** AI tools we recognize but don't (yet) translate. Surface them as an FYI
 *  so users know their config exists but isn't part of a pit stack. */
const UNSUPPORTED_TOOL_DIRS = [
  ".windsurf", ".gemini", ".opencode", ".ai-workspace", ".trae", ".zed",
];

async function detectUnsupportedTools(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of UNSUPPORTED_TOOL_DIRS) {
    if (await exists(path.join(dir, name))) found.push(name);
  }
  return found;
}

/** Copilot's prompt-files convention is `.prompt.md` under `.github/prompts/`.
 *  Repos in the wild (e.g. Azure SDK) stash `-guidelines.md` docs in the same
 *  directory. Those get silently skipped; surface a one-time info line so
 *  users can rename if they want them collected. Deduped via `log.warnOnce`
 *  so a large scan doesn't print one line per orphan file. */
async function notePromptsDirectory(dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name.endsWith(".prompt.md")) continue;
    const filePath = path.join(dir, entry.name);
    log.warnOnce(
      `prompts-orphan:${filePath}`,
      `${filePath} doesn't match *.prompt.md and is not collected. Rename to *.prompt.md to include.`,
    );
  }
}

export function detectProjectRoot(start: string, boundary?: string): string {
  const resolvedStart = path.resolve(start);
  const resolvedBoundary = boundary ? path.resolve(boundary) : undefined;
  let dir = resolvedStart;
  const { root } = path.parse(dir);
  while (dir !== root) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        statSync(path.join(dir, marker));
        return dir;
      } catch {
        /* marker not present — keep walking */
      }
    }
    // Don't walk above the scan boundary — otherwise the scanned tree's
    // siblings get folded into whatever outer project they happen to live in.
    if (resolvedBoundary && dir === resolvedBoundary) break;
    dir = path.dirname(dir);
  }
  return resolvedStart;
}

interface HitRecord {
  projectRoot: string;
  promptpitDir?: string;
  looseConfigs: Array<{ adapterId: string; dir: string }>;
  subpathAnnotations: Array<{ subpath: string; adapterId: string; dir: string }>;
  unsupportedTools: Set<string>;
}

export async function scan(opts: ScanOptions): Promise<ScannedStack[]> {
  const depth = opts.depth ?? 5;
  const ignore = new Set(opts.ignoreGlobs ?? DEFAULT_IGNORE);
  const followSymlinks = opts.followSymlinks ?? false;

  const hits = new Map<string, HitRecord>();
  const visited = new Set<string>();
  const boundary = path.resolve(opts.cwd);

  if (!opts.skipLocal) {
    await walk(opts.cwd, 0, depth, ignore, hits, visited, followSymlinks, boundary);
  }

  const stacks = await materializeStacks(hits);

  if (opts.globalRoots.length > 0) {
    const global = await materializeGlobal(opts.globalRoots);
    if (global) stacks.push(global);
  }

  return stacks;
}

async function walk(
  dir: string,
  curDepth: number,
  maxDepth: number,
  ignore: Set<string>,
  hits: Map<string, HitRecord>,
  visited: Set<string>,
  followSymlinks: boolean,
  boundary: string,
): Promise<void> {
  if (curDepth > maxDepth) return;

  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; /* permission denied, pruned silently */
  }

  // Observability only: flag .github/prompts/*.md that don't follow the
  // .prompt.md convention, so users aren't confused when they're dropped.
  if (path.basename(dir) === "prompts" && path.basename(path.dirname(dir)) === ".github") {
    await notePromptsDirectory(dir);
  }

  // Detect AI config at THIS dir
  const detected = await detectAdapters(dir);
  const promptpitPath = path.join(dir, ".promptpit", "stack.json");
  const hasPromptpit = await exists(promptpitPath);
  const unsupported = await detectUnsupportedTools(dir);

  if (hasPromptpit || detected.length > 0 || unsupported.length > 0) {
    const root = detectProjectRoot(dir, boundary);
    let rec = hits.get(root);
    if (!rec) {
      rec = {
        projectRoot: root,
        looseConfigs: [],
        subpathAnnotations: [],
        unsupportedTools: new Set(),
      };
      hits.set(root, rec);
    }
    if (hasPromptpit && !rec.promptpitDir) {
      rec.promptpitDir = path.join(dir, ".promptpit");
    }
    for (const d of detected) {
      if (dir === root) {
        rec.looseConfigs.push({ adapterId: d.adapter.id, dir });
      } else {
        rec.subpathAnnotations.push({
          subpath: path.relative(root, dir),
          adapterId: d.adapter.id,
          dir,
        });
      }
    }
    // Only track unsupported tools at the project root — they aren't
    // meaningful as nested annotations (e.g. docs copies) and the TUI
    // renders them as a single FYI line per stack.
    if (dir === root) {
      for (const name of unsupported) rec.unsupportedTools.add(name);
    }
  }

  if (curDepth === maxDepth) return;

  for (const entry of entries) {
    if (!entry.isDirectory() && !(followSymlinks && entry.isSymbolicLink())) continue;
    if (ignore.has(entry.name)) continue;
    await walk(
      path.join(dir, entry.name),
      curDepth + 1,
      maxDepth,
      ignore,
      hits,
      visited,
      followSymlinks,
      boundary,
    );
  }
}

async function materializeStacks(hits: Map<string, HitRecord>): Promise<ScannedStack[]> {
  const out: ScannedStack[] = [];
  for (const rec of hits.values()) {
    const stack = await materializeOne(rec);
    out.push(stack);
  }
  return out;
}

async function materializeOne(rec: HitRecord): Promise<ScannedStack> {
  const promptpitDir = rec.promptpitDir;
  const managed = !!promptpitDir;
  let name = path.basename(rec.projectRoot);
  let stackVersion: string | undefined;

  if (promptpitDir) {
    const raw = await readFileOrNull(path.join(promptpitDir, "stack.json"));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        name = parsed.name ?? name;
        stackVersion = parsed.version;
      } catch {
        /* fall back to dir basename */
      }
    }
  }

  const adapterCounts = new Map<string, AdapterArtifacts>();

  for (const cfg of rec.looseConfigs) {
    const adapter = getAdapter(cfg.adapterId);
    const counts = await countAdapterArtifacts(adapter, cfg.dir);
    adapterCounts.set(cfg.adapterId, counts);
  }

  let overallDrift: ScannedStack["overallDrift"] = "unknown";
  let manifestCorrupt = false;
  /** Per-adapter drift map, keyed by adapter id. Only populated when we have
   *  a reconcile result — otherwise adapters fall back to "synced" (managed)
   *  or "unknown" (unmanaged/global) below. */
  const adapterDrift = new Map<string, "synced" | "drifted">();
  const installedPath = promptpitDir ? path.join(promptpitDir, "installed.json") : null;
  const hasInstalledJson = installedPath ? await exists(installedPath) : false;

  if (installedPath && hasInstalledJson) {
    try {
      const reconciled = await reconcileAll(rec.projectRoot);
      // An empty `stacks` array from reconcileAll can mean either: manifest
      // failed to parse (corrupt), or it parsed but had zero installs. Peek at
      // the raw file to distinguish the two cases.
      const rawManifest = await readFileOrNull(installedPath);
      if (rawManifest) {
        try {
          JSON.parse(rawManifest);
        } catch {
          manifestCorrupt = true;
        }
      }
      if (!manifestCorrupt) {
        const states = new Set<string>();
        for (const s of reconciled.stacks) {
          for (const a of s.adapters) {
            states.add(a.state);
            const drifted =
              a.state === "drifted" || a.state === "deleted" || a.state === "removed-by-user";
            // Escalate to drifted across stacks; never downgrade back to synced.
            if (drifted) adapterDrift.set(a.adapterId, "drifted");
            else if (!adapterDrift.has(a.adapterId)) adapterDrift.set(a.adapterId, "synced");
          }
        }
        overallDrift =
          states.has("drifted") || states.has("deleted") || states.has("removed-by-user")
            ? "drifted"
            : "synced";
      }
    } catch (err) {
      manifestCorrupt = true;
      log.warn(
        `Could not reconcile ${rec.projectRoot}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    root: rec.projectRoot,
    kind: managed ? "managed" : "unmanaged",
    name,
    manifestCorrupt,
    promptpit: managed
      ? {
          stackVersion: stackVersion ?? "0.0.0",
          hasInstalledJson,
        }
      : undefined,
    adapters: [...adapterCounts.entries()].map(([id, artifacts]) => ({
      id: id as AdapterId,
      artifacts,
      // Per-adapter state from reconcile wins. Adapters not in reconcile
      // output (e.g. detected on disk but never installed) default to synced
      // for managed stacks and unknown for everything else.
      drift: managed ? (adapterDrift.get(id) ?? "synced") : "unknown",
    })),
    unmanagedAnnotations: await Promise.all(
      rec.subpathAnnotations.map(async (a) => ({
        subpath: a.subpath,
        adapterId: a.adapterId as AdapterId,
        counts: await countAdapterArtifacts(getAdapter(a.adapterId), a.dir),
      })),
    ),
    unsupportedTools: [...rec.unsupportedTools].sort(),
    overallDrift,
  };
}

async function countAdapterArtifacts(
  adapter: PlatformAdapter,
  root: string,
): Promise<AdapterArtifacts> {
  const cfg = await adapter.read(root).catch(() => null);
  if (!cfg) return { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false };
  return {
    skills: cfg.skills.length,
    rules: cfg.rules.length,
    agents: cfg.agents.length,
    commands: cfg.commands.length,
    mcp: Object.keys(cfg.mcpServers).length,
    instructions: !!cfg.agentInstructions,
  };
}

async function materializeGlobal(roots: string[]): Promise<ScannedStack | null> {
  const adapters: ScannedStack["adapters"] = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    const detected = await detectAdapters(root);
    for (const d of detected) {
      const counts = await countAdapterArtifacts(d.adapter, root);
      adapters.push({ id: d.adapter.id as AdapterId, artifacts: counts, drift: "unknown" });
    }
  }
  if (adapters.length === 0) return null;
  return {
    root: roots[0] ?? "~",
    kind: "global",
    name: "user-level",
    manifestCorrupt: false,
    adapters,
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "unknown",
  };
}
