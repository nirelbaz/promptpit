---
tool: cursor
display-name: Cursor
status: adapter-exists
last-verified: 1970-01-01
doc-urls:
  - https://docs.cursor.com/configuration
  - https://github.com/getcursor/cursor
adapter-file: src/adapters/cursor.ts
---

## Configuration

### Instructions
- File: `.cursorrules` (project root, legacy) or `.cursor/rules/*.mdc` (current)
- Format: Plain Markdown (`.cursorrules`) or MDC with YAML frontmatter (`.cursor/rules/`)
- Precedence: `.cursor/rules/` is the current recommended approach; `.cursorrules` is legacy but still supported
- User-level: `~/.cursor/.cursorrules`

### Skills
- Location: `.cursor/skills/` (read), installed as `.cursor/rules/*.mdc` (write via promptpit)
- Format: MDC (Markdown Components) — frontmatter with description, globs
- Link strategy: translate-copy (SKILL.md frontmatter → .mdc frontmatter)
- Translation: `context` → `globs`, other fields mapped to description

### MCP Servers
- File: `.cursor/mcp.json`
- Format: JSON, root key `mcpServers`
- Supported transports: stdio, SSE

### Agents
- Strategy: inline (embedded in `.cursorrules` via marker block)
- No native per-file agent support
- Agents rendered as `## Custom Agents` section with name, description, tools listed

### Rules
- Location: `.cursor/rules/*.mdc`
- Format: MDC with YAML frontmatter
- Naming: `rule-` prefix added by promptpit during install
- Frontmatter fields: description, alwaysApply, globs

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: needs verification
- Reads .mcp.json: needs verification
- Reads CLAUDE.md: no
- Reads .github/copilot-instructions.md: no

### Overlap Matrix
| Config source | Read by Cursor? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | needs verification | — | — |
| .mcp.json | needs verification | — | — |
| .cursorrules | yes (legacy) | System prompt | Duplication if also writing .cursor/rules/ |

### Deduplication Notes
- `.cursorrules` and `.cursor/rules/` may both be read — verify with /refresh-knowledge
- Promptpit writes agents inline to `.cursorrules` — if Cursor reads both, agents appear twice

## Behavior
- Needs verification from official docs via /refresh-knowledge

## Ecosystem
- Needs verification from official docs via /refresh-knowledge

## Edge Cases
- `.mdc` files use non-standard YAML parsing — unquoted glob patterns like `**/*.ts` are valid
- Promptpit uses default gray-matter (not SAFE_MATTER_OPTIONS) when reading .mdc files for this reason

## Promptpit Gaps
- Needs verification — run /audit-adapters after knowledge refresh
