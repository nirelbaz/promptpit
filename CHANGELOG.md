# Changelog

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
