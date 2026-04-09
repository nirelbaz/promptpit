# Stack Composition (`extends`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `extends` to stack.json so stacks can layer on top of each other — enabling multi-team setups where a base stack provides org defaults and team stacks override selectively.

**Architecture:** Two-phase resolution (`resolveGraph` + `mergeGraph`) in a new `src/core/resolve.ts`. Graph walks extends depth-first with parallel sibling fetches, cycle detection, depth limit 10. Merge applies last-declared-wins for all content types except instructions (which concatenate). Commands get new flags: `install --save`, `collect --include-extends`, `status --skip-upstream`.

**Tech Stack:** TypeScript, Zod (schema), vitest (tests), existing `cloneAndResolve` for GitHub fetching

**Spec:** `docs/specs/2026-04-09-stack-composition-extends-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shared/schema.ts` | Modify | Add `extends`, `instructionStrategy` to StackManifest; add `resolvedExtends` to InstallEntry |
| `src/core/resolve.ts` | Create | `resolveGraph()` + `mergeGraph()` — the core composition engine |
| `src/core/merger.ts` | Modify | Rename `mergeConfigs` → `mergeAdapterConfigs` + doc comment |
| `src/commands/collect.ts` | Modify | Import rename; preserve extends on re-collect; `--include-extends` flag |
| `src/sources/github.ts` | Modify | Add `cloneToDir()` overload for shared temp dir |
| `src/commands/install.ts` | Modify | `--save` flag; no-args extends resolution; manifest `resolvedExtends` |
| `src/commands/status.ts` | Modify | Upstream extends drift detection; `--skip-upstream` flag |
| `src/core/validate.ts` | Modify | Syntax validation for extends entries |
| `src/cli.ts` | Modify | Wire `--save`, `--include-extends`, `--skip-upstream` flags |
| `test/__fixtures__/extends/` | Create | 4 fixture stacks for tests |
| `test/core/resolve.test.ts` | Create | Unit tests for resolveGraph |
| `test/core/resolve.merge.test.ts` | Create | Unit tests for mergeGraph |
| `test/commands/install-extends.test.ts` | Create | Integration tests for install with extends |
| `test/commands/collect-extends.test.ts` | Create | Integration tests for collect with extends |

---

### Task 1: Schema Changes

**Files:**
- Modify: `src/shared/schema.ts`
- Modify: `test/core/stack.test.ts` (if exists, else note in step)

- [ ] **Step 1: Write failing tests for new schema fields**

Create `test/core/schema-extends.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stackManifestSchema, installManifestSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema extends fields", () => {
  const base = { name: "test", version: "1.0.0" };

  it("accepts stack without extends (backwards compat)", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts extends with github sources", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      extends: ["github:acme/base-stack@1.0.0", "github:acme/other"],
    });
    expect(result.success).toBe(true);
    expect(result.data!.extends).toEqual(["github:acme/base-stack@1.0.0", "github:acme/other"]);
  });

  it("accepts extends with local paths", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      extends: ["../shared/.promptpit"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty extends array", () => {
    const result = stackManifestSchema.safeParse({ ...base, extends: [] });
    expect(result.success).toBe(true);
  });

  it("rejects non-string extends entries", () => {
    const result = stackManifestSchema.safeParse({ ...base, extends: [123] });
    expect(result.success).toBe(false);
  });

  it("accepts instructionStrategy concatenate", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "concatenate",
    });
    expect(result.success).toBe(true);
  });

  it("accepts instructionStrategy override", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "override",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid instructionStrategy", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts stack without instructionStrategy (defaults to concatenate)", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data!.instructionStrategy).toBeUndefined();
  });
});

describe("installManifestSchema resolvedExtends", () => {
  it("accepts install entry with resolvedExtends", () => {
    const manifest = {
      version: 1,
      installs: [{
        stack: "test",
        stackVersion: "1.0.0",
        installedAt: "2026-04-09T00:00:00Z",
        adapters: {},
        resolvedExtends: [{
          source: "github:acme/base@1.0.0",
          version: "1.0.0",
          resolvedCommit: "abc123",
          resolvedAt: "2026-04-09T00:00:00Z",
        }],
      }],
    };
    const result = installManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("accepts install entry without resolvedExtends (backwards compat)", () => {
    const manifest = {
      version: 1,
      installs: [{
        stack: "test",
        stackVersion: "1.0.0",
        installedAt: "2026-04-09T00:00:00Z",
        adapters: {},
      }],
    };
    const result = installManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/core/schema-extends.test.ts`
Expected: Multiple failures — `extends` and `instructionStrategy` fields stripped by schema, `resolvedExtends` not in install entry schema.

- [ ] **Step 3: Add extends and instructionStrategy to StackManifest schema**

In `src/shared/schema.ts`, add to the `stackManifestSchema` object (after the `compatibility` field):

```typescript
  extends: z.array(z.string()).optional(),
  instructionStrategy: z.enum(["concatenate", "override"]).optional(),
```

- [ ] **Step 4: Add resolvedExtends to InstallEntry schema**

In `src/shared/schema.ts`, add a new schema and update `installEntrySchema`:

```typescript
const resolvedExtendsEntrySchema = z.object({
  source: z.string(),
  version: z.string().optional(),
  resolvedCommit: z.string().optional(),
  resolvedAt: z.string(),
});
```

Add to `installEntrySchema` (after `installMode`):

```typescript
  resolvedExtends: z.array(resolvedExtendsEntrySchema).optional(),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/core/schema-extends.test.ts`
Expected: All pass.

- [ ] **Step 6: Run full test suite for regressions**

