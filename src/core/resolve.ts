import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack } from "./stack.js";
import { parseGitHubSource, cloneToDir, getRepoCommitSha } from "../sources/github.js";
import { removeDir } from "../shared/utils.js";
import type { StackBundle } from "../shared/schema.js";

// --- Public interfaces ---

export interface ResolvedNode {
  source: string;
  stackDir: string;
  bundle: StackBundle;
  depth: number;
  resolvedCommit?: string;
}

export interface ResolvedGraph {
  nodes: ResolvedNode[];
  warnings: string[];
}

export interface ResolveOptions {
  maxDepth?: number;
  skipExtends?: boolean;
}

// --- Constants ---

const DEFAULT_MAX_DEPTH = 10;

// --- Source normalization ---

function normalizeSource(entry: string, parentDir: string): string {
  const gh = parseGitHubSource(entry);
  if (gh) {
    return `github:${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ""}`;
  }
  // Local path: resolve relative to parent stack's directory
  return path.resolve(parentDir, entry);
}

// --- Core resolution ---

export async function resolveGraph(
  stackDir: string,
  options?: ResolveOptions,
): Promise<ResolvedGraph> {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const skipExtends = options?.skipExtends ?? false;

  const bundle = await readStack(stackDir);

  // Single-node graph: no extends or explicitly skipped
  if (skipExtends || !bundle.manifest.extends?.length) {
    return {
      nodes: [{ source: stackDir, stackDir, bundle, depth: 0 }],
      warnings: [],
    };
  }

  // Create shared temp dir for all GitHub clones
  const tmpBase = await mkdtemp(path.join(tmpdir(), "pit-resolve-"));
  const warnings: string[] = [];

  // visited: normalized source -> ResolvedNode (dedup for diamond deps)
  const visited = new Map<string, ResolvedNode>();

  // result collects nodes in merge order (deepest first)
  const result: ResolvedNode[] = [];

  try {
    // Walk the root stack's extends (adds all dependencies deepest-first)
    await walk(stackDir, bundle, 0, []);

    // Add root node last (merge order: deepest deps first, root last)
    result.push({ source: stackDir, stackDir, bundle, depth: 0 });

    return { nodes: result, warnings };
  } finally {
    await removeDir(tmpBase);
  }

  // --- Recursive DFS walker ---
  async function walk(
    currentDir: string,
    currentBundle: StackBundle,
    depth: number,
    chain: string[],
  ): Promise<void> {
    const extendsEntries = currentBundle.manifest.extends;
    if (!extendsEntries?.length) {
      return;
    }

    const nextDepth = depth + 1;
    if (nextDepth > maxDepth) {
      throw new Error(
        `Dependency "${currentBundle.manifest.name}" at depth ${depth} exceeds maximum depth of ${maxDepth}. ` +
          `Use --max-depth to increase the limit or check for unnecessarily deep chains.`,
      );
    }

    // Pre-fetch all siblings in parallel (resolve GitHub clones + local reads)
    const fetched = await Promise.all(
      extendsEntries.map((entry) => fetchEntry(entry, currentDir)),
    );

    // Process in declared order (depth-first)
    for (let i = 0; i < extendsEntries.length; i++) {
      const entry = extendsEntries[i]!;
      const { normalized, stackDir: depDir, bundle: depBundle, resolvedCommit } = fetched[i]!;

      // Cycle detection: check the current DFS path
      if (chain.includes(normalized)) {
        const cycleChain = [...chain, normalized];
        throw new Error(
          `Circular dependency detected: ${cycleChain.join(" \u2192 ")}`,
        );
      }

      // Diamond dedup: already fully processed this node
      if (visited.has(normalized)) {
        continue;
      }

      // Recurse into this dependency's extends (DFS)
      await walk(depDir, depBundle, nextDepth, [...chain, normalized]);

      // After recursion, add this node (deepest deps already added)
      const node: ResolvedNode = {
        source: entry,
        stackDir: depDir,
        bundle: depBundle,
        depth: nextDepth,
        resolvedCommit,
      };
      visited.set(normalized, node);
      result.push(node);
    }
  }

  // --- Fetch a single extends entry ---
  async function fetchEntry(
    entry: string,
    parentDir: string,
  ): Promise<{
    normalized: string;
    stackDir: string;
    bundle: StackBundle;
    resolvedCommit?: string;
  }> {
    const normalized = normalizeSource(entry, parentDir);
    const gh = parseGitHubSource(entry);

    if (gh) {
      // GitHub source
      const { stackDir: depDir } = await cloneToDir(gh, tmpBase);
      const depBundle = await readStack(depDir);
      // Get commit SHA from the cloned repo dir (parent of .promptpit)
      const repoDir = path.dirname(depDir);
      const resolvedCommit = getRepoCommitSha(repoDir);
      return { normalized, stackDir: depDir, bundle: depBundle, resolvedCommit };
    }

    // Local path source
    const depDir = path.resolve(parentDir, entry);
    const depBundle = await readStack(depDir);
    return { normalized, stackDir: depDir, bundle: depBundle };
  }
}
