# AGENTS.md Support — Design Spec

**Date:** 2026-03-30
**Branch:** nirelbaz/agents-md
**Status:** Approved (eng review passed)

## Problem

PromptPit collects and installs AI agent configurations across tools. AGENTS.md is a cross-tool standard read by 20+ AI coding tools (Codex, Copilot, Cursor, Windsurf, Zed, Cline, Roo Code, Amp, Devin, Aider, etc.), making it the single highest-reach output PromptPit can generate. Currently PromptPit doesn't read or write AGENTS.md.

## Solution

Add AGENTS.md as a standard `PlatformAdapter` with two asymmetric behaviors:

- **Collect (read):** Fallback-only. Read AGENTS.md as an instruction source only when no other adapters (claude-code, cursor) are detected. This avoids content duplication when multiple tools have overlapping instructions.
- **Install (write):** Always write. Generate AGENTS.md from `agentInstructions` with idempotent markers, even if no AGENTS.md exists yet. No content transformation (same as CLAUDE.md).

## Architecture

```
                    COLLECT FLOW
                    ============
  detectAdapters(root) ──► [claude-code, cursor, agents-md]
                                │
                          ┌─────┴─────┐
                          │ Other     │ Only
                          │ adapters  │ agents-md
                          │ detected? │ detected?
                          └─────┬─────┘
                            yes │        │ no
                                ▼        ▼
                          exclude    include
                          agents-md  agents-md
                          from read  in read
                                │        │
                                └────┬───┘
                                     ▼
                              mergeConfigs() ──► writeStack()


                    INSTALL FLOW
                    ============
  detectAdapters(target) ──► [claude-code, cursor, ...]
                                │
                          agents-md  ◄── always injected
                          in set?        if missing
                                │
                                ▼
                          write to ALL detected adapters
                          (including agents-md, always)
```

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Standard PlatformAdapter (id: "agents-md") | Follows existing pattern. Contract tests auto-include. Consistency over special-casing. |
| 2 | Fallback-only read during collect | Avoids content duplication. When CLAUDE.md and AGENTS.md both exist, reading both produces duplicate instructions in the bundle. Full deduplication deferred (see Trade-offs). |
| 3 | Gate fallback in collect.ts, not detect() | detect() stays pure (checks file existence). Orchestration logic belongs in the command. |
| 4 | Always-write during install via manual inject | Same pattern as claude-code fallback in install.ts:83-89. Inject agents-md into detected set if missing. |
| 5 | No content transformation | Write agentInstructions as-is with markers. Same approach as CLAUDE.md and .cursorrules. |
| 6 | User paths: ~/.agents/AGENTS.md | Placeholder for future convention (skills.sh ecosystem). Never read/written now. Satisfies contract test requirement. |
| 7 | Extract writeWithMarkers() to adapter-utils.ts | DRY refactor. Three adapters share the same 15-line marker-write pattern. Done as a separate bisected commit before the feature commit. |

## Trade-offs and Deferred Work

**Content duplication during collect:** When a project has both CLAUDE.md and AGENTS.md with similar content, collecting from both would produce duplicates. Fallback-only read mitigates this but doesn't solve it. Full deduplication (content hashing, similarity detection) is tracked in TODOS.md under "Recursive duplication on collect + install." The TODOS entry should be updated to note this design decision.

**Pre-existing AGENTS.md content:** When installing to a project that has a manually-curated AGENTS.md, pit appends markers (preserving existing content above). The user's content is not overwritten, but the file grows. This is the same behavior as CLAUDE.md and .cursorrules.

**Directory-scoped AGENTS.md sections:** Some tools use `# /src/backend` headers in AGENTS.md to scope instructions to subdirectories. Collecting these and replaying into CLAUDE.md loses that semantic context. This affects all adapters equally (CLAUDE.md has `@path` imports with similar semantics) and is not specific to AGENTS.md.

## Files Changed

### Commit 1: Extract writeWithMarkers helper (refactor)

| File | Change |
|------|--------|
| `src/adapters/adapter-utils.ts` | Add `writeWithMarkers()` function |
| `src/adapters/claude-code.ts` | Replace inline marker logic with `writeWithMarkers()` call |
| `src/adapters/cursor.ts` | Replace inline marker logic with `writeWithMarkers()` call |
| `test/adapters/adapter-utils.test.ts` | New: unit tests for `writeWithMarkers()` |

### Commit 2: Add agents-md adapter (feature)

| File | Change |
|------|--------|
| `src/adapters/agents-md.ts` | New: PlatformAdapter implementation (~80 lines) |
| `src/adapters/registry.ts` | Add agentsMdAdapter to defaultAdapters |
| `src/commands/collect.ts` | Add fallback-only read filter (~5 lines) |
| `src/commands/install.ts` | Add always-write inject (~5 lines) |
| `test/adapters/contract.test.ts` | Add ADAPTER_FIXTURES entry for agents-md |
| `test/__fixtures__/agents-md-project/AGENTS.md` | New: test fixture |

### Commit 3: Update TODOS.md

| File | Change |
|------|--------|
| `TODOS.md` | Update duplication TODO with fallback-only design note |

## Adapter Specification

```typescript
// src/adapters/agents-md.ts

id: "agents-md"
displayName: "AGENTS.md"

capabilities: {
  skills: false,
  rules: false,
  skillFormat: "md",
  mcpStdio: false,
  mcpRemote: false,
  agentsmd: true,
  hooks: false,
}

paths.project(root): {
  config: path.join(root, "AGENTS.md"),
  skills: path.join(root, ".agents", "skills"),  // future use
  mcp: path.join(root, ".agents", "mcp.json"),    // future use
}

paths.user(): {
  config: path.join(homedir(), ".agents", "AGENTS.md"),
  skills: path.join(homedir(), ".agents", "skills"),
  mcp: path.join(homedir(), ".agents", "mcp.json"),
}

detect(root): AGENTS.md exists at root -> detected: true
read(root): return { adapterId: "agents-md", agentInstructions: file content, skills: [], mcpServers: {}, rules: [] }
write(root, stack, opts): writeWithMarkers to AGENTS.md, skip skills/mcp/rules
```

## writeWithMarkers Helper Specification

```typescript
// Added to src/adapters/adapter-utils.ts

async function writeWithMarkers(
  filePath: string,
  content: string,
  stackName: string,
  version: string,
  adapterId: string,
  dryRun?: boolean,
): Promise<string | null>
// Returns: filePath if written, null if dryRun

// Logic:
// 1. Read existing file (or empty string)
// 2. If hasMarkers(existing, stackName) -> replaceMarkerContent
// 3. Else -> insertMarkers
// 4. If !dryRun -> writeFileEnsureDir
// 5. Return filePath or null
```

## Test Coverage

### Contract tests (auto-included, 7 tests)
1. detect() true for project with AGENTS.md
2. detect() false for empty project
3. read() returns valid PlatformConfig
4. write() produces markers
5. write() is idempotent
6. paths.user() returns strings
7. write() preserves existing content

### writeWithMarkers unit tests (new file)
1. Creates file with markers when no existing file
2. Inserts markers when existing file has no markers
3. Replaces marker content when existing file has markers
4. Skips write when dryRun=true
5. Handles empty content string

### Collect integration tests
1. Only agents-md detected -> included in read set, bundle contains AGENTS.md content
2. agents-md + claude-code both detected -> agents-md excluded from read

### Install integration tests
1. agents-md not detected -> injected, AGENTS.md created
2. agents-md already detected -> no duplicate, AGENTS.md still written
3. Pre-existing AGENTS.md content preserved after install