Run: `npm test`
Expected: All existing tests pass (backwards compatible changes).

- [ ] **Step 7: Commit**

```bash
git add src/shared/schema.ts test/core/schema-extends.test.ts
git commit -m "feat: add extends and instructionStrategy to stack schema"
```

---

### Task 2: Rename mergeConfigs → mergeAdapterConfigs

**Files:**
- Modify: `src/core/merger.ts`
- Modify: `src/commands/collect.ts` (import)
- Modify: `test/core/merger.test.ts` (import)

- [ ] **Step 1: Rename the function and add doc comment**

In `src/core/merger.ts`, rename the function and add a doc comment:

```typescript
/**
 * Merge configs from multiple adapters (Claude Code, Cursor, etc.) into one.
 * Uses first-seen-wins for name collisions — adapters read the same content
 * from different files, so the first occurrence is canonical.
 *
 * NOT the same as stack composition merge (mergeGraph in resolve.ts),
 * which uses last-declared-wins for intentional layering.
 */
export function mergeAdapterConfigs(
```

- [ ] **Step 2: Update import in collect.ts**

In `src/commands/collect.ts`, change:
```typescript
import { mergeConfigs, hasVersionPins } from "../core/merger.js";
```
to:
```typescript
import { mergeAdapterConfigs, hasVersionPins } from "../core/merger.js";
```

And update the call site from `mergeConfigs(configs)` to `mergeAdapterConfigs(configs)`.

- [ ] **Step 3: Update import in merger.test.ts**

In `test/core/merger.test.ts`, change:
```typescript
import { mergeConfigs } from "../../src/core/merger.js";
```
to:
```typescript
import { mergeAdapterConfigs } from "../../src/core/merger.js";
```

And update all `mergeConfigs(` calls to `mergeAdapterConfigs(`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/merger.ts src/commands/collect.ts test/core/merger.test.ts
git commit -m "refactor: rename mergeConfigs to mergeAdapterConfigs for clarity"
```

---

### Task 3: Test Fixtures for Extends

**Files:**
- Create: `test/__fixtures__/extends/base-stack/`
- Create: `test/__fixtures__/extends/team-stack/`
- Create: `test/__fixtures__/extends/deep-chain/`
- Create: `test/__fixtures__/extends/circular-a/`
- Create: `test/__fixtures__/extends/circular-b/`

- [ ] **Step 1: Create base-stack fixture**

`test/__fixtures__/extends/base-stack/stack.json`:
```json
{
  "name": "base-stack",
  "version": "1.0.0",
  "description": "Base org stack",
  "skills": ["skills/lint"],
  "rules": ["rules/security"],
  "compatibility": ["claude-code"]
}
```

`test/__fixtures__/extends/base-stack/agent.promptpit.md`:
```markdown
---
name: base-stack
description: Base org instructions
---

Follow OWASP Top 10 guidelines.
Always use TypeScript strict mode.
```

`test/__fixtures__/extends/base-stack/skills/lint/SKILL.md`:
```markdown
---
name: lint
description: Run the linter
---

Run eslint on all changed files.
```

`test/__fixtures__/extends/base-stack/rules/security.md`:
```markdown
---
name: security
description: Security rules
---

Never commit secrets to git.
```

`test/__fixtures__/extends/base-stack/mcp.json`:
```json
{
  "github-mcp": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"]
  }
}
```

`test/__fixtures__/extends/base-stack/.env.example`:
```
GITHUB_TOKEN= # Your GitHub personal access token
```

- [ ] **Step 2: Create team-stack fixture (extends base-stack)**

`test/__fixtures__/extends/team-stack/stack.json`:
```json
{
  "name": "team-stack",
  "version": "1.0.0",
  "description": "Frontend team stack",
  "extends": ["../base-stack"],
  "skills": ["skills/component-gen"],
  "rules": ["rules/security"],
  "compatibility": ["claude-code"]
}
```

`test/__fixtures__/extends/team-stack/agent.promptpit.md`:
```markdown
---
name: team-stack
description: Frontend team instructions
---

Use React 19. Prefer server components.
```

`test/__fixtures__/extends/team-stack/skills/component-gen/SKILL.md`:
```markdown
---
name: component-gen
description: Generate React components
---

Generate React components with TypeScript.
```

`test/__fixtures__/extends/team-stack/rules/security.md`:
```markdown
---
name: security
description: Team security rules (overrides base)
---

Never commit secrets to git. Use environment variables for all API keys.
```

`test/__fixtures__/extends/team-stack/mcp.json`:
```json
{
  "figma-mcp": {
    "command": "npx",
    "args": ["-y", "@anthropic/figma-mcp"]
  }
}
```

- [ ] **Step 3: Create deep-chain fixture (3 levels)**

`test/__fixtures__/extends/deep-chain/level-0/stack.json`:
```json
{
  "name": "level-0",
  "version": "1.0.0",
  "skills": ["skills/base-skill"]
}
```

`test/__fixtures__/extends/deep-chain/level-0/skills/base-skill/SKILL.md`:
```markdown
---
name: base-skill
description: Base level skill
---

Base skill content.
```

`test/__fixtures__/extends/deep-chain/level-0/agent.promptpit.md`:
```markdown
---
name: level-0
description: Level 0
---

Level 0 instructions.
```

`test/__fixtures__/extends/deep-chain/level-1/stack.json`:
```json
{
  "name": "level-1",
  "version": "1.0.0",
  "extends": ["../level-0"],
  "skills": ["skills/mid-skill"]
}
```

`test/__fixtures__/extends/deep-chain/level-1/skills/mid-skill/SKILL.md`:
```markdown
---
name: mid-skill
description: Mid level skill
---

