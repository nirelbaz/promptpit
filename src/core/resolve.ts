import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack } from "./stack.js";
import { parseGitHubSource, cloneToDir, getRepoCommitSha } from "../sources/github.js";
import { removeDir } from "../shared/utils.js";
import type {
  StackBundle,
  SkillEntry,
  AgentEntry,
  RuleEntry,
  CommandEntry,
  McpConfig,
} from "../shared/schema.js";

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
    // Seed chain with root so cycle errors show: root → A → B → root
    await walk(stackDir, bundle, 0, [path.resolve(stackDir)]);

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

    // Filter out already-visited entries before fetching (avoids wasted clones for diamond deps)
    const entriesToFetch = extendsEntries.filter((entry) => {
      const normalized = normalizeSource(entry, currentDir);
      return !visited.has(normalized);
    });

    // Pre-fetch unvisited siblings in parallel (resolve GitHub clones + local reads)
    const fetched = await Promise.all(
      entriesToFetch.map((entry) => fetchEntry(entry, currentDir)),
    );

    // Process in declared order (depth-first)
    for (let i = 0; i < entriesToFetch.length; i++) {
      const entry = entriesToFetch[i]!;
      const { normalized, stackDir: depDir, bundle: depBundle, resolvedCommit } = fetched[i]!;

      // Cycle detection: check the current DFS path
      if (chain.includes(normalized)) {
        const cycleChain = [...chain, normalized];
        throw new Error(
          `Circular dependency detected: ${cycleChain.join(" \u2192 ")}`,
        );
      }

      // Diamond dedup: may have been visited during recursion of a prior sibling
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

// --- Merge types ---

export interface ConflictEntry {
  type: "skill" | "rule" | "agent" | "mcp" | "command" | "env";
  name: string;
  from: string;
  winner: string;
}

export interface MergedStack {
  bundle: StackBundle;
  conflicts: ConflictEntry[];
  sources: Map<string, string>;
}

export interface MergeOptions {
  instructionStrategy?: "concatenate" | "override";
  /** Skip root node's instructions in the merge (for local installs where
   *  the root's instructions are already in the target file outside the marker). */
  skipRootInstructions?: boolean;
}

/**
 * Result of `applyOverrides`. Entries still requiring a decision live in
 * `unresolved`; `warnings` captures normalized-match and dangling-override
 * advisories callers should log.
 */
export interface OverrideApplication {
  bundle: StackBundle;
  sources: Map<string, string>;
  unresolved: ConflictEntry[];
  applied: ConflictEntry[];
  warnings: string[];
}

// --- Merge implementation ---

export function mergeGraph(
  graph: ResolvedGraph,
  options?: MergeOptions,
): MergedStack {
  const nodes = graph.nodes;
  const strategy = options?.instructionStrategy ?? "concatenate";
  const skipRootInstructions = options?.skipRootInstructions ?? false;

  // Single-node optimization: return directly with empty conflicts/sources
  if (nodes.length === 1) {
    return {
      bundle: nodes[0]!.bundle,
      conflicts: [],
      sources: new Map(),
    };
  }

  // Root node is always the last element in graph.nodes
  const rootNode = nodes[nodes.length - 1]!;

  const conflicts: ConflictEntry[] = [];
  const sources = new Map<string, string>();

  // Accumulate merged items (keyed by name, last-declared-wins)
  const skillMap = new Map<string, SkillEntry>();
  const agentMap = new Map<string, AgentEntry>();
  const ruleMap = new Map<string, RuleEntry>();
  const commandMap = new Map<string, CommandEntry>();
  const mcpMap = new Map<string, McpConfig[string]>();
  const envMap = new Map<string, string>();

  // Collect instructions in order
  const instructionParts: string[] = [];

  // Process nodes left-to-right (deepest deps first, root last)
  for (const node of nodes) {
    const source = node.source;
    const sourceName = path.basename(source);
    const bundle = node.bundle;

    // Instructions
    const isRoot = node === rootNode;
    if (bundle.agentInstructions && !(isRoot && skipRootInstructions)) {
      if (strategy === "concatenate") {
        instructionParts.push(
          `## From ${sourceName}\n\n${bundle.agentInstructions}`,
        );
      }
      // For "override", we only use root node's instructions (handled after loop)
    }

    // Skills: last-declared-wins
    for (const skill of bundle.skills) {
      if (skillMap.has(skill.name)) {
        conflicts.push({
          type: "skill",
          name: skill.name,
          from: sources.get(skill.name)!,
          winner: source,
        });
      }
      skillMap.set(skill.name, skill);
      sources.set(skill.name, source);
    }

    // Agents: last-declared-wins
    for (const agent of bundle.agents) {
      if (agentMap.has(agent.name)) {
        conflicts.push({
          type: "agent",
          name: agent.name,
          from: sources.get(agent.name)!,
          winner: source,
        });
      }
      agentMap.set(agent.name, agent);
      sources.set(agent.name, source);
    }

    // Rules: last-declared-wins
    for (const rule of bundle.rules) {
      if (ruleMap.has(rule.name)) {
        conflicts.push({
          type: "rule",
          name: rule.name,
          from: sources.get(rule.name)!,
          winner: source,
        });
      }
      ruleMap.set(rule.name, rule);
      sources.set(rule.name, source);
    }

    // Commands: last-declared-wins
    for (const command of bundle.commands) {
      if (commandMap.has(command.name)) {
        conflicts.push({
          type: "command",
          name: command.name,
          from: sources.get(command.name)!,
          winner: source,
        });
      }
      commandMap.set(command.name, command);
      sources.set(command.name, source);
    }

    // MCP servers: last-declared-wins
    for (const [serverName, serverConfig] of Object.entries(bundle.mcpServers)) {
      const mcpKey = `mcp:${serverName}`;
      if (mcpMap.has(serverName)) {
        conflicts.push({
          type: "mcp",
          name: serverName,
          from: sources.get(mcpKey)!,
          winner: source,
        });
      }
      mcpMap.set(serverName, serverConfig);
      sources.set(mcpKey, source);
    }

    // Env vars: last-declared-wins
    for (const [envKey, envVal] of Object.entries(bundle.envExample)) {
      const envSourceKey = `env:${envKey}`;
      if (envMap.has(envKey)) {
        conflicts.push({
          type: "env",
          name: envKey,
          from: sources.get(envSourceKey)!,
          winner: source,
        });
      }
      envMap.set(envKey, envVal);
      sources.set(envSourceKey, source);
    }
  }

  // Build instructions
  let agentInstructions: string;
  if (strategy === "override" && !skipRootInstructions) {
    agentInstructions = rootNode.bundle.agentInstructions;
  } else if (strategy === "override" && skipRootInstructions) {
    // Override + skip root = no instructions in marker (root's are already in the file)
    agentInstructions = "";
  } else {
    agentInstructions = instructionParts.join("\n\n");
  }

  // Build merged MCP config
  const mcpServers: McpConfig = {};
  for (const [name, config] of mcpMap) {
    mcpServers[name] = config;
  }

  // Build merged env
  const envExample: Record<string, string> = {};
  for (const [key, val] of envMap) {
    envExample[key] = val;
  }

  // Build merged manifest from root, with updated arrays
  const skills = Array.from(skillMap.values());
  const agents = Array.from(agentMap.values());
  const rules = Array.from(ruleMap.values());
  const commands = Array.from(commandMap.values());

  const manifest = {
    ...rootNode.bundle.manifest,
    skills: skills.map((s) => s.name),
    agents: agents.map((a) => a.name),
    rules: rules.map((r) => r.name),
    commands: commands.map((c) => c.name),
  };

  return {
    bundle: {
      manifest,
      agentInstructions,
      skills,
      agents,
      rules,
      commands,
      mcpServers,
      envExample,
    },
    conflicts,
    sources,
  };
}

// --- Override application ---

/**
 * Strip `@ref` from a github source identifier so version bumps don't
 * invalidate existing overrides. Local paths are returned unchanged.
 */
export function normalizeOverrideSource(source: string): string {
  const m = source.match(/^(github:[^@]+)@.+$/);
  return m ? m[1]! : source;
}

/**
 * Apply a set of declarative conflict resolutions to a merged stack.
 *
 * Override keys are `"type:name"` (e.g., `"skill:deploy"`). Values are the
 * source identifier of the node whose definition should win. Matching
 * prefers exact source match, then falls back to a normalized match
 * (stripping `@version` from github sources) and emits a warning. Dangling
 * overrides — keys whose source isn't in the graph even after normalization
 * — emit a warning and are ignored.
 *
 * Any conflict the overrides can't resolve is returned in `unresolved` so
 * the caller can prompt interactively or fall back to last-declared-wins.
 */
export function applyOverrides(
  merged: MergedStack,
  graph: ResolvedGraph,
  overrides: Record<string, string> | undefined,
): OverrideApplication {
  const warnings: string[] = [];
  const applied: ConflictEntry[] = [];
  const unresolved: ConflictEntry[] = [];

  if (!overrides || Object.keys(overrides).length === 0) {
    return {
      bundle: merged.bundle,
      sources: merged.sources,
      unresolved: merged.conflicts.slice(),
      applied,
      warnings,
    };
  }

  // Clone so we can mutate safely.
  const sources = new Map(merged.sources);
  const bundle: StackBundle = {
    ...merged.bundle,
    skills: merged.bundle.skills.slice(),
    agents: merged.bundle.agents.slice(),
    rules: merged.bundle.rules.slice(),
    commands: merged.bundle.commands.slice(),
    mcpServers: { ...merged.bundle.mcpServers },
    envExample: { ...merged.bundle.envExample },
  };

  const graphSources = new Map(graph.nodes.map((n) => [n.source, n]));
  const normalizedGraphSources = new Map(
    graph.nodes.map((n) => [normalizeOverrideSource(n.source), n]),
  );

  const resolveSourceNode = (wanted: string): ResolvedNode | undefined => {
    // 1. Exact source-string match (handles the "author writes the same string
    //    they used in extends" case).
    const exact = graphSources.get(wanted);
    if (exact) return exact;

    // 2. Normalized github match (strips @version so version bumps don't
    //    silently invalidate saved overrides).
    const normalized = normalizedGraphSources.get(
      normalizeOverrideSource(wanted),
    );
    if (normalized) {
      warnings.push(
        `override source "${wanted}" resolved via normalized match to "${normalized.source}" — verify with pit diff`,
      );
      return normalized;
    }

    // 3. Local absolute-path match against each node's stackDir. Handles
    //    users who wrote an absolute path in overrides even though the
    //    extends entry was relative.
    if (path.isAbsolute(wanted)) {
      const match = graph.nodes.find((n) => path.resolve(n.stackDir) === path.resolve(wanted));
      if (match) return match;
    }

    return undefined;
  };

  for (const conflict of merged.conflicts) {
    const key = `${conflict.type}:${conflict.name}`;
    const wantedSource = overrides[key];

    if (!wantedSource) {
      unresolved.push(conflict);
      continue;
    }

    // Override picks the current winner — nothing to swap.
    if (
      wantedSource === conflict.winner ||
      normalizeOverrideSource(wantedSource) ===
        normalizeOverrideSource(conflict.winner)
    ) {
      applied.push(conflict);
      continue;
    }

    const wantedNode = resolveSourceNode(wantedSource);
    if (!wantedNode) {
      warnings.push(
        `override for ${key} references "${wantedSource}" which is not in the extends graph — ignoring`,
      );
      unresolved.push(conflict);
      continue;
    }

    const swapped = swapArtifact(bundle, conflict, wantedNode);
    if (swapped) {
      sources.set(
        conflict.type === "mcp"
          ? `mcp:${conflict.name}`
          : conflict.type === "env"
            ? `env:${conflict.name}`
            : conflict.name,
        wantedNode.source,
      );
      applied.push(conflict);
    } else {
      warnings.push(
        `override for ${key} could not locate a matching artifact in "${wantedNode.source}" — ignoring`,
      );
      unresolved.push(conflict);
    }
  }

  return { bundle, sources, unresolved, applied, warnings };
}

/**
 * Replace the merged entry for a conflict with the version from `node`.
 * Returns true if the swap succeeded.
 */
function swapArtifact(
  bundle: StackBundle,
  conflict: ConflictEntry,
  node: ResolvedNode,
): boolean {
  switch (conflict.type) {
    case "skill": {
      const replacement = node.bundle.skills.find(
        (s) => s.name === conflict.name,
      );
      if (!replacement) return false;
      const idx = bundle.skills.findIndex((s) => s.name === conflict.name);
      if (idx < 0) return false;
      bundle.skills[idx] = replacement;
      return true;
    }
    case "agent": {
      const replacement = node.bundle.agents.find(
        (a) => a.name === conflict.name,
      );
      if (!replacement) return false;
      const idx = bundle.agents.findIndex((a) => a.name === conflict.name);
      if (idx < 0) return false;
      bundle.agents[idx] = replacement;
      return true;
    }
    case "rule": {
      const replacement = node.bundle.rules.find(
        (r) => r.name === conflict.name,
      );
      if (!replacement) return false;
      const idx = bundle.rules.findIndex((r) => r.name === conflict.name);
      if (idx < 0) return false;
      bundle.rules[idx] = replacement;
      return true;
    }
    case "command": {
      const replacement = node.bundle.commands.find(
        (c) => c.name === conflict.name,
      );
      if (!replacement) return false;
      const idx = bundle.commands.findIndex((c) => c.name === conflict.name);
      if (idx < 0) return false;
      bundle.commands[idx] = replacement;
      return true;
    }
    case "mcp": {
      const replacement = node.bundle.mcpServers[conflict.name];
      if (!replacement) return false;
      bundle.mcpServers[conflict.name] = replacement;
      return true;
    }
    case "env": {
      const replacement = node.bundle.envExample[conflict.name];
      if (replacement === undefined) return false;
      bundle.envExample[conflict.name] = replacement;
      return true;
    }
  }
}
