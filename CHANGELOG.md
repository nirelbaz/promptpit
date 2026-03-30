# Changelog

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