Mid skill content.
```

`test/__fixtures__/extends/deep-chain/level-1/agent.promptpit.md`:
```markdown
---
name: level-1
description: Level 1
---

Level 1 instructions.
```

`test/__fixtures__/extends/deep-chain/level-2/stack.json`:
```json
{
  "name": "level-2",
  "version": "1.0.0",
  "extends": ["../level-1"],
  "skills": ["skills/top-skill"]
}
```

`test/__fixtures__/extends/deep-chain/level-2/skills/top-skill/SKILL.md`:
```markdown
---
name: top-skill
description: Top level skill
---

Top skill content.
```

`test/__fixtures__/extends/deep-chain/level-2/agent.promptpit.md`:
```markdown
---
name: level-2
description: Level 2
---

Level 2 instructions.
```

- [ ] **Step 4: Create circular fixtures**

`test/__fixtures__/extends/circular-a/stack.json`:
```json
{
  "name": "circular-a",
  "version": "1.0.0",
  "extends": ["../circular-b"]
}
```

`test/__fixtures__/extends/circular-a/agent.promptpit.md`:
```markdown
---
name: circular-a
description: Circular A
---

A instructions.
```

`test/__fixtures__/extends/circular-b/stack.json`:
```json
{
  "name": "circular-b",
  "version": "1.0.0",
  "extends": ["../circular-a"]
}
```

`test/__fixtures__/extends/circular-b/agent.promptpit.md`:
```markdown
---
name: circular-b
description: Circular B
---

B instructions.
```

- [ ] **Step 5: Commit fixtures**

```bash
git add test/__fixtures__/extends/
git commit -m "test: add fixture stacks for extends composition tests"
```

---

### Task 4: resolveGraph — Core Graph Resolution

**Files:**
- Create: `src/core/resolve.ts`
- Modify: `src/sources/github.ts` (add `cloneToDir` helper)
- Create: `test/core/resolve.test.ts`

- [ ] **Step 1: Add `cloneToDir` helper to github.ts**

In `src/sources/github.ts`, add a function that clones into a caller-provided directory instead of creating its own temp dir. Add after the existing `cloneAndResolve`:

```typescript
/**
 * Clone a GitHub repo into a specific directory (for shared temp dir during extends resolution).
 * Returns the stackDir within that directory. Caller manages temp dir cleanup.
 */
export async function cloneToDir(
  gh: GitHubSource,
  parentDir: string,
): Promise<{ stackDir: string }> {
  const repoDir = path.join(parentDir, `${gh.owner}-${gh.repo}${gh.ref ? `-${gh.ref}` : ""}`);
  const url = `https://github.com/${gh.owner}/${gh.repo}.git`;

  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("git is not installed or not in PATH. Install git to use github: sources.");
  }

  const args = ["clone", "--depth", "1"];
  if (gh.ref) args.push("--branch", gh.ref);
  args.push(url, repoDir);

  try {
    execFileSync("git", args, { stdio: "pipe", timeout: 60000 });
  } catch {
    throw new Error(
      `Could not clone ${url}. Check that the repository exists and is accessible.`,
    );
  }

  const promptpitDir = path.join(repoDir, ".promptpit");
  if (await exists(promptpitDir)) {
    return { stackDir: promptpitDir };
  }

  // Auto-collect fallback
  const autoDir = path.join(parentDir, `${gh.owner}-${gh.repo}-collected`);
  try {
    await collectStack(repoDir, autoDir, {});
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("No AI tool configuration")) {
      throw new Error(
        `No AI tool configuration found in ${gh.owner}/${gh.repo}. ` +
          `This repository doesn't appear to have any AI agent configs to collect.`,
      );
    }
    throw err;
  }

  return { stackDir: autoDir };
}
```

Also add a helper to get the commit SHA of a cloned repo:

```typescript
/** Get the HEAD commit SHA of a git repo directory. */
export function getRepoCommitSha(repoDir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).toString().trim();
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Write failing tests for resolveGraph**

Create `test/core/resolve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveGraph } from "../../src/core/resolve.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("resolveGraph", () => {
  it("returns single-node graph for stack without extends", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "base-stack"));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("base-stack");
    expect(graph.nodes[0]!.depth).toBe(0);
  });

  it("resolves two-level extends chain", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    expect(graph.nodes).toHaveLength(2);
    // base-stack first (deepest dep), team-stack last (root)
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("base-stack");
    expect(graph.nodes[0]!.depth).toBe(1);
    expect(graph.nodes[1]!.bundle.manifest.name).toBe("team-stack");
    expect(graph.nodes[1]!.depth).toBe(0);
  });

  it("resolves three-level deep chain in correct order", async () => {
    const graph = await resolveGraph(
      path.join(FIXTURES, "deep-chain", "level-2"),
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((n) => n.bundle.manifest.name)).toEqual([
      "level-0",
      "level-1",
      "level-2",
    ]);
  });

  it("detects circular dependencies", async () => {
    await expect(
      resolveGraph(path.join(FIXTURES, "circular-a")),
    ).rejects.toThrow(/Circular dependency detected/);
  });

  it("includes full chain in circular dependency error", async () => {
    try {
      await resolveGraph(path.join(FIXTURES, "circular-a"));
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain("circular-a");
      expect(msg).toContain("circular-b");
    }
  });

  it("errors when depth exceeds limit", async () => {
    await expect(
      resolveGraph(path.join(FIXTURES, "deep-chain", "level-2"), {
        maxDepth: 1,
      }),
    ).rejects.toThrow(/exceeds maximum depth/);
  });

  it("returns single-node graph when skipExtends is true", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"), {
      skipExtends: true,
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("team-stack");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/core/resolve.test.ts`
Expected: FAIL — `resolveGraph` doesn't exist yet.

