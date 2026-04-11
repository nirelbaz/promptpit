# Architecture

## Overview

promptpit is the composition layer for AI agent configuration. It bundles instructions, skills ([Agent Skills](https://agentskills.io) spec), MCP servers, and env vars into one distributable stack, then installs it across multiple AI coding tools. Eight commands: `pit init` (scaffold a stack), `pit collect` (bundle configs), `pit install` (write them into each tool's format), `pit status` (show what's installed and drifted), `pit diff` (text diff between installed and source), `pit watch` (live-sync skill changes), `pit validate` (check stack validity), and `pit check` (CI sync verification). The core design principle is that promptpit knows nothing about specific AI tools, adapters do.

## Data flow

```
collect:
  detect adapters → read each tool's configs (instructions, skills + supporting files, rules, agents, MCP) → strip installed markers → merge (hash dedup) → strip secrets → write .promptpit/

install:
  read .promptpit/ (or clone from GitHub) → resolve extends chain (if present) → merge stacks (last-declared-wins) → write canonical .agents/skills/ (full directories with supporting files) → detect adapters → symlink or copy+translate skills, rules, and agents to each tool's format → run lifecycle scripts (pre/post-install) → write manifest (.promptpit/installed.json)

status:
  read manifest → compute content hashes of installed files → compare → report synced/drifted/deleted

watch:
  fs.watch .agents/skills/ → debounce → re-translate for copy/translate adapters → update manifest hashes
```

## Adapters

Each AI tool is a `PlatformAdapter` - a plain object with `detect`, `read`, and `write` functions. No base class. Shared logic lives in `adapter-utils.ts` as composable functions.

```
src/adapters/
├── types.ts          # PlatformAdapter interface, capabilities, config types
├── registry.ts       # Adapter list, detection, lookup
├── adapter-utils.ts  # Shared read/write helpers (readSkillsFromDir, writeWithMarkers, etc.)
├── claude-code.ts    # Claude Code: CLAUDE.md, .claude/skills/ (symlinked), .claude/settings.json
├── cursor.ts         # Cursor: .cursorrules, .cursor/rules/ (.mdc, translated copies), .cursor/mcp.json
├── codex.ts          # Codex CLI: AGENTS.md, .codex/skills/ (symlinked), .codex/config.toml (TOML)
├── copilot.ts        # GitHub Copilot: .github/copilot-instructions.md, .github/instructions/ (.instructions.md), .vscode/mcp.json
├── toml-utils.ts     # TOML read/write helpers for Codex CLI config.toml MCP sections
└── standards.ts      # Cross-tool standards: AGENTS.md (instructions), .mcp.json (MCP servers), .agents/skills/
```

Adding a tool means one file plus one registry entry. The contract tests in `test/adapters/contract.test.ts` automatically validate any registered adapter against 8 checks (including agent capability declaration and supporting file handling).

### Why composition over inheritance

The original design used a `BaseAdapter` class. It was replaced with plain functions because:
- Adapters vary in which operations they need (Cursor converts skill formats, Claude Code doesn't)
- Shared logic is better expressed as utility functions you call than methods you override
- Testing is simpler - no class hierarchy to mock

## Stack bundle format

```
.promptpit/
├── stack.json          # Manifest: name, version, skills list, compatibility, extends, instructionStrategy
├── agent.promptpit.md  # Agent instructions (merged from CLAUDE.md, .cursorrules, etc.)
├── skills/             # SKILL.md files + supporting files (references/, scripts/, assets/), one per directory
├── rules/              # Conditional rules (*.md with name, description, globs, alwaysApply frontmatter)
├── agents/             # Custom agent definitions (*.md with name, description, tools, model frontmatter)
├── mcp.json            # MCP server configs (secrets replaced with ${PLACEHOLDER})
└── .env.example        # Required environment variables
```

`stack.json` is Zod-validated at read time (`src/shared/schema.ts`). The `extends` field declares dependencies on other stacks. The `instructionStrategy` field controls whether extended instructions are concatenated (default) or overridden.

## Stack composition (extends)

`src/core/resolve.ts` handles dependency resolution in two phases:

1. **`resolveGraph(stackDir)`** — walks `extends` depth-first with parallel sibling fetches. Detects cycles (error with full chain), enforces depth limit (default 10), deduplicates diamonds. Returns nodes in merge order: deepest deps first, root last.

2. **`mergeGraph(graph)`** — merges all nodes left-to-right. Last-declared-wins for skills, rules, agents, MCP, commands, and env vars. Instructions concatenate with `## From {source}` headers (or override via `instructionStrategy`). Produces `ConflictEntry` records for every name collision.

The install manifest (`installed.json`) records `resolvedExtends` with source, version, and commit SHA for drift detection. `pit status` compares commit SHAs to detect upstream changes.

## Idempotent markers

Content written to config files (CLAUDE.md, .cursorrules) is wrapped in HTML comments:

```
<!-- promptpit:start:stack-name:version:adapter-id -->
...content...
<!-- promptpit:end:stack-name -->
```

This means:
- Multiple stacks can coexist in the same file
- Re-installing the same stack replaces its block cleanly
- Uninstall can remove a specific stack without touching others

Marker logic lives in `src/shared/markers.ts`. During collect, `stripAllMarkerBlocks()` removes installed content to prevent recursive duplication.

## Install manifest

`.promptpit/installed.json` tracks what pit installed: stack name, version, source, per-adapter content hashes (SHA-256). Written atomically (temp file + rename). Upsert semantics: re-installing the same stack replaces its entry, different stacks coexist.

`pit status` reads the manifest, computes current hashes of on-disk files, and compares. Reconciliation follows the git model: disk is truth, manifest is a ledger. States: synced, drifted, deleted, removed-by-user.

Schema defined in `src/shared/schema.ts`, I/O in `src/core/manifest.ts`.

## Security model

Three layers of defense for installing untrusted stacks:

1. **Secret stripping** (`src/core/security.ts`) - MCP config values matching known secret patterns (API keys, tokens, connection strings) are replaced with `${PLACEHOLDER}` during collect. A `.env.example` is generated.

2. **Safe parsing** - All YAML frontmatter uses `js-yaml` with `JSON_SCHEMA` (no code execution). Stack manifests are Zod-validated.

3. **Input validation** - GitHub owner/repo/ref inputs are validated against a character allowlist. Dangerous env names (`PATH`, `NODE_OPTIONS`, `LD_PRELOAD`) are blocked. Git operations use `execFileSync` (not `execSync`) to prevent shell injection.

MCP servers get a warning during install since they run as executables on the user's machine.

## GitHub source

`src/sources/github.ts` handles `pit install github:user/repo[@ref]`:

1. Clone the repo to a temp directory
2. Look for `.promptpit/` - if found, use it directly
3. If no `.promptpit/`, run `pit collect` on the repo (auto-collect fallback)
4. Install from the resulting bundle

This means any GitHub repo can be used as a source, even if it doesn't know about promptpit.

## Key dependencies

| Package | Why |
|---------|-----|
| commander | CLI framework |
| zod | Schema validation for stack.json and skill frontmatter |
| gray-matter | YAML frontmatter parsing |
| fast-glob | File pattern matching for skill/rule discovery |
| chalk + ora | Terminal output formatting |
| smol-toml | TOML parsing for Codex CLI config.toml |
| js-yaml | YAML frontmatter generation for init/collect |
| diff | Unified diffs for --dry-run --verbose |
| tsup | Build (single ESM bundle) |
| vitest | Test runner |
