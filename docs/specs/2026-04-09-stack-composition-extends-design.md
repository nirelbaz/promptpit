# Stack Composition (`extends`) — Design Spec

**Date:** 2026-04-09
**Status:** Draft
**Branch:** nirelbaz/stack-composition

## Overview

Stack composition via `extends` in stack.json. A stack can declare dependencies on
other stacks (GitHub or local path). `pit install` recursively fetches and resolves
the dependency graph. Base instructions merge first, team overrides layer on top.

This is the feature that makes multi-team setups practical: a company publishes a
base stack with org-wide instructions, MCP servers, and security rules. Individual
teams extend it with team-specific skills and overrides. Independent skill authors
publish small focused stacks that projects compose horizontally.

## Schema Changes

Two new optional fields in stack.json (`StackManifest` in `src/shared/schema.ts`):

```json
{
  "name": "acme-frontend",
  "version": "1.0.0",
  "extends": [
    "github:acme/base-stack@1.0.0",
    "github:acme/security-stack",
    "../shared-stack/.promptpit"
  ],
  "instructionStrategy": "concatenate",
  "skills": ["skills/component-gen"]
}
```

### `extends`

Optional string array. Each entry is one of:
- `github:owner/repo[@ref]` — fetched from GitHub (ref is branch, tag, or commit)
- Relative or absolute local path — resolved relative to the stack's directory

**Order matters:** later entries override earlier ones on name conflicts. The local
stack's own content always wins over all extended stacks.

**Validation rules:**
- Each entry must match `github:owner/repo[@ref]` or be a valid path
- No duplicate entries
- Empty array is valid (equivalent to no extends)

### `instructionStrategy`

Optional enum: `"concatenate"` (default) or `"override"`.

- `"concatenate"` — instructions from all extends are merged with local instructions,
  in resolution order, with `## From {source}` headers between sections
- `"override"` — only the local stack's instructions are used; all extends instructions
  are dropped

Warn if set without `extends` (meaningless without it). Warn if `"override"` with no
local instructions (extends instructions silently dropped).

## Architecture: Two-Phase Resolution

Resolution is split into two independent phases, each separately testable.

### Phase 1: `resolveGraph()`

**New file:** `src/core/resolve.ts`

```typescript
interface ResolvedNode {
  source: string;       // "github:acme/base-stack@1.0.0" or local path
  stackDir: string;     // where the fetched/resolved stack lives on disk
  bundle: StackBundle;  // parsed stack content (own content only, not merged)
  depth: number;        // 0 = root stack, 1 = direct extends, etc.
}

interface ResolvedGraph {
  nodes: ResolvedNode[];  // topologically sorted: deepest deps first, root last
  warnings: string[];
}

function resolveGraph(stackDir: string, options?: {
  maxDepth?: number;      // default 10
  skipExtends?: boolean;  // for collect without --include-extends
}): Promise<ResolvedGraph>
```

**Algorithm:**

1. Read stack.json from `stackDir`
2. If no `extends` or `skipExtends`, return single-node graph (root only)
3. For each entry in `extends` (in declared order):
   - GitHub sources: fetch via existing `cloneAndResolve()` from `sources/github.ts`
   - Local paths: resolve relative to the stack's directory
   - Check visited set (keyed by normalized source string) — error on cycle
   - Check depth — error if exceeding max (default 10)
   - Recurse: resolve that stack's own extends
4. Return flat list in merge order: deepest transitive deps first, then direct
   extends in declared order, root stack last

**Example — linear chain:**

```
root extends [A, B]
A extends [C]
B extends []
C extends []

Resolution order: [C, A, B, root]
```

**Example — diamond dependency:**

```
root extends [A, B]
A extends [D]
B extends [D]
D extends []

Resolution order: [D, A, B, root]
D appears once (first encounter wins placement). B's reference to D is a no-op
since D was already visited via A.
```

**Cycle detection:**

```
root extends [A]
A extends [B]
B extends [root]

Error: "Circular dependency detected: root → A → B → root"
```

**Caching:** GitHub stacks fetched during resolution go to a shared temp directory
(`os.tmpdir()/pit-resolve-XXXXXX/`). Same source fetched once even if referenced
from multiple branches of the graph. Temp directory cleaned up in `finally` block.

### Phase 2: `mergeGraph()`

Same file (`src/core/resolve.ts`).