- [ ] **Step 4: Implement resolveGraph**

Create `src/core/resolve.ts`:

```typescript
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack, tryReadStackManifest } from "./stack.js";
import { parseGitHubSource, cloneToDir, getRepoCommitSha } from "../sources/github.js";
import { removeDir } from "../shared/utils.js";
import type { StackBundle, StackManifest } from "../shared/schema.js";

// -- Types --

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

// -- resolveGraph --

const DEFAULT_MAX_DEPTH = 10;

export async function resolveGraph(
  stackDir: string,
  options: ResolveOptions = {},
): Promise<ResolvedGraph> {
  const { maxDepth = DEFAULT_MAX_DEPTH, skipExtends = false } = options;
  const bundle = await readStack(stackDir);
  const extendsEntries = bundle.manifest.extends;

  if (skipExtends || !extendsEntries || extendsEntries.length === 0) {
    return {
      nodes: [{ source: stackDir, stackDir, bundle, depth: 0 }],
      warnings: [],
    };
  }

  // Create shared temp dir for all GitHub fetches
  let sharedTmpDir: string | null = null;
  try {
    sharedTmpDir = await mkdtemp(path.join(tmpdir(), "pit-resolve-"));
    const visited = new Set<string>();
    const chain: string[] = [];
    const nodes: ResolvedNode[] = [];
    const warnings: string[] = [];

    await walkExtends(
      stackDir,
      extendsEntries,
      0,
      maxDepth,
      visited,
      chain,
      nodes,
      warnings,
      sharedTmpDir,
    );

    // Root node goes last
    nodes.push({ source: stackDir, stackDir, bundle, depth: 0 });

    return { nodes, warnings };
  } finally {
    if (sharedTmpDir) {
      await removeDir(sharedTmpDir);
    }
  }
}

async function walkExtends(
  parentDir: string,
  entries: string[],
  currentDepth: number,
  maxDepth: number,
  visited: Set<string>,
  chain: string[],
  nodes: ResolvedNode[],
  warnings: string[],
  sharedTmpDir: string,
): Promise<void> {
  if (currentDepth >= maxDepth) {
    throw new Error(
      `Extends chain exceeds maximum depth of ${maxDepth} at "${entries[0]}"`,
    );
  }

  // Resolve all siblings in parallel (fetch step), then process sequentially for ordering
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      const normalized = normalizeSource(entry, parentDir);
      return { entry, normalized, ...(await fetchExtends(entry, parentDir, sharedTmpDir)) };
    }),
  );

  // Process in declared order for deterministic merge
  for (const { entry, normalized, stackDir, resolvedCommit } of resolved) {
    if (visited.has(normalized)) {
      // Diamond: already processed this dep — skip silently
      continue;
    }

    // Cycle detection
    if (chain.includes(normalized)) {
      const cycleChain = [...chain, normalized].join(" \u2192 ");
      throw new Error(`Circular dependency detected: ${cycleChain}`);
    }

    visited.add(normalized);
    chain.push(normalized);

    const bundle = await readStack(stackDir);
    const childExtends = bundle.manifest.extends;

    // Recurse into this dependency's own extends
    if (childExtends && childExtends.length > 0) {
      await walkExtends(
        stackDir,
        childExtends,
        currentDepth + 1,
        maxDepth,
        visited,
        chain,
        nodes,
        warnings,
        sharedTmpDir,
      );
    }

    nodes.push({
      source: entry,
      stackDir,
      bundle,
      depth: currentDepth + 1,
      resolvedCommit,
    });

    chain.pop();
  }
}

async function fetchExtends(
  entry: string,
  parentDir: string,
  sharedTmpDir: string,
): Promise<{ stackDir: string; resolvedCommit?: string }> {
  const gh = parseGitHubSource(entry);
  if (gh) {
    const result = await cloneToDir(gh, sharedTmpDir);
    const repoDir = path.join(
      sharedTmpDir,
      `${gh.owner}-${gh.repo}${gh.ref ? `-${gh.ref}` : ""}`,
    );
    const commit = getRepoCommitSha(repoDir);
    return { stackDir: result.stackDir, resolvedCommit: commit };
  }

  // Local path — resolve relative to parent stack's directory
  const resolved = path.resolve(parentDir, entry);
  return { stackDir: resolved };
}

function normalizeSource(entry: string, parentDir: string): string {
  const gh = parseGitHubSource(entry);
  if (gh) {
    // Normalize to github:owner/repo[@ref] (lowercase)
    return `github:${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ""}`;
  }
  // Local paths: resolve to absolute for dedup
  return path.resolve(parentDir, entry);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/core/resolve.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/resolve.ts src/sources/github.ts test/core/resolve.test.ts
git commit -m "feat: add resolveGraph for extends dependency resolution"
```

---

### Task 5: mergeGraph — Stack Content Merging

**Files:**
- Modify: `src/core/resolve.ts`
- Create: `test/core/resolve.merge.test.ts`

- [ ] **Step 1: Write failing tests for mergeGraph**

