# Architecture

## Overview

promptpit has two commands: `pit collect` (bundle configs) and `pit install` (write them into each tool's format). The core design principle is that promptpit knows nothing about specific AI tools - adapters do.

## Data flow

```
collect:
  detect adapters → read each tool's configs → merge → strip secrets → write .promptpit/

install:
  read .promptpit/ (or clone from GitHub) → detect adapters → write to each tool's format
```

## Adapters

Each AI tool is a `PlatformAdapter` - a plain object with `detect`, `read`, and `write` functions. No base class. Shared logic lives in `adapter-utils.ts` as composable functions.

```
src/adapters/
├── types.ts          # PlatformAdapter interface, capabilities, config types
├── registry.ts       # Adapter list, detection, lookup
├── adapter-utils.ts  # Shared read/write helpers (readSkillsFromDir, writeWithMarkers, etc.)
├── claude-code.ts    # Claude Code: CLAUDE.md, .claude/skills/, .claude/settings.json
└── cursor.ts         # Cursor: .cursorrules, .cursor/rules/ (.mdc), .cursor/mcp.json
```

Adding a tool means one file plus one registry entry. The contract tests in `test/adapters/contract.test.ts` automatically validate any registered adapter against 7 checks.

### Why composition over inheritance

The original design used a `BaseAdapter` class. It was replaced with plain functions because:
- Adapters vary in which operations they need (Cursor converts skill formats, Claude Code doesn't)
- Shared logic is better expressed as utility functions you call than methods you override
- Testing is simpler - no class hierarchy to mock

## Stack bundle format

```
.promptpit/
├── stack.json          # Manifest: name, version, skills list, compatibility
├── agent.promptpit.md  # Agent instructions (merged from CLAUDE.md, .cursorrules, etc.)
├── skills/             # SKILL.md files, one per directory
├── mcp.json            # MCP server configs (secrets replaced with ${PLACEHOLDER})
└── .env.example        # Required environment variables
```

`stack.json` is Zod-validated at read time (`src/shared/schema.ts`).

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
- Uninstall (future) can remove a specific stack without touching others

Marker logic lives in `src/shared/markers.ts`.

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
| tsup | Build (single ESM bundle) |
| vitest | Test runner |