```typescript
interface ConflictEntry {
  type: "skill" | "rule" | "agent" | "mcp" | "command" | "env";
  name: string;
  from: string;     // source that was overridden
  winner: string;   // source that won
}

interface MergedStack {
  bundle: StackBundle;        // fully merged result
  conflicts: ConflictEntry[]; // every name collision detected
  sources: Map<string, string>; // maps each item name to its source
}

function mergeGraph(graph: ResolvedGraph, options?: {
  instructionStrategy?: "concatenate" | "override";
}): MergedStack
```

**Merge rules (applied left-to-right across `graph.nodes`):**

| Content type | Strategy              | On name collision                   |
|--------------|-----------------------|-------------------------------------|
| Instructions | Concatenate in order  | No conflict — all included          |
| Skills       | Union by name         | Last-declared wins + ConflictEntry  |
| Rules        | Union by name         | Last-declared wins + ConflictEntry  |
| Agents       | Union by name         | Last-declared wins + ConflictEntry  |
| MCP servers  | Union by name         | Last-declared wins + ConflictEntry  |
| Commands     | Union by name         | Last-declared wins + ConflictEntry  |
| Env vars     | Union by key          | Last-declared wins + ConflictEntry  |

When `instructionStrategy` is `"override"`, only the root node's instructions appear.

**Instruction concatenation order:**

```markdown
## From acme/base-stack

<base instructions>

## From acme/security-stack

<security instructions>

## From acme-frontend (local)

<local instructions>
```

**The `sources` map** tracks provenance for debugging: "this skill came from
acme/base-stack."

**Relationship to existing `merger.ts`:** The existing merger handles multi-adapter
merging during `pit collect` (combining Claude Code + Cursor configs into one bundle).
`mergeGraph` handles multi-stack merging during extends resolution. Different
dimensions — no overlap. Existing merger stays untouched.

## Command Changes

### `pit install` — Three Modes

**Mode 1: `pit install github:acme/stack` (external, no --save)**

Same as today. Fetch, install, no extends involvement.

**Mode 2: `pit install github:acme/stack --save`**

1. Fetch and install the stack (same as Mode 1)
2. Read local stack.json (or `.promptpit/stack.json`)
3. Append source to `extends` array (skip if already present)
4. Write updated stack.json
5. Error if no local stack.json exists: `No stack.json found. Run "pit init" first, or install without --save.`

Version pinning follows user input:
- `pit install github:acme/stack --save` → saves `"github:acme/stack"` (floating)
- `pit install github:acme/stack@1.0.0 --save` → saves `"github:acme/stack@1.0.0"` (pinned)

**Mode 3: `pit install` (no args)**

1. Read local stack.json
2. If `extends` present → `resolveGraph()` → `mergeGraph()`
3. Install merged result (same flow as today: detect adapters, write per-adapter, update manifest)

**Manifest additions:**

```typescript
// Added to InstallEntry in manifest
resolvedExtends?: {
  source: string;
  version?: string;      // from the fetched stack's manifest
  resolvedAt: string;    // ISO timestamp
}[];
```

### `pit collect`

**Without flag:** Collects as today. `extends` stays as pointers in stack.json.

**`pit collect --include-extends`:**

