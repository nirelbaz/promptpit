# CLAUDE.md

## Project

PromptPit (`pit`) — the composition layer for AI agent configuration. Bundles instructions, skills (Agent Skills spec), MCP servers, and env vars into one distributable stack that installs across Claude Code, Cursor, and other AI coding tools. Seven commands: `pit init` (scaffold a stack), `pit collect` (bundle configs), `pit install` (install stacks), `pit status` (show what's installed and drifted), `pit watch` (live-sync skill changes), `pit validate` (check stack validity), and `pit check` (CI sync verification). Translation is the entry point, stack management is the product.

## Commands

```bash
npm test          # run tests (vitest, 286 tests)
npm run build     # build dist/cli.js (tsup, ESM)
npm run lint      # TypeScript strict mode check
npm run dev       # watch mode build
```

## Architecture

Adapter pattern with composition. Each AI tool is a plain object implementing `PlatformAdapter`. Shared utilities in `adapter-utils.ts`, not a base class.

```
src/
├── cli.ts              # Commander.js entry point
├── commands/           # init.ts, collect.ts, install.ts, status.ts, watch.ts, validate.ts, check.ts
├── adapters/           # claude-code.ts, cursor.ts, codex.ts, standards.ts, copilot.ts, registry.ts, types.ts, adapter-utils.ts, toml-utils.ts
├── core/               # stack.ts, skill-store.ts, manifest.ts, merger.ts, security.ts, validate.ts
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
- `AdapterCapabilities.mcpFormat` (`"json"` or `"toml"`) and `mcpRootKey` (e.g. `"mcpServers"`, `"servers"`, `"mcp_servers"`) declare how each adapter stores MCP config, used by `status.ts` for drift detection
- `computeMcpServerHash()` in `manifest.ts` hashes only canonical MCP fields (command, args, env, url, serverUrl) with recursive key sorting, ignoring adapter-added fields like Copilot's `type`

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

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Adding a New Adapter

1. Create `src/adapters/{tool}.ts` — implement `PlatformAdapter` interface using functions from `adapter-utils.ts`
2. Register in `src/adapters/registry.ts`
3. Contract tests auto-include it — add a fixture setup in `ADAPTER_FIXTURES` in `contract.test.ts`