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

### Adapter tiers

- **Tier 1 (creator-maintained):** Claude Code, Cursor, Codex, Copilot (all shipped). These get full test coverage and are maintained by the project owner.
- **Tier 2 (community-contributed):** Windsurf, Gemini CLI, and others. Community PRs welcome. Tier 2 adapters need contract tests passing but ongoing maintenance is shared.

### How to add one

1. Create `src/adapters/{tool}.ts` — see `cursor.ts` for a good reference (it has custom skill format conversion)
2. Register it in `src/adapters/registry.ts`
3. Add a fixture setup in `ADAPTER_FIXTURES` in `test/adapters/contract.test.ts` — the 9 contract tests will run automatically against your adapter

The adapter needs to implement:
- `detect(root)` — check if this tool is configured in the project
- `read(root)` — read the tool's config files into a `PlatformConfig`
- `write(root, stack, opts)` — write a stack into the tool's native format

## Project structure

```
src/
├── cli.ts              # Commander.js entry point (init, collect, install, uninstall, update, status, diff, watch, validate, check)
├── commands/           # init.ts, collect.ts, install.ts, uninstall.ts, update.ts, status.ts, diff.ts, watch.ts, validate.ts, check.ts
├── adapters/           # One file per AI tool + registry + shared utils (standards.ts, copilot.ts, codex.ts, etc.)
├── core/               # stack.ts (bundle I/O), skill-store.ts, manifest.ts (install ledger), artifact-ops.ts (removal helpers), merger.ts, resolve.ts (extends graph), reconcile.ts (overrides/excluded/fork tracking), select.ts (interactive picker), scripts.ts (lifecycle hooks), security.ts, validate.ts
├── sources/            # github.ts (clone + auto-collect)
└── shared/             # schema.ts (Zod types + manifest schema), markers.ts, utils.ts, io.ts, interactive.ts (@clack/prompts wrapper with TTY guard)

test/
├── adapters/           # Contract tests (parameterized) + per-adapter tests
├── commands/           # collect, install, uninstall, update, status, check integration tests
├── core/               # manifest, merger, artifact-ops, security, stack, validate unit tests
├── shared/             # markers, markers-strip, schema tests
├── sources/            # github source tests
├── e2e/                # Round-trip, dedup, journey, and install→status integration tests
├── rules.test.ts       # Rules read/write/translate tests
└── scripts/            # Build script tests (check-version)
```

## Slash commands (Claude Code)

If you use Claude Code, the repo includes slash commands in `.claude/commands/`:

- `/develop` — full workflow: design, plan, implement, review, simplify.
- `/ship` — push branch and create a PR.
- `/pre-pr-check` — chains /review, adapter verification, and /simplify into a single pre-PR quality gate.
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
