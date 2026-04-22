# CLAUDE.md

## Project

PromptPit (`pit`) — the composition layer for AI agent configuration. Bundles instructions, skills (Agent Skills spec), MCP servers, and env vars into one distributable stack that installs across Claude Code, Cursor, and other AI coding tools. Ten commands: `pit init` (scaffold a stack), `pit collect` (bundle configs), `pit install` (install stacks), `pit uninstall` (remove installed stacks), `pit update` (smart re-install with drift awareness), `pit status` (show what's installed and drifted), `pit diff` (text diff between installed and source), `pit watch` (live-sync skill changes), `pit validate` (check stack validity), and `pit check` (CI sync verification). Bare `pit` (no subcommand) opens an interactive TUI over the same core — grouped stack list, per-stack action menu, live validate / status-diff / open actions (v0.5.2+). Translation is the entry point, stack management is the product.

## Commands

```bash
npm test          # run tests (vitest)
npm run build     # build dist/cli.js (tsup, ESM)
npm run lint      # TypeScript strict mode check
npm run dev       # watch mode build
```

## Architecture

Adapter pattern with composition. Each AI tool is a plain object implementing `PlatformAdapter`. Shared utilities in `adapter-utils.ts`, not a base class.

```
src/
├── cli.ts              # Commander.js entry point
├── commands/           # init.ts, collect.ts, install.ts, uninstall.ts, update.ts, status.ts, watch.ts, validate.ts, check.ts, diff.ts
├── adapters/           # claude-code.ts, cursor.ts, codex.ts, standards.ts, copilot.ts, registry.ts, types.ts, adapter-utils.ts, toml-utils.ts
├── core/               # stack.ts, skill-store.ts, manifest.ts, artifact-ops.ts, merger.ts, resolve.ts, reconcile.ts, select.ts, scripts.ts, security.ts, validate.ts
├── sources/            # github.ts (clone + auto-collect)
└── shared/             # schema.ts (Zod + types), markers.ts, utils.ts, io.ts, interactive.ts (@clack/prompts wrapper with TTY guard)
```

## Key Decisions

- Composition over inheritance for adapters
- Zod schemas co-located with inferred TypeScript types in `schema.ts`
- Adapter-specific types in `adapters/types.ts`
- `execFileSync` (not `execSync`) for git operations — prevents shell injection
- All YAML parsing uses `SAFE_MATTER_OPTIONS` (js-yaml JSON_SCHEMA) — prevents RCE
- Idempotent markers include adapter ID: `<!-- promptpit:start:name:version:adapterId -->`
- `.env` files are appended to, never overwritten
- No `simple-git` dependency — uses `child_process.execFileSync` directly
- Skills installed to `.agents/skills/` as canonical location, symlinked into tool-native paths (Claude Code), copied+translated for tools needing different formats (Cursor .mdc)
- `AdapterCapabilities.skillLinkStrategy` declares each adapter's skill install strategy: `"symlink"`, `"translate-copy"`, or `"none"`
- `AdapterCapabilities.mcpFormat` (`"json"` or `"toml"`) and `mcpRootKey` (e.g. `"mcpServers"`, `"servers"`, `"mcp_servers"`) declare how each adapter stores MCP config, used by `status.ts` for drift detection
- `computeMcpServerHash()` in `manifest.ts` hashes only canonical MCP fields (command, args, env, url, serverUrl) with recursive key sorting, ignoring adapter-added fields like Copilot's `type`
- Rules in `.promptpit/rules/*.md` use portable YAML frontmatter (`name`, `description`, `globs`, `alwaysApply`), translated per-adapter: Claude Code (`paths`), Cursor (`.mdc` with `rule-` prefix), Copilot (`.instructions.md` with `rule-` prefix and `applyTo`)
- Install manifest hashes translated (post-adapter) rule content so `pit status` drift detection compares apples to apples
- `AdapterCapabilities.agents` (`"native"` | `"inline"` | `"none"`) declares each adapter's agent handling: native adapters write per-file (Claude Code `.claude/agents/*.md`, Copilot `.github/agents/*.agent.md`), inline adapters embed agents in the instructions marker block via `buildInlineContent`
- Copilot agent translation strips `model` field and uses `.agent.md` extension; `readAgentsFromDir` accepts `glob`/`ext` options for adapter-specific file patterns

## Testing

Tests use vitest with real filesystem (not memfs) for E2E. Test fixtures in `test/__fixtures__/`. Contract tests in `test/adapters/contract.test.ts` are parameterized across all adapters (9 checks each).

## Slash Commands

```bash
/develop            # full workflow: design -> plan -> implement -> review -> simplify
/ship               # push branch + create PR
/version [X.Y.Z]   # bump version in package.json + add CHANGELOG entry
/release            # tag and publish from main (runs all checks first)
```

`/develop` for new features (runs the full cycle). `/ship` when ready to push and PR. `/version` on your feature branch before opening a PR. `/release` on main after merging.

## Before Pushing

Always run before committing or pushing:

```bash
npm test && npm run lint && npm run build
```

All three must pass. No exceptions.

When bumping the version in `package.json`, always add a corresponding entry to `CHANGELOG.md`.

## Adding a New Adapter

1. Create `src/adapters/{tool}.ts` — implement `PlatformAdapter` interface using functions from `adapter-utils.ts`
2. Register in `src/adapters/registry.ts`
3. Contract tests auto-include it — add a fixture setup in `ADAPTER_FIXTURES` in `contract.test.ts`

<!-- promptpit:start:promptpit:0.1.0:claude-code -->
## From promptpit-starter

# Coding defaults

## Code style

- Explicit over clever. If someone reading your code has to pause and think about what a line does, rewrite it.
- Small functions. If a function doesn't fit on a screen, split it.
- Name things for what they do, not how they work. `getUserEmail` not `queryDatabaseForEmailField`.
- No abbreviations in names unless they're universal (url, id, html). `msg` is not universal.

## Git

- Small, focused commits. One logical change per commit.
- Write commit messages that explain why, not what. The diff shows what.
- Conventional commits format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

## Testing

- Write tests for new code. No exceptions.
- Test behavior, not implementation. Your test should still pass if you refactor the internals.
- One assertion per test when possible. A test named "handles edge cases" with 8 assertions is 8 tests pretending to be one.

## Error handling

- Handle errors at system boundaries (user input, API calls, file I/O). Trust internal code.
- Never catch an error just to log it and rethrow. Either handle it or let it propagate.
- Error messages should tell the user what happened and what to do about it.

## Dependencies

- Don't add a dependency for something you can write in 20 lines.
- When you do add a dependency, check: is it maintained? Does it have known vulnerabilities? How big is it?

## Refactoring

- Don't refactor code you're not already changing. Stay focused.
- Extract a function when you see the same logic three or more times.
- Reduce nesting. Early returns over deeply nested if/else.
<!-- promptpit:end:promptpit -->