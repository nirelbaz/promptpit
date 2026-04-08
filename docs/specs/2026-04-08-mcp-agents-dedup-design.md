# MCP & AGENTS.md Dedup Design

Fixes Audit #1 (MCP duplication) and Audit #2 (AGENTS.md instruction duplication) from TODOS.md.

## Problem

Standards adapter writes universal files (`.mcp.json`, `AGENTS.md`) unconditionally during install. When a tool-specific adapter is also active and the tool natively reads those universal files, users see duplicate MCP servers or duplicate instructions.

**Confirmed duplication scenarios:**

| Scenario | Universal file | Tool-specific file | Severity |
|----------|---------------|-------------------|----------|
| Claude Code + Standards | `.mcp.json` | `.claude/settings.json` | HIGH — CC reads both |
| Codex + Standards both write `AGENTS.md` | `AGENTS.md` | `AGENTS.md` (same file) | HIGH — double markers |
| Copilot reads `AGENTS.md` (opt-in) | `AGENTS.md` | `.github/copilot-instructions.md` | CONDITIONAL — requires `chat.useAgentsMdFile: true` |
| Cursor reads `AGENTS.md` (unreliable) | `AGENTS.md` | `.cursorrules` | LOW — not reliably auto-loaded |

Verified by AI Stack Expert against primary documentation (2026-04-08). Notable corrections from initial assumptions:
- Copilot does NOT confirmed-read `.mcp.json` at project root (only `.vscode/mcp.json`)
- Copilot's `AGENTS.md` reading is opt-in (`chat.useAgentsMdFile: true`, off by default)
- Cursor's `AGENTS.md` support is listed but unreliably auto-loaded per forum reports

## Solution

A unified dedup system with three install modes controlled by the capability declaration `nativelyReads` on each adapter.

### 1. Capability Declaration

New optional field on `AdapterCapabilities` in `types.ts`:

```typescript
interface AdapterCapabilities {
  // ... existing fields ...

  /** Universal files this tool reads natively (beyond what the adapter writes) */
  nativelyReads?: {
    mcp?: boolean;           // tool reads .mcp.json
    instructions?: boolean;  // tool reads AGENTS.md
  };
}
```

**Per-adapter values:**

| Adapter | `nativelyReads.mcp` | `nativelyReads.instructions` | Rationale |
|---------|--------------------|-----------------------------|-----------|
| Claude Code | `true` | — | Confirmed: reads `.mcp.json` at project root |
| Copilot | — | `true` | Reads `AGENTS.md` when opt-in enabled; prevent duplication for those users |
| Cursor | — | `true` | Listed as supported; prevent duplication when it works |
| Codex | — | `true` | `AGENTS.md` is its primary instruction file |
| Standards | omitted | omitted | Universal writer, not a consumer |

### 2. Three Install Modes

#### Default: Standards dedup

Standards skips writing universal files when a detected tool adapter's tool reads them natively. Every tool adapter writes its full tool-specific output.

**Orchestrator logic in `install.ts`:**

```typescript
const toolAdapters = detected.filter(d => d.adapter.id !== 'standards');
writeOpts.skipMcp = toolAdapters.some(d => d.adapter.capabilities.nativelyReads?.mcp);
writeOpts.skipInstructions = toolAdapters.some(d => d.adapter.capabilities.nativelyReads?.instructions);
```

**Standards `write()` checks these before writing:**
- `skipMcp` true: skip `.mcp.json` write
- `skipInstructions` true: skip `AGENTS.md` write
- Both true: Standards writes 0 files (correct — all universal outputs are redundant)

All other adapters ignore `skipMcp`/`skipInstructions`.

#### `--force-standards`

Override dedup. Standards writes everything regardless of detected tools. Useful for projects that want universal files for tools pit doesn't detect.

```typescript
if (opts.forceStandards) {
  // skip dedup — Standards writes everything
}
```

#### `--prefer-universal`

Inverse of default. Tool adapters skip their MCP/instruction writes when the tool reads the universal equivalent. Standards always writes everything.

**Per-adapter skip behavior:**