Create `test/core/resolve.merge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveGraph, mergeGraph } from "../../src/core/resolve.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("mergeGraph", () => {
  it("passes through single-node graph unchanged", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "base-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.manifest.name).toBe("base-stack");
    expect(merged.conflicts).toHaveLength(0);
  });

  it("merges skills from base and team (union)", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const skillNames = merged.bundle.skills.map((s) => s.name);
    expect(skillNames).toContain("lint"); // from base
    expect(skillNames).toContain("component-gen"); // from team
  });

  it("last-declared-wins for conflicting rules", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    // Both base and team have "security" rule — team should win
    const secRule = merged.bundle.rules.find((r) => r.name === "security");
    expect(secRule).toBeDefined();
    expect(secRule!.content).toContain("Use environment variables");
    // Should have a conflict entry
    const conflict = merged.conflicts.find(
      (c) => c.type === "rule" && c.name === "security",
    );
    expect(conflict).toBeDefined();
    expect(conflict!.winner).toContain("team-stack");
  });

  it("concatenates instructions in order", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const instructions = merged.bundle.agentInstructions;
    // Base instructions come first
    expect(instructions.indexOf("OWASP")).toBeLessThan(
      instructions.indexOf("React 19"),
    );
    // Headers present
    expect(instructions).toContain("## From");
  });

  it("override strategy drops extends instructions", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph, { instructionStrategy: "override" });
    expect(merged.bundle.agentInstructions).toContain("React 19");
    expect(merged.bundle.agentInstructions).not.toContain("OWASP");
  });

  it("merges MCP servers from base and team", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.mcpServers).toHaveProperty("github-mcp");
    expect(merged.bundle.mcpServers).toHaveProperty("figma-mcp");
  });

  it("merges env vars from base (team has none)", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.envExample).toHaveProperty("GITHUB_TOKEN");
  });

  it("tracks provenance in sources map", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.sources.get("lint")).toContain("base-stack");
    expect(merged.sources.get("component-gen")).toContain("team-stack");
  });

  it("deep chain merges in correct order", async () => {
    const graph = await resolveGraph(
      path.join(FIXTURES, "deep-chain", "level-2"),
    );
    const merged = mergeGraph(graph);
    const skillNames = merged.bundle.skills.map((s) => s.name);
    expect(skillNames).toContain("base-skill");
    expect(skillNames).toContain("mid-skill");
    expect(skillNames).toContain("top-skill");
    // Instructions should be in order: level-0, level-1, level-2
    const instr = merged.bundle.agentInstructions;
    expect(instr.indexOf("Level 0")).toBeLessThan(instr.indexOf("Level 1"));
    expect(instr.indexOf("Level 1")).toBeLessThan(instr.indexOf("Level 2"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/core/resolve.merge.test.ts`
Expected: FAIL — `mergeGraph` not exported yet.

- [ ] **Step 3: Implement mergeGraph**

Add to `src/core/resolve.ts`:

