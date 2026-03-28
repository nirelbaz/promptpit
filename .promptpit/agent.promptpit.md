---
name: promptpit
description: >-
  Portable AI agent stacks — collect, install, and share across Claude Code,
  Cursor, and more
---

# CLAUDE.md

## Project

PromptPit (`pit`) — a CLI tool that makes AI agent stacks portable across Claude Code, Cursor, and other AI coding tools. Two commands: `pit collect` (bundle configs) and `pit install` (install stacks).

## Commands

```bash
npm test          # run tests (vitest, 74 tests)
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
├── core/               # stack.ts, merger.ts, security.ts
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

## Testing

Tests use vitest with real filesystem (not memfs) for E2E. Test fixtures in `test/__fixtures__/`. Contract tests in `test/adapters/contract.test.ts` are parameterized across all adapters (7 checks each).

## Before Pushing

Always run before committing or pushing:

```bash
npm test && npm run lint && npm run build
```

All three must pass. No exceptions.

## Adding a New Adapter

1. Create `src/adapters/{tool}.ts` — implement `PlatformAdapter` interface using functions from `adapter-utils.ts`
2. Register in `src/adapters/registry.ts`
3. Contract tests auto-include it — add a fixture setup in `ADAPTER_FIXTURES` in `contract.test.ts`


<!-- promptpit:start:promptpit-starter:0.1.0:claude-code -->
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
<!-- promptpit:end:promptpit-starter -->