| Adapter | MCP skip | Instructions skip |
|---------|----------|-------------------|
| Claude Code | Skip MCP merge into `.claude/settings.json` (file may still exist for other settings) | No change (doesn't read `AGENTS.md`) |
| Copilot | No change (doesn't confirmed-read `.mcp.json`) | Skip `.github/copilot-instructions.md` |
| Cursor | No change (doesn't read `.mcp.json`) | Skip `.cursorrules` instruction write |
| Codex | No change (doesn't read `.mcp.json`) | Skip `AGENTS.md` write (Standards writes it) |
| Standards | Always writes `.mcp.json` | Always writes `AGENTS.md` |

Rules, skills, agents, and commands are NEVER affected by `--prefer-universal` — no universal format is rich enough to replace tool-specific formats for these artifact types.

**Copilot warning when `--prefer-universal`:**
```
Warning: Copilot: skipped .github/copilot-instructions.md — ensure chat.useAgentsMdFile is enabled in VS Code settings
```

`--force-standards` and `--prefer-universal` are mutually exclusive (CLI validation error if both set).

### 3. WriteOptions Changes

```typescript
interface WriteOptions {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  global?: boolean;
  canonicalSkillPaths?: Map<string, string>;
  // New fields:
  skipMcp?: boolean;
  skipInstructions?: boolean;
  preferUniversal?: boolean;
}
```

### 4. InstallOptions Changes

```typescript
interface InstallOptions {
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  // New fields:
  forceStandards?: boolean;
  preferUniversal?: boolean;
}
```

### 5. Logging

**Default mode (Standards dedup):**
```
Standards: skipped .mcp.json (Claude Code reads it natively, causing duplicate MCP servers)
Standards: skipped AGENTS.md (Codex CLI, Cursor read it natively, causing duplicate instructions)
Tip: use --force-standards to write universal files even when detected tools read them natively
```

Tip shown once after all skips, not per file.

**`--prefer-universal` mode:**
```
Claude Code: skipped MCP in .claude/settings.json (using universal .mcp.json — --prefer-universal)
Copilot: skipped .github/copilot-instructions.md (using universal AGENTS.md — --prefer-universal)
```

### 6. Manifest & Status Impact

**Manifest recording:** Skipped files are NOT recorded in `installed.json`. The manifest only contains entries for files actually written.

**New manifest metadata:**

```typescript
interface InstallEntry {
  // ... existing fields ...
  installMode?: 'default' | 'force-standards' | 'prefer-universal';
}
```

`pit status` uses `installMode` to explain missing files:
```
Standards: .mcp.json not installed (skipped — Claude Code reads it natively)
```

`pit check` (CI sync verification) uses the same logic — skipped files are not flagged as missing.

No impact on: `pit collect`, `pit validate`, `pit watch`, `pit init`.

## Testing

### Unit tests

1. **Capability declarations** — verify each adapter's `nativelyReads` in contract tests
2. **Orchestrator skip computation** — Claude Code detected -> `skipMcp: true`; Codex detected -> `skipInstructions: true`; both -> both true; none -> both false
3. **Standards write respects skip flags** — `skipMcp` -> no `.mcp.json`; `skipInstructions` -> no `AGENTS.md`; both -> 0 files
4. **Tool adapter write respects `preferUniversal`** — Claude Code skips MCP; Copilot skips instructions; other artifacts still written
5. **Mutual exclusivity** — `--force-standards` + `--prefer-universal` -> CLI error

### Integration tests

6. **Default + Claude Code** — install with `.claude/` present -> `.mcp.json` NOT written, `.claude/settings.json` has servers
7. **Default + Codex** — install with `.codex/` present -> single set of markers in `AGENTS.md`
8. **`--prefer-universal`** — install with Claude Code -> `.mcp.json` written, `.claude/settings.json` has no MCP; other CC artifacts present
9. **`--force-standards`** — install with Claude Code -> both `.mcp.json` and `.claude/settings.json` have MCP
10. **Manifest correctness** — skipped files absent from `installed.json`; `installMode` recorded

## Files Changed

| File | Change |
|------|--------|
| `src/adapters/types.ts` | Add `nativelyReads` to `AdapterCapabilities`, add fields to `WriteOptions` |
| `src/adapters/claude-code.ts` | Add `nativelyReads: { mcp: true }`, respect `preferUniversal` in MCP write |
| `src/adapters/copilot.ts` | Add `nativelyReads: { instructions: true }`, respect `preferUniversal` in instructions write, add warning |
| `src/adapters/cursor.ts` | Add `nativelyReads: { instructions: true }`, respect `preferUniversal` in instructions write |
| `src/adapters/codex.ts` | Add `nativelyReads: { instructions: true }`, respect `preferUniversal` in instructions write |
| `src/adapters/standards.ts` | Respect `skipMcp` and `skipInstructions` in `write()` |
| `src/commands/install.ts` | Orchestrator dedup logic, `--force-standards` / `--prefer-universal` flags, logging, tip |
| `src/cli.ts` | Wire new CLI flags to install command |
| `src/core/manifest.ts` | Add `installMode` to `InstallEntry` |
| `src/commands/status.ts` | Handle `installMode` in drift display |
| `src/commands/check.ts` | Handle `installMode` for CI verification |
| `test/adapters/contract.test.ts` | Test `nativelyReads` declarations |
| `test/install-dedup.test.ts` (new) | Dedup-specific unit + integration tests |
