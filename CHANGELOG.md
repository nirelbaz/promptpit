# Changelog

## 0.3.9 (2026-04-06)

### Fixed

- `pit status` no longer shows false drift after a fresh install. The install manifest now hashes translated content (what's actually written to disk) instead of source content, fixing mismatches for inline agents and Copilot-translated agents/rules.
- Copilot rules now round-trip correctly. The reader was storing raw file content (with `applyTo`) but portable frontmatter (with `globs`), so downstream tools lost the globs translation. Content is now rebuilt with portable frontmatter.
- Standards MCP servers with version pins (e.g. `@2025.4.8`) are no longer silently replaced by unpinned versions from other adapters during collect.
- Standards HTTP MCP servers (url-only, like `https://mcp.exa.ai/mcp`) are no longer dropped during collect. Previously, all Standards MCP was wholesale-wiped when another adapter had any MCP servers.
- Codex adapter no longer falsely detects on projects that only have AGENTS.md. Detection now requires a `.codex/` directory, preventing self-inflicted drift on Standards-only projects.
- MCP overwrite warnings are suppressed on idempotent re-installs (same content, different key order).
- Adapter-specific agent fields (like Codex `sandbox_mode`, `model_reasoning_effort`) are preserved during collection instead of being stripped.
- JSONC comments in `.vscode/mcp.json` are now parsed correctly (added `strip-json-comments`).
- Standards MCP is no longer suppressed when other adapters detect MCP capability but read zero servers.
- Copilot adapter now reads `.instructions.md` files from subdirectories (e.g. `review-guide/`).
- Copilot adapter now reads plain `.md` agent files alongside `.agent.md`.

### Added

- Codex `.toml` agents (`.codex/agents/*.toml`) are now collected. Maps `developer_instructions`, `model`, `sandbox_mode`, and other TOML fields to portable agent format.
- TOML MCP reader now supports HTTP/SSE servers (`url`/`serverUrl` fields).
- `pit init` supports `--yes` and `--name` flags for non-interactive/CI use.
- Shared `warnMcpOverwrites()` helper with hash-based comparison for key-order independence.
- 80+ new tests covering all fixes and features.
- Real-world QA validation report updated with 3 rounds of testing across 9 repos.

## 0.3.8 (2026-04-06)

### Fixed

- Cursor adapter now reads `.md` rules in addition to `.mdc`. Real-world repos like `everything-claude-code` use plain `.md` format in `.cursor/rules/`, and all 39 of those rules were silently dropped.
- Cursor adapter now reads skills from `.cursor/skills/*/SKILL.md`. Previously the skills path incorrectly pointed to `.cursor/rules/` and skills were hardcoded to an empty array, losing 14 skills across repos like `snyk-intellij-plugin` and `everything-claude-code`.

## 0.3.7 (2026-04-03)

### Fixed

- Rules without `name` in frontmatter are no longer silently dropped. Real-world rules from Claude Code, Cursor, and Copilot rarely include `name`, so pit now infers it from the filename. Previously, every rule from every tested repo was lost during collect.
- Agents without `name` or `description` in frontmatter are no longer silently dropped. Name is inferred from filename, description from the first body line. Previously, 13 of 17 real-world agents were lost.
- `globs: null` in rule frontmatter no longer causes a validation error. Treated as "no globs specified."
- Validation error messages now include field names (e.g., "name: Required") instead of generic "Required, Required".

### Added

- Real-world validation test suite (`test/e2e/real-world-repos.test.ts`) that clones 9 public GitHub repos across all 5 adapters and runs the full collect, validate, install, status pipeline. Documents remaining gaps in `REAL_WORLD_REPORT.md`.

## 0.3.6 (2026-04-02)

### Added

- Portable custom agents in `.promptpit/agents/*.md` with YAML frontmatter (`name`, `description`, `tools`, `model`). Agents are written natively to Claude Code (`.claude/agents/`) and Copilot (`.github/agents/*.agent.md`), and inlined into instructions for tools without native agent support (Codex, Cursor, Standards/AGENTS.md).
- `pit collect` now reads agents from Claude Code and Copilot projects and includes them in the bundle.
- `pit install` writes agents to all detected tools with format translation (Copilot drops `model` field, uses `.agent.md` extension).
- `pit validate` checks agent frontmatter for errors.
- `pit status` detects agent drift for native adapters (hash comparison against install manifest).
- `pit check` verifies agent freshness and drift in CI.
- `pit init` scaffolds an `agents/` directory alongside `skills/` and `rules/`.
- Tools without native agent support (Windsurf, Zed, Cline, Aider, and others) get agent definitions embedded in AGENTS.md automatically.

### Fixed

- `pit check` now detects rule drift and freshness (was silently skipping rules despite install manifest tracking them).

## 0.3.5 (2026-04-02)

### Added

- Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter (`name`, `description`, `globs`, `alwaysApply`). Rules are translated per-adapter during install: `.claude/rules/*.md` (Claude Code), `.cursor/rules/*.mdc` (Cursor), `.github/instructions/*.instructions.md` (Copilot).
- `pit collect` now reads rules from Claude Code, Cursor, and Copilot projects and includes them in the bundle.
- `pit validate` checks rule frontmatter for errors.
- `pit status` detects rule drift (modified, deleted, synced).
- `pit init` scaffolds a `rules/` directory alongside `skills/`.
- Rule files in Cursor and Copilot use a `rule-` prefix to avoid name collisions with skills in shared directories.

## 0.3.4 (2026-04-02)

### Added

- Help examples on all 7 CLI commands (`pit <command> --help` now shows usage examples)
- Next-step suggestions after `pit collect`, `pit install`, `pit validate`, and `pit check` complete
- E2E journey tests for multi-stack coexistence, corrupted manifest recovery, drift detection, and skill authoring

### Changed

- `pit init` next-steps revised: dropped "edit stack.json" step, added `pit validate` and `pit collect` hints
- `pit status` drift suggestions now use visible colors instead of dim text
- Error messages for "no .promptpit/ found" and "no AI tools found" now suggest `pit init` and `pit collect` as next actions

## 0.3.3 (2026-04-01)

### Fixed

- `pit validate` now correctly invokes agnix with `--format json` as a global flag (before the `validate` subcommand), matching agnix's actual CLI interface.

## 0.3.2 (2026-04-01)

### Changed

- `pit validate` now finds agnix when installed globally (e.g., `npm i -g agnix`), not just as a local dev dependency. Local installs are still preferred when present.

### Fixed

- `pit collect` no longer skips skills that use a single string for `allowed-tools` or `context` in SKILL.md frontmatter (e.g., `allowed-tools: Read`). YAML parses these as strings, not arrays. The schema now coerces both forms automatically.

## 0.3.0 (2026-04-01) — Phase 1: Team Platform

The "new dev joins, runs one command, every AI tool is configured" release. Five adapters, seven commands, and drift detection that actually works across all of them.

### Highlights

- **Five adapters ship as Tier 1:** Claude Code, Cursor, Codex CLI, GitHub Copilot, and Standards (AGENTS.md + .mcp.json). Install one stack, every tool gets configured in its native format
- **Seven commands:** `pit init` (scaffold), `pit collect` (bundle), `pit install` (write), `pit status` (drift check), `pit watch` (live-sync), `pit validate` (lint), `pit check` (CI gate)
- **Dry-run previews:** `--dry-run` on collect and install shows exactly what would change. `--verbose` adds unified diffs
- **HTTP remote MCP servers:** Stacks can now include url-based MCP servers alongside stdio ones. Copilot gets `type: "http"` inferred automatically

### Added

- `pit init` scaffolds a new `.promptpit/` stack with interactive prompts for name, version, description, author, and optional files
- `pit validate` checks stack.json, skills, mcp.json, agent instructions, and .env.example. Reports all errors at once. `--json` for CI. Optional agnix integration for 385+ adapter-specific lint rules
- `pit check` verifies installed config is fresh (stack.json matches installed.json) and in sync (files on disk match recorded hashes). Exits non-zero on drift. `--json` for CI pipelines
- GitHub Copilot adapter: instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` (applyTo globs), MCP to `.vscode/mcp.json` (servers key, type inference)
- Codex CLI adapter: instructions to AGENTS.md, skills symlinked to `.codex/skills/`, MCP merged into `.codex/config.toml` via TOML writer
- Standards adapter unified from separate agents-md and mcp-standard adapters. Owns AGENTS.md and .mcp.json as cross-tool outputs
- `--dry-run` on both collect and install with file-by-file preview (create/modify per adapter). `--verbose` adds unified diffs for modified files
- `--verbose` / `-v` on `pit status` shows per-adapter detail: skill names, MCP server names, instruction paths, individual hash status

### Fixed

- HTTP remote MCP servers (url-only) no longer silently break schema validation
- `pit status` no longer reports false drift for Codex TOML or Copilot MCP immediately after install
- Empty MCP server configs rejected by schema validation
- MCP drift detection uses canonical hashing that ignores adapter-added fields

### Changed

- Each adapter declares `mcpFormat` and `mcpRootKey` in its capabilities for native MCP reading
- 395 tests across 38 test files

## 0.2.9 (2026-04-01)

### Fixed

- HTTP remote MCP servers (url-only, no command) no longer silently break validation. Previously, a single remote server in your mcp.json would cause Zod schema validation to fail, dropping ALL MCP servers from the bundle with no warning. Now stdio and remote servers coexist correctly
- `pit status` no longer reports false drift for Codex and Copilot MCP immediately after install. Codex TOML files and Copilot's `servers` key + `type` field were causing hash mismatches on every check. Status now reads each adapter's MCP format natively
- Empty MCP server configs (`{}`) are now rejected by schema validation instead of silently accepted

### Changed

- MCP drift detection uses canonical hashing that ignores adapter-added fields (like Copilot's `type: "stdio"`). Only the fields you defined (command, args, env, url, serverUrl) are hashed, so adapters can transform configs without triggering false drift
- Each adapter now declares `mcpFormat` ("json" or "toml") and `mcpRootKey` in its capabilities, replacing hardcoded adapter ID checks in the status command. Adding a new adapter with a different MCP format no longer requires modifying status.ts

## 0.2.8 (2026-04-01)

### Added

- `pit collect --dry-run` and `pit install --dry-run` now show exactly what would happen before writing anything. You get a file-by-file preview: which files would be created or modified, per-adapter breakdowns (Claude Code, Cursor, Copilot, Codex, Standards), and details like "update marker block", "add 2 MCP servers", or "symlink"
- `--verbose` / `-v` flag on both commands. When combined with `--dry-run`, shows unified diffs for files that would be modified. See the exact lines that would change in your CLAUDE.md, .cursorrules, or settings.json before committing to the install

### Changed

- `writeWithMarkers` and `mergeMcpIntoJson` now return rich result objects instead of bare file paths, enabling dry-run introspection without extra file reads
- Three shared helpers (`markersDryRunEntry`, `mcpDryRunEntry`, `skillDryRunEntry`) eliminate dry-run entry construction duplication across all adapters
- `canonicalSkillBase()` extracted from `skill-store.ts` as single source of truth for canonical skill directory paths
- MCP overwrite warnings suppressed during dry-run (no point warning about overwrites that aren't happening)

## 0.2.7 (2026-04-01)

### Added

- `pit validate` checks if a `.promptpit/` stack is well-formed before publishing or installing. Validates stack.json (schema), agent.promptpit.md (frontmatter), skills (frontmatter per skill), mcp.json (config schema), and .env.example (dangerous env names). Reports all errors at once instead of failing on the first one. Supports `--json` for CI integration. Exit 0 when valid (warnings allowed), exit 1 on errors
- Optional agnix integration. When agnix is installed (`npm i -D agnix`), `pit validate` auto-detects the binary and runs 385+ adapter-specific lint rules on top of the built-in checks. Diagnostics from agnix appear in a separate section. If agnix isn't installed, a one-line tip suggests it

## 0.2.6 (2026-04-01)

### Added

- `pit check` verifies your AI config is fresh and in sync, designed for CI pipelines. Two-phase check: freshness compares `.promptpit/stack.json` against `installed.json` (catches forgotten installs, version mismatches, missing skills/MCP servers), drift compares installed files on disk against their recorded hashes (catches hand-edits and deletions). Exits non-zero on any problem. Supports `--json` for machine-readable output. Add `npx promptpit check` to your CI pipeline and never ship stale AI config again

### Changed

- `tryReadStackManifest()` and `tryReadMcpConfig()` extracted as shared helpers in `stack.ts`, eliminating duplication between `readStack()` and the new check command
- `computeStatus()` and its supporting types now exported from `status.ts` for reuse by the check command

## 0.2.5 (2026-04-01)

### Added

- Codex CLI adapter. `pit install` now detects Codex CLI projects and writes instructions to AGENTS.md, symlinks skills to `.codex/skills/`, and merges MCP servers into `.codex/config.toml` (TOML format). Codex joins Claude Code, Cursor, and Copilot as a Tier 1 adapter
- TOML config support via `smol-toml`. Reads existing `config.toml` settings (model, approval policy, etc.) and preserves them when merging MCP servers. Codex-specific fields like `enabled_tools` and `startup_timeout_sec` are stripped during collect so stacks stay portable

## 0.2.4 (2026-04-01)

### Added

- `pit init` scaffolds a new `.promptpit/` stack from scratch with interactive prompts. Asks for stack name, version, description, and author, then optionally creates agent instructions, MCP config, and .env.example files. Validates input against the stack schema before writing. Use `--force` to overwrite an existing stack, `--output` to target a custom directory
- Default stack name auto-sanitized from the directory name (strips invalid characters, falls back to `my-stack`)
- Agent instructions frontmatter now generated via `js-yaml` for correctness with special characters

## 0.2.3 (2026-04-01)

### Added

- GitHub Copilot adapter (Tier 1). `pit install` now writes to Copilot's native config paths: instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` with `applyTo` glob frontmatter, and MCP servers to `.vscode/mcp.json` with the correct `servers` root key and required `type` field per entry
- `pit collect` now detects Copilot projects via `.github/copilot-instructions.md` and `.vscode/mcp.json`, and reads scoped instructions as rules
- `pit watch` automatically re-translates skills for Copilot when `.agents/skills/` files change (same translate-copy strategy as Cursor)
- Error message in `pit collect` now lists Copilot paths so users know what's detected

### Changed

- The separate `agents-md` and `mcp-standard` adapters are now a single `standards` adapter that owns all cross-tool conventions (AGENTS.md, .mcp.json, .agents/skills/). `pit install` writes both files in one pass instead of coordinating two adapters
- MCP JSON merge logic and permission error handling extracted into shared utilities (`mergeMcpIntoJson`, `rethrowPermissionError`), reducing ~60 lines of duplication across claude-code, cursor, and standards adapters
- All adapters that write MCP config now emit overwrite warnings when replacing existing servers, not just some of them
- `pit collect` dedup logic simplified: reads all adapters, then clears MCP from standards when other MCP-capable adapters are present (instead of pre-filtering the read set)
- `pit install` always-include logic consolidated from two separate blocks into one

## 0.2.2 (2026-04-01)

### Added

- `pit status --verbose` (or `-v`) shows the full inventory per adapter: individual skill names, MCP server names, instruction file paths, and per-artifact sync state. Default output stays compact (counts only), verbose expands to the complete picture. Useful for debugging drift and verifying exactly what's installed
- Suggestions ("Run `pit install`...") now appear in both default and verbose modes, so users debugging drift always see remediation hints

### Changed

- State severity logic centralized into `escalateState()` with a priority table, replacing scattered inline guards. Fixes a latent bug where instruction state was set unconditionally instead of escalating
- `formatLong` and `formatVerbose` unified into a single `formatDetailed` renderer, eliminating 15 lines of duplication
- Non-verbose "Changes" section now shows per-file state icons (e.g., a drifted skill shows M, a deleted skill shows D) instead of using the adapter's overall worst state for all files
- Corrupt MCP JSON files now correctly mark all servers as "drifted" instead of misclassifying them as "deleted"
- Test helper `captureOutput()` extracted, replacing 22 instances of spy/capture/restore boilerplate

## 0.2.1 (2026-04-01)

### Fixed

- `pit status` now shows correct MCP server counts for all adapters, not just .mcp.json. Previously Claude Code's MCP servers were invisible in status output
- `.mcp.json` is now created during install even when it didn't exist before. Previously you needed a pre-existing .mcp.json for the adapter to activate
- `pit status` no longer shows phantom "removed-by-user" entries for the mcp-standard adapter's instructions (it doesn't write instructions)
- Duplicate file entries in `pit status` Changes section are now deduplicated

