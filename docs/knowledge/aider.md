---
tool: aider
display-name: Aider
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://aider.chat/docs/config.html
  - https://aider.chat/docs/usage/conventions.html
  - https://github.com/Aider-AI/aider
---

## Configuration

### Instructions
- Main config: `.aider.conf.yml` (searched: home dir → git repo root → current dir; later files win)
- Conventions: `CONVENTIONS.md` (loaded via `read:` in config or `--read` flag)
- Model settings: `.aider.model.settings.yml` (same search order)
- Env vars: `.env` file, all CLI flags have `AIDER_` env var equivalents

### Skills
- No native skill system

### MCP Servers
- No native MCP client support
- Third-party MCP servers exist that wrap aider as a tool, but aider itself does not consume MCP servers

### Agents
- No agent system — aider is a CLI tool, not an IDE

### Rules
- No formal rules system — uses CONVENTIONS.md loaded via config

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: reported as supported (2026, unverified exact version)
- Reads CONVENTIONS.md: native format
- Reads .cursorrules: no
- Reads CLAUDE.md: no
- Reads .mcp.json: no

### Overlap Matrix
| Config source | Read by Aider? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | likely yes | Instructions | Low — Aider's config is separate |
| CONVENTIONS.md | yes (via --read) | Coding conventions | Aider-specific |

### Deduplication Notes
- Low duplication risk — Aider's config system is distinct from other tools

## Behavior
- Python-based CLI tool (pip/pipx install)
- Reads config files in cascading order (home → repo root → cwd)
- All CLI flags available as YAML config keys and AIDER_ env vars

## Ecosystem
- Very active open-source project
- Releases roughly weekly during active development
- v0.86.1 as of February 2026
- Supports multiple LLM providers

## Edge Cases
- No IDE integration — purely terminal-based
- No MCP client, unlike most modern AI coding tools
- CONVENTIONS.md must be explicitly loaded via config

## Promptpit Gaps
- No adapter exists — low priority candidate due to minimal config overlap with other tools
- No MCP client, no rules system, no skills — limited surface area for an adapter
- AGENTS.md support (if confirmed) would be the main integration point
