# Changelog

## 0.1.0 (2026-03-28)

Initial release.

- `pit collect` — scan Claude Code and Cursor configs, bundle into portable `.promptpit/` stack
- `pit install` — install stacks from local paths or GitHub repos
- Claude Code adapter (CLAUDE.md, skills, MCP)
- Cursor adapter with automatic SKILL.md to .mdc conversion
- Secret stripping for MCP configs with `.env.example` generation
- Idempotent markers for multi-stack coexistence
- `--global` flag for user-level installation
- `--dry-run` for previewing changes
- Safe YAML parsing (prevents code execution from untrusted sources)
- Env var name validation (blocks PATH, NODE_OPTIONS, etc.)
- GitHub source with auto-collect for repos without `.promptpit/`