### Added

- 6 install-to-status integration tests that verify the full loop: MCP counts, .mcp.json creation, drift detection, multi-stack manifests, re-install upsert, and dry-run isolation

## 0.2.0 (2026-04-01)

### Added

- `pit status` shows what stacks are installed, which adapters are synced, and what's drifted. Like `git status` for your AI tooling. Supports `--json` (porcelain) and `--short` output modes
- `pit watch` monitors `.agents/skills/` and re-translates skill files for non-symlinked adapters when they change. Foreground process with 200ms debounce for batch changes
- `.mcp.json` support via a new `mcp-standard` adapter. Project-level MCP configs are read during collect and written during install, alongside adapter-specific MCP paths
- Install manifest (`.promptpit/installed.json`) tracks every install with per-artifact SHA-256 content hashes. Enables status drift detection, collect dedup, and future update/uninstall/diff commands. Atomic writes via temp+rename
- Instruction hash dedup in the merger prevents identical content from multiple adapters (e.g., CLAUDE.md and AGENTS.md with the same text) from being collected twice
- `stripMarkerBlock()` and `stripAllMarkerBlocks()` in markers.ts for removing installed content during collect

### Fixed

- Recursive duplication on collect+install. Previously, re-collecting after install would bundle the installed content again, causing it to grow on each cycle. Now collect strips all promptpit marker blocks before bundling, guaranteeing the round-trip: collect -> install -> collect produces identical output