1. Run `resolveGraph()` to fetch all extends
2. Run `mergeGraph()` to produce merged bundle
3. Write merged bundle to `.promptpit/`
4. Remove `extends` from the output stack.json (it's been flattened)

### `pit status`

**Default (with network):**

1. Local drift detection (same as today — hash comparison)
2. If manifest has `resolvedExtends`, fetch each source and compare versions
3. Report upstream drift: `acme/base-stack: installed v1.0.0, upstream now v1.2.0`

**`pit status --skip-upstream`:** Local drift only. No network. Fast.

### `pit validate`

Syntax-only validation for extends:
- Each entry matches `github:owner/repo[@ref]` or is a valid path
- No duplicate entries
- No resolution, no network

### `pit check` (CI)

Unchanged. Works on installed state, which is always flat.

### `pit watch`

Unchanged. Watches local files only.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Extends target not found (404, private repo, bad path) | `Cannot resolve extends "github:acme/missing": repository not found` |
| Target exists but no `.promptpit/` and auto-collect fails | `"github:acme/repo" is not a valid stack (no .promptpit/ found and auto-collect failed)` |
| Circular dependency | `Circular dependency detected: root → A → B → root` (full chain) |
| Depth exceeds 10 | `Extends chain exceeds maximum depth of 10 at "github:acme/deep-stack"` |
| Network failure mid-resolution | Error on the specific fetch. No partial install. Temp dir cleaned up. |
| `--save` without local stack.json | `No stack.json found. Run "pit init" first, or install without --save.` |
| `--save` with source already in extends | Skip silently, no duplicate |
| `instructionStrategy: "override"` with no local instructions | Warn: `instructionStrategy is "override" but this stack has no instructions — extends instructions will be dropped` |
| Local path escapes project | Allow but warn: `Extends path "../shared" resolves outside this project — stack will not be portable` |

### Atomicity

`pit install` (no args) with extends is all-or-nothing:

1. Resolve full graph (may fail — nothing written yet)
2. Merge (may produce conflicts — still nothing written)
3. Print conflicts as warnings
4. Write to project (same atomic patterns as today)

If step 1 or 2 fails, the project is untouched.

### Temp directory cleanup

GitHub stacks fetched during resolution go to `os.tmpdir()/pit-resolve-XXXXXX/`.

- On success: cleaned up after merge completes
- On error: cleaned up in `finally` block
- On process kill: best-effort via `process.on('exit')`

## Testing Strategy

### Unit Tests (free, fast)

**`test/core/resolve.test.ts`** — graph resolution:
- Single stack, no extends → single-node graph
- Linear chain: A extends B extends C → correct order [C, B, A]
- Diamond: A extends [B, C], both extend D → D appears once, correct order
- Circular detection → error with full chain
- Depth limit → error at 11 levels
- Duplicate extends entries → validation error
- Mix of GitHub and local path entries → both resolved
- Cache hit: same source in two branches → fetched once

**`test/core/resolve.merge.test.ts`** — graph merging:
- No conflicts → clean union of all content
- Skill name collision → last-declared wins, ConflictEntry produced
- Same for rules, agents, MCP, commands, env vars
- Instructions concatenate in order with headers
- `instructionStrategy: "override"` → only root instructions
- `instructionStrategy: "override"` with no local instructions → warning
- Sources map tracks provenance correctly
- Empty extends array → behaves like no extends

### Integration Tests (free, fast)

**`test/commands/install-extends.test.ts`:**
- `pit install` (no args) resolves extends from local stack.json
- `pit install github:x --save` appends to extends
- `--save` with existing entry doesn't duplicate
- `--save` without stack.json errors
- Manifest records `resolvedExtends`

**`test/commands/collect-extends.test.ts`:**
- `pit collect` preserves extends as pointers
- `pit collect --include-extends` flattens extends into bundle
- Flattened bundle has no extends in stack.json

**`test/commands/status-extends.test.ts`:**
- Shows upstream version drift
- `--skip-upstream` skips network checks
- No extends → unchanged behavior

### Fixture Stacks

`test/__fixtures__/extends/`:
- `base-stack/` — minimal stack with instructions, one skill, one MCP server
- `team-stack/` — extends base-stack locally, adds own skill, overrides MCP server
- `deep-chain/` — 3 levels deep for ordering tests
- `circular-a/` and `circular-b/` — extend each other for cycle detection

All fixtures use local paths — no GitHub calls in unit/integration tests. GitHub
fetching tested by mocking `cloneAndResolve()`.

### Schema Tests

Existing `test/core/stack.test.ts` extended:
- `extends` field validates correctly
- `instructionStrategy` enum validates
- Invalid extends entries rejected
- Backwards compatibility: stacks without extends still valid

### Real-World Composition Tests

**`test/e2e/real-world-repos.test.ts`:**

Add a composition test phase after the existing collect → install → status pipeline.
For selected repos (positron, everything-claude-code, spotlight):

1. After collecting the repo's stack, create a child stack that extends it via local path
2. Child stack adds its own skill and instruction
3. Install the child stack and verify the merged result includes both base and child content
4. Run status and verify no drift

**`.claude/commands/qa-real-world.md`:**

Add Phase 2.5 to agent instructions: after collecting a repo, the agent creates a
temporary stack that extends the collected output, installs it, and reports whether
the composition chain resolved cleanly — instructions merged, artifacts present,
warnings reasonable.

No real-world repos need to natively use `extends`. The tests synthesize the
composition layer on top of real stacks, which catches merge bugs with real messy
content that fixture stacks wouldn't have.
