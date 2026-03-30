# CLAUDE.md

## Project

PromptPit (`pit`) — a CLI tool that makes AI agent stacks portable across Claude Code, Cursor, and other AI coding tools. Two commands: `pit collect` (bundle configs) and `pit install` (install stacks).

## Commands

```bash
npm test          # run tests (vitest, 110 tests)
npm run build     # build dist/cli.js (tsup, ESM)
npm run lint      # TypeScript strict mode check
npm run dev       # watch mode build
```

## Architecture

Adapter pattern with composition. Each AI tool is a plain object implementing `PlatformAdapter`. Shared utilities in `adapter-utils.ts`, not a base class.

```
src/
├── cli.ts              # Commander.js entry point
├── commands/           # collect.ts, install.ts
├── adapters/           # claude-code.ts, cursor.ts, registry.ts, types.ts, adapter-utils.ts
├── core/               # stack.ts, skill-store.ts, merger.ts, security.ts
├── sources/            # github.ts (clone + auto-collect)
└── shared/             # schema.ts (Zod + types), markers.ts, utils.ts, io.ts
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

## Testing

Tests use vitest with real filesystem (not memfs) for E2E. Test fixtures in `test/__fixtures__/`. Contract tests in `test/adapters/contract.test.ts` are parameterized across all adapters (7 checks each).

## Slash Commands

```bash
/version [X.Y.Z]   # bump version in package.json + add CHANGELOG entry
/release            # tag and publish from main (runs all checks first)
```

`/version` on your feature branch before opening a PR. `/release` on main after merging.

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