### Changed

- Replaced the fragile fallback-only read logic (excluding AGENTS.md when Claude Code is detected) with content-hash dedup in the merger. Different content from multiple adapters is now kept; only exact duplicates are removed
- Manifest schema (InstallManifest, InstallEntry, AdapterInstallRecord) co-located with existing Zod schemas in `schema.ts`

## 0.1.6 (2026-03-30)

### Added

- Skills are now installed to `.agents/skills/` as the canonical location, matching the skills.sh ecosystem convention used by 16+ AI tools
- Claude Code skill paths (`.claude/skills/`) are now symlinks to the canonical location instead of copies, so edits to `.agents/skills/` are instantly reflected
- Windows automatically falls back to file copies when symlinks aren't available
- New `pit watch` TODO for future live sync of translated skill copies

### Changed

- Each adapter now declares a `skillLinkStrategy` (`"symlink"`, `"translate-copy"`, or `"none"`) instead of a boolean `skills` flag, making it easier to add new adapters
- Cursor continues to get translated `.mdc` copies (read from bundle, not disk), while native SKILL.md tools get zero-copy symlinks

## 0.1.5 (2026-03-30)

### Added

- AGENTS.md support: `pit install` now always generates an AGENTS.md file, readable by 20+ AI tools (Codex, Copilot, Cursor, Windsurf, Zed, Cline, Roo Code, Amp, Devin, Aider, and more)
- `pit collect` reads AGENTS.md as a fallback when no other tool configs are detected, so projects that only have AGENTS.md can be collected into portable stacks

