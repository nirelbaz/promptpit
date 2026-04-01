# Changelog

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