```typescript
import type {
  StackBundle,
  SkillEntry,
  AgentEntry,
  RuleEntry,
  CommandEntry,
  McpConfig,
} from "../shared/schema.js";

// -- Types --

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
}

// -- mergeGraph --

export function mergeGraph(
  graph: ResolvedGraph,
  options: MergeOptions = {},
): MergedStack {
  const { instructionStrategy = "concatenate" } = options;

  if (graph.nodes.length === 1) {
    return {
      bundle: graph.nodes[0]!.bundle,
      conflicts: [],
      sources: new Map(),
    };
  }

  const conflicts: ConflictEntry[] = [];
  const sources = new Map<string, string>();

  // Merge left-to-right (deepest deps first, root last — last wins)
  const skills = new Map<string, SkillEntry>();
  const agents = new Map<string, AgentEntry>();
  const rules = new Map<string, RuleEntry>();
  const commands = new Map<string, CommandEntry>();
  const mcpServers: McpConfig = {};
  const envExample: Record<string, string> = {};
  const instructionParts: { source: string; content: string }[] = [];

  for (const node of graph.nodes) {
    const b = node.bundle;
    const src = node.source;

    // Instructions — always collect (concatenate or override handled later)
    if (b.agentInstructions.trim()) {
      instructionParts.push({ source: src, content: b.agentInstructions });
    }

    // Skills — last-declared-wins
    for (const skill of b.skills) {
      if (skills.has(skill.name)) {
        conflicts.push({
          type: "skill",
          name: skill.name,
          from: sources.get(skill.name) ?? "unknown",
          winner: src,
        });
      }
      skills.set(skill.name, skill);
      sources.set(skill.name, src);
    }

    // Agents
    for (const agent of b.agents) {
      if (agents.has(agent.name)) {
        conflicts.push({
          type: "agent",
          name: agent.name,
          from: sources.get(agent.name) ?? "unknown",
          winner: src,
        });
      }
      agents.set(agent.name, agent);
      sources.set(agent.name, src);
    }

    // Rules
    for (const rule of b.rules) {
      if (rules.has(rule.name)) {
        conflicts.push({
          type: "rule",
          name: rule.name,
          from: sources.get(rule.name) ?? "unknown",
          winner: src,
        });
      }
      rules.set(rule.name, rule);
      sources.set(rule.name, src);
    }

    // Commands
    for (const command of b.commands) {
      if (commands.has(command.name)) {
        conflicts.push({
          type: "command",
          name: command.name,
          from: sources.get(command.name) ?? "unknown",
          winner: src,
        });
      }
      commands.set(command.name, command);
      sources.set(command.name, src);
    }

    // MCP servers
    for (const [name, config] of Object.entries(b.mcpServers)) {
      if (name in mcpServers) {
        conflicts.push({
          type: "mcp",
          name,
          from: sources.get(`mcp:${name}`) ?? "unknown",
          winner: src,
        });
      }
      mcpServers[name] = config;
      sources.set(`mcp:${name}`, src);
    }

    // Env vars
    for (const [key, val] of Object.entries(b.envExample)) {
      if (key in envExample) {
        conflicts.push({
          type: "env",
          name: key,
          from: sources.get(`env:${key}`) ?? "unknown",
          winner: src,
        });
      }
      envExample[key] = val;
      sources.set(`env:${key}`, src);
    }
  }

  // Build instructions based on strategy
  const rootNode = graph.nodes[graph.nodes.length - 1]!;
  let agentInstructions: string;
  if (instructionStrategy === "override") {
    agentInstructions = rootNode.bundle.agentInstructions;
  } else {
    agentInstructions = instructionParts
      .map((p) => `## From ${path.basename(p.source)}\n\n${p.content}`)
      .join("\n\n");
  }

  // Build merged manifest from root, updating artifact lists
  const manifest = {
    ...rootNode.bundle.manifest,
    skills: [...skills.values()].map((s) => s.path),
    agents: [...agents.values()].map((a) => a.path),
    rules: [...rules.values()].map((r) => r.path),
    commands: [...commands.values()].map((c) => c.path),
  };

  return {
    bundle: {
      manifest,
      agentInstructions,
      skills: [...skills.values()],
      agents: [...agents.values()],
      rules: [...rules.values()],
      commands: [...commands.values()],
      mcpServers,
      envExample,
    },
    conflicts,
    sources,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/core/resolve.merge.test.ts`
Expected: All pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/resolve.ts test/core/resolve.merge.test.ts
git commit -m "feat: add mergeGraph for extends content merging"
```

---

### Task 6: Install — `--save` Flag and Extends Resolution

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/install-extends.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/commands/install-extends.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeFileEnsureDir } from "../../src/shared/utils.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("installStack with extends", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("resolves extends from local stack.json (no-args mode)", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Copy team-stack (which extends base-stack) into target/.promptpit/
    await cp(path.join(FIXTURES, "team-stack"), path.join(target, ".promptpit"), {
      recursive: true,
    });
    // Copy base-stack next to .promptpit so the relative path resolves
    await cp(path.join(FIXTURES, "base-stack"), path.join(target, "base-stack"), {
      recursive: true,
    });
    // Fix the extends path to be relative to .promptpit/
    const stackJson = JSON.parse(
      await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"),
    );
    stackJson.extends = ["../base-stack"];
    await writeFile(
      path.join(target, ".promptpit", "stack.json"),
      JSON.stringify(stackJson, null, 2),
    );

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    // Should contain instructions from both base and team
    expect(claudeMd).toContain("OWASP");
    expect(claudeMd).toContain("React 19");
  });

  it("no-args install without extends works unchanged", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Copy valid-stack (no extends) into .promptpit/
    const validStack = path.resolve("test/__fixtures__/stacks/valid-stack");
    await cp(validStack, path.join(target, ".promptpit"), { recursive: true });

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:test-stack");
  });

  it("--save appends source to extends in stack.json", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Create an existing .promptpit/stack.json
    await writeFileEnsureDir(
      path.join(target, ".promptpit", "stack.json"),
      JSON.stringify({ name: "my-project", version: "1.0.0" }, null, 2),
    );

    // Install base-stack with --save
    await installStack(path.join(FIXTURES, "base-stack"), target, {
      save: true,
    });

    // Verify extends was added
    const updated = JSON.parse(
      await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"),
    );
    expect(updated.extends).toBeDefined();
    expect(updated.extends).toContain(path.join(FIXTURES, "base-stack"));
  });

  it("--save skips duplicate entries", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const sourcePath = path.join(FIXTURES, "base-stack");
    await writeFileEnsureDir(
      path.join(target, ".promptpit", "stack.json"),
      JSON.stringify(
        { name: "my-project", version: "1.0.0", extends: [sourcePath] },
        null,
        2,
      ),
    );

    await installStack(sourcePath, target, { save: true });

    const updated = JSON.parse(
      await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"),
    );
    // Should still have exactly one entry, not duplicated
    expect(updated.extends.filter((e: string) => e === sourcePath)).toHaveLength(1);
  });

  it("--save without stack.json errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await expect(
      installStack(path.join(FIXTURES, "base-stack"), target, { save: true }),
    ).rejects.toThrow(/No stack.json found/);
  });

  it("--save without explicit source errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-ext-"));
    tmpDirs.push(target);

    await expect(
      installStack(".promptpit", target, { save: true }),
    ).rejects.toThrow(/Cannot use --save/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/commands/install-extends.test.ts`
Expected: FAIL — `save` not in InstallOptions, extends not resolved.

- [ ] **Step 3: Add --save to CLI**

In `src/cli.ts`, add to the install command (after `--prefer-universal`):

```typescript
  .option(
    "--save",
    "Add the source to extends in .promptpit/stack.json",
  )
```

And add `save?: boolean` to the opts type in the action handler.

- [ ] **Step 4: Implement extends resolution and --save in install.ts**

Add `save?: boolean` to `InstallOptions` interface.

At the top of `installStack`, after the `resolvedSource` assignment, add the `--save` guard:

```typescript
  if (opts.save && source === ".promptpit") {
    throw new Error("Cannot use --save without specifying a stack source.");
  }
```

After reading the bundle (after `const bundle = await readStack(resolvedSource)`), add extends resolution for the no-args case:

```typescript
  // If this is a local .promptpit install and it has extends, resolve the graph
  let finalBundle = bundle;
  let resolvedExtendsEntries: Array<{
    source: string;
    version?: string;
    resolvedCommit?: string;
    resolvedAt: string;
  }> = [];

  if (bundle.manifest.extends && bundle.manifest.extends.length > 0) {
    const { resolveGraph, mergeGraph } = await import("../core/resolve.js");
    const graph = await resolveGraph(resolvedSource);
    const merged = mergeGraph(graph, {
      instructionStrategy: bundle.manifest.instructionStrategy ?? "concatenate",
    });

    // Print conflict warnings
    for (const conflict of merged.conflicts) {
      log.warn(
        `${conflict.type} "${conflict.name}" defined in both ${conflict.from} and ${conflict.winner} — using ${conflict.winner}`,
      );
    }

    finalBundle = merged.bundle;

    // Record what was resolved for manifest
    resolvedExtendsEntries = graph.nodes
      .filter((n) => n.depth > 0)
      .map((n) => ({
        source: n.source,
        version: n.bundle.manifest.version,
        resolvedCommit: n.resolvedCommit,
        resolvedAt: new Date().toISOString(),
      }));
  }
```

Then use `finalBundle` instead of `bundle` throughout the rest of the function (adapter detection, writing, manifest).

After writing the manifest, add the `--save` logic:

```typescript
  // --save: append source to extends in local stack.json
  if (opts.save) {
    const localStackJsonPath = path.join(target, ".promptpit", "stack.json");
    const localRaw = await readFileOrNull(localStackJsonPath);
    if (!localRaw) {
      throw new Error(
        "No stack.json found. Run \"pit init\" first, or install without --save.",
      );
    }
    const localManifest = JSON.parse(localRaw);
    const existingExtends: string[] = localManifest.extends ?? [];
    if (!existingExtends.includes(source)) {
      localManifest.extends = [...existingExtends, source];
      await writeFileEnsureDir(
        localStackJsonPath,
        JSON.stringify(localManifest, null, 2) + "\n",
      );
      log.info(`Added "${source}" to extends in .promptpit/stack.json`);
    }
  }
```

Add `resolvedExtends` to the manifest entry (in the `InstallEntry` construction):

```typescript
  ...(resolvedExtendsEntries.length > 0 && { resolvedExtends: resolvedExtendsEntries }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/commands/install-extends.test.ts`
Expected: All pass.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/install.ts src/cli.ts test/commands/install-extends.test.ts
git commit -m "feat: add --save flag and extends resolution to pit install"
```

---

### Task 7: Collect — Preserve extends and `--include-extends`

**Files:**
- Modify: `src/commands/collect.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/collect-extends.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/commands/collect-extends.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeFileEnsureDir } from "../../src/shared/utils.js";

describe("collectStack with extends", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("preserves existing extends field when re-collecting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-collect-ext-"));
    tmpDirs.push(root);

    // Create a Claude Code project
    await writeFile(path.join(root, "CLAUDE.md"), "# My project\n");

    // Create existing .promptpit/stack.json with extends
    await writeFileEnsureDir(
      path.join(root, ".promptpit", "stack.json"),
      JSON.stringify({
        name: "my-project",
        version: "1.0.0",
        extends: ["github:acme/base-stack@1.0.0"],
        instructionStrategy: "override",
      }, null, 2),
    );

    // Collect — should preserve extends and instructionStrategy
    await collectStack(root, path.join(root, ".promptpit"), {});

    const result = JSON.parse(
      await readFile(path.join(root, ".promptpit", "stack.json"), "utf-8"),
    );
    expect(result.extends).toEqual(["github:acme/base-stack@1.0.0"]);
    expect(result.instructionStrategy).toBe("override");
  });

  it("collects normally when no extends exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-collect-ext-"));
    tmpDirs.push(root);
    await writeFile(path.join(root, "CLAUDE.md"), "# My project\n");

    await collectStack(root, path.join(root, ".promptpit"), {});

    const result = JSON.parse(
      await readFile(path.join(root, ".promptpit", "stack.json"), "utf-8"),
    );
    expect(result.extends).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/commands/collect-extends.test.ts`
Expected: FAIL — collect overwrites extends.

- [ ] **Step 3: Implement extends preservation in collect.ts**

In `src/commands/collect.ts`, add `includeExtends?: boolean` to `CollectOptions`.

Before building the bundle (after `const projectInfo = await detectProjectInfo(root)`), read existing stack.json to preserve extends fields:

```typescript
  // Preserve existing extends and instructionStrategy from stack.json
  let preservedExtends: string[] | undefined;
  let preservedInstructionStrategy: "concatenate" | "override" | undefined;
  const existingManifestRaw = await readFileOrNull(path.join(outputDir, "stack.json"));
  if (existingManifestRaw) {
    try {
      const existing = JSON.parse(existingManifestRaw);
      preservedExtends = existing.extends;
      preservedInstructionStrategy = existing.instructionStrategy;
    } catch {
      // Corrupt stack.json — skip preservation
    }
  }
```

Then in the bundle's manifest construction, add the preserved fields:

```typescript
  const bundle: StackBundle = {
    manifest: {
      ...existingFields,
      name: projectInfo.name,
      version: "0.1.0",
      // ... existing fields ...
      ...(preservedExtends && { extends: preservedExtends }),
      ...(preservedInstructionStrategy && { instructionStrategy: preservedInstructionStrategy }),
    },
    // ... rest of bundle ...
  };
```

- [ ] **Step 4: Add --include-extends to CLI**

In `src/cli.ts`, add to the collect command:

```typescript
  .option("--include-extends", "Fetch and flatten extends into the bundle")
```

Pass it through to `collectStack`.

- [ ] **Step 5: Implement --include-extends in collect.ts**

After building the bundle, before writing:

```typescript
  if (opts.includeExtends && bundle.manifest.extends?.length) {
    const { resolveGraph, mergeGraph } = await import("../core/resolve.js");
    const flattenSpin = spinner("Resolving extends...");
    const graph = await resolveGraph(outputDir);
    const merged = mergeGraph(graph, {
      instructionStrategy: bundle.manifest.instructionStrategy ?? "concatenate",
    });
    flattenSpin.succeed(`Resolved ${graph.nodes.length - 1} extended stack(s)`);

    for (const conflict of merged.conflicts) {
      log.warn(
        `${conflict.type} "${conflict.name}" — using ${conflict.winner}`,
      );
    }

    // Replace bundle with merged content, strip extends
    Object.assign(bundle, merged.bundle);
    delete (bundle.manifest as Record<string, unknown>).extends;
    delete (bundle.manifest as Record<string, unknown>).instructionStrategy;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/commands/collect-extends.test.ts`
Expected: All pass.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/commands/collect.ts src/cli.ts test/commands/collect-extends.test.ts
git commit -m "feat: collect preserves extends and supports --include-extends"
```

---

### Task 8: Status — Upstream Drift Detection

**Files:**
- Modify: `src/commands/status.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Read current status.ts to understand the structure**

Read `src/commands/status.ts` fully to understand how `computeStatus` and `statusCommand` work, what output format they use, and where to insert upstream checking.

- [ ] **Step 2: Add --skip-upstream to CLI**

In `src/cli.ts`, add to the status command:

```typescript
  .option("--skip-upstream", "Skip checking upstream extends for updates (offline mode)")
```

Pass `skipUpstream?: boolean` through to `statusCommand`.

- [ ] **Step 3: Implement upstream extends checking in status.ts**

After the existing drift detection loop, add:

```typescript
  // Check upstream extends drift (unless --skip-upstream)
  if (!opts.skipUpstream) {
    for (const install of manifest.installs) {
      if (!install.resolvedExtends?.length) continue;
      for (const ext of install.resolvedExtends) {
        const gh = parseGitHubSource(ext.source);
        if (!gh || !ext.resolvedCommit) continue;
        try {
          // Fetch latest commit SHA without cloning
          const latestSha = execFileSync("git", [
            "ls-remote", `https://github.com/${gh.owner}/${gh.repo}.git`,
            gh.ref ?? "HEAD",
          ], { stdio: ["pipe", "pipe", "pipe"], timeout: 10000 })
            .toString().split("\t")[0]?.trim();

          if (latestSha && latestSha !== ext.resolvedCommit) {
            log.warn(
              `${ext.source}: upstream has changed since install ` +
              `(commit ${ext.resolvedCommit.slice(0, 7)} → ${latestSha.slice(0, 7)})`,
            );
          }
        } catch {
          // Network error — skip silently in status
        }
      }
    }
  }
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All pass. (Status upstream checking uses network, tested manually or in E2E.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/status.ts src/cli.ts
git commit -m "feat: status checks upstream extends drift with --skip-upstream flag"
```

---

### Task 9: Validate — Extends Syntax Validation

**Files:**
- Modify: `src/core/validate.ts`

- [ ] **Step 1: Read current validate.ts**

Read `src/core/validate.ts` to understand the existing validation structure — where warnings and errors are collected, how the result is returned.

- [ ] **Step 2: Add extends validation**

After existing validations, add:

```typescript
  // Validate extends entries (syntax only, no resolution)
  if (manifest.extends) {
    const seen = new Set<string>();
    for (const entry of manifest.extends) {
      // Check for duplicates
      if (seen.has(entry)) {
        warnings.push(`Duplicate extends entry: "${entry}"`);
      }
      seen.add(entry);

      // Check format: github:owner/repo[@ref] or a path
      const gh = parseGitHubSource(entry);
      if (!gh && !entry.startsWith(".") && !entry.startsWith("/")) {
        warnings.push(
          `Extends entry "${entry}" is not a recognized format. ` +
          `Expected github:owner/repo[@ref] or a relative/absolute path.`,
        );
      }
    }

    // Warn if instructionStrategy set without extends
    if (!manifest.extends.length && manifest.instructionStrategy) {
      warnings.push(
        `instructionStrategy is set but extends is empty — it has no effect.`,
      );
    }
  } else if (manifest.instructionStrategy) {
    warnings.push(
      `instructionStrategy is set but extends is not defined — it has no effect.`,
    );
  }
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/validate.ts
git commit -m "feat: validate extends entries syntax in pit validate"
```

---

### Task 10: Integration Tests and Final Verification

**Files:**
- All existing test files

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All 395+ tests pass.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Manual smoke test**

Create a temporary stack and test extends end-to-end:

```bash
cd /tmp && mkdir pit-extends-smoke && cd pit-extends-smoke
mkdir base && cd base
node <project>/dist/cli.js init -y --name base-smoke
echo "Base instructions" > .promptpit/agent.promptpit.md
cd ..
mkdir team && cd team
node <project>/dist/cli.js init -y --name team-smoke
# Manually add extends
cat .promptpit/stack.json | node -e "
  const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  j.extends=['../base/.promptpit'];
  console.log(JSON.stringify(j,null,2))
" > .promptpit/stack.json.tmp && mv .promptpit/stack.json.tmp .promptpit/stack.json

# Test: install resolves extends
node <project>/dist/cli.js install
node <project>/dist/cli.js status
```

Verify: instructions from both base and team appear. Status shows no drift.

- [ ] **Step 5: Commit any fixes**

If the smoke test reveals issues, fix them with targeted commits.

- [ ] **Step 6: Final commit check**

```bash
git log --oneline nirelbaz/stack-composition ^main
```

Review commit history is clean and bisectable.