### Changed

- Extracted shared `writeWithMarkers` helper, making it easier to add new adapters with consistent marker handling

## 0.1.4 (2026-03-28)

- Added ignore tip for `.promptpit/` in team setup docs

## 0.1.3 (2026-03-28)

- `pit install` with no arguments now installs from `.promptpit/` in the current directory
- Added `.promptpit/` bundle with promptpit-starter pre-installed

## 0.1.2 (2026-03-28)

- Fixed global install crash when target directory contains symlinks (e.g., gstack skill symlinks)

## 0.1.1 (2026-03-28)

- Fixed auto-collect for repos that store skills at the repo root (e.g., gstack)
- Fixed env key matching to use line-prefix instead of substring (prevents false positives)
- Fixed stack name validation with strict regex (prevents path traversal)
- Improved warning messages for skipped skills and MCP parse errors

## 0.1.0 (2026-03-28)

Initial release.

- `pit collect` — scan Claude Code and Cursor configs, bundle into portable `.promptpit/` stack
- `pit install` — install stacks from local paths or GitHub repos
- Claude Code adapter (CLAUDE.md, skills, MCP settings)
- Cursor adapter with automatic SKILL.md to .mdc conversion
- Secret stripping for MCP configs with `.env.example` generation
- Idempotent markers for multi-stack coexistence
- `--global` flag for user-level installation
- Safe YAML parsing (prevents code execution from untrusted sources)
- Env var name validation (blocks PATH, NODE_OPTIONS, etc.)
- GitHub source with auto-collect for repos without `.promptpit/`
