---
tool: continue-dev
display-name: Continue.dev
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://docs.continue.dev/customize/deep-dives/rules
  - https://docs.continue.dev/customize/deep-dives/mcp
  - https://docs.continue.dev/reference
---

## Configuration

### Instructions
- Main config: `~/.continue/config.yaml` (global) and `.continue/config.yaml` (workspace)
- Legacy: `config.json` (migrated to YAML)

### Skills
- No dedicated skill system documented

### MCP Servers
- Location: `.continue/mcpServers/*.yaml` (workspace) — also accepts JSON configs from Claude/Cursor/Cline directly
- Format: YAML with `mcpServers` array
- Transports: stdio, sse, streamable-http
- MCP only works in Agent mode
- Supports secret interpolation: `${{ secrets.NAME }}`

### Agents
- Hub/Mission Control for shared agent configs
- Shareable agent links (v1.5.34, January 2026)

### Rules
- Local: `.continue/rules/*.md` (workspace root)
- Global: `~/.continue/rules/*.md`
- Frontmatter fields: `name` (required), `globs` (string or array), `regex` (string or array), `description`, `alwaysApply` (boolean)
- Most complete frontmatter schema of any tool — includes `regex` field
- Files loaded in lexicographical order (use numeric prefixes: `01-general.md`)
- alwaysApply behavior: true = always; false = only if globs match OR agent decides; undefined = included if no globs OR globs match

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: YES (defaults to looking for it first)
- Reads .mcp.json: no (accepts Claude/Cursor JSON configs in mcpServers directory)
- Reads CLAUDE.md: no
- Reads .cursorrules: no

### Overlap Matrix
| Config source | Read by Continue? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | YES | Instructions | Duplication if also writing .continue/ configs |

### Deduplication Notes
- MCP directory accepts JSON configs from other tools directly — clever cross-tool compatibility
- AGENTS.md reading creates duplication risk if adapter also writes to Continue's native config

## Behavior
- VS Code and JetBrains extensions
- Config migrated from JSON to YAML format

## Ecosystem
- Active open-source project
- Regular releases (weekly-ish)
- Hub for shared configurations

## Edge Cases
- `regex` field in rules frontmatter is unique to Continue.dev
- MCP only works in Agent mode, not general chat
- Accepts Claude/Cursor JSON MCP configs directly in mcpServers directory

## Promptpit Gaps
- No adapter exists yet — moderate candidate
- Rich rules system with frontmatter (globs, regex, alwaysApply, description) — good translation target
- AGENTS.md support and cross-tool MCP compatibility show alignment with standards
- Unique `regex` field would need handling
