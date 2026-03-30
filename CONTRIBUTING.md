# Contributing

Thanks for considering a contribution to promptpit.

## Setup

```sh
git clone https://github.com/nirelbaz/promptpit.git
cd promptpit
npm install
npm test
```

## Before submitting

Run all three:

```sh
npm test && npm run lint && npm run build
```

All must pass.

## Adding a new adapter

This is the most likely contribution. Each AI tool (Claude Code, Cursor, etc.) is a plain object implementing `PlatformAdapter`. No base class, just functions from `adapter-utils.ts`.

1. Create `src/adapters/{tool}.ts` — see `cursor.ts` for a good reference (it has custom skill format conversion)
2. Register it in `src/adapters/registry.ts`
3. Add a fixture setup in `ADAPTER_FIXTURES` in `test/adapters/contract.test.ts` — the 7 contract tests will run automatically against your adapter

The adapter needs to implement:
- `detect(root)` — check if this tool is configured in the project
- `read(root)` — read the tool's config files into a `PlatformConfig`
- `write(root, stack, opts)` — write a stack into the tool's native format

## Project structure

```
src/
├── cli.ts              # Commander.js entry point
├── commands/           # collect.ts, install.ts
├── adapters/           # One file per AI tool + registry + shared utils
├── core/               # stack.ts (bundle I/O), skill-store.ts (canonical install), merger.ts, security.ts
├── sources/            # github.ts (clone + auto-collect)
└── shared/             # schema.ts, markers.ts, utils.ts, io.ts

test/
├── adapters/           # Contract tests (parameterized) + per-adapter tests
├── commands/           # collect + install integration tests
├── core/               # merger, security, stack unit tests
├── shared/             # markers, schema tests
├── sources/            # github source tests
└── e2e/                # Full round-trip tests
```

## Slash commands (Claude Code)

If you use Claude Code, the repo includes two slash commands in `.claude/commands/`:

- `/version [X.Y.Z]` — bump version in `package.json` and add a CHANGELOG entry. Run on your feature branch before opening a PR.
- `/release` — tag the current version on main and push the tag. Run on main after merging a version bump PR.

## Code style

- Explicit over clever
- Small functions that fit on a screen
- Name things for what they do, not how they work
- No abbreviations unless universal (url, id, html)
- Early returns over nested if/else
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

## Tests

- Test behavior, not implementation
- One assertion per test when possible
- Tests use real filesystem, not mocks
- Test fixtures live in `test/__fixtures__/`

## Roadmap

See [TODOS.md](TODOS.md) for planned features and known issues.
