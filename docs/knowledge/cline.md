---
tool: cline
display-name: Cline
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://docs.cline.bot/customization/cline-rules
  - https://docs.cline.bot/mcp/configuring-mcp-servers
  - https://github.com/cline/cline
---

## Configuration

### Instructions
- Custom Instructions text box: deprecated in favor of .clinerules directory

### Skills
- No dedicated skill system

### MCP Servers
- Location: VS Code extension globalStorage `cline_mcp_settings.json`
  - macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
  - Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
  - CLI: `~/.cline/data/settings/cline_mcp_settings.json`
- Format: JSON, root key `mcpServers`
- Configured via UI or direct JSON editing

### Agents
- No per-file agent system

### Rules
- Workspace: `.clinerules/*.md` and `.clinerules/*.txt`
- Global (OS-specific): macOS `~/Documents/Cline/Rules/`, Windows `Documents\Cline\Rules`, Linux `~/Documents/Cline/Rules/` or `~/Cline/Rules/`
- Legacy: single `.clinerules` file at project root (deprecated)
- Frontmatter: `paths` (array of glob patterns) — only supported conditional field
- Glob syntax: `*`, `**`, `?`, `[abc]`, `{a,b}`
- No frontmatter = rule activates for all requests
- Invalid YAML = fails open (displays raw content)
- Numeric prefixes optional for ordering

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads .clinerules: yes (native)
- Reads .cursorrules: yes (auto-detected)
- Reads .windsurfrules: yes (auto-detected)
- Reads AGENTS.md: proposed (issue #5033), implementation status unverified
- Reads CLAUDE.md: no
- Reads .mcp.json: no

### Overlap Matrix
| Config source | Read by Cline? | How it's used | Conflict risk |
|---|---|---|---|
| .cursorrules | yes | Instructions | Low — Cline reads it alongside .clinerules |
| .windsurfrules | yes | Instructions | Low |
| AGENTS.md | proposed | — | — |

### Deduplication Notes
- Reads multiple tools' rule files — content from .cursorrules + .clinerules could overlap
- MCP stored in VS Code extension storage, not project-level — not easily version-controllable

## Behavior
- VS Code extension + CLI
- Very active open-source project
- Focus Chain (v3.25): todo list injection for long tasks

## Ecosystem
- Frequent releases (multiple per month)
- v3.26.6 as of recent: GPT-5.2, Devstral 2 support

## Edge Cases
- MCP config stored in VS Code extension globalStorage — unusual location, not project-level
- Only `paths` frontmatter field supported (no `alwaysApply`, no `description`)
- Invalid YAML fails open — displays raw content as rule
- Reads .cursorrules and .windsurfrules alongside native .clinerules

## Promptpit Gaps
- No adapter exists yet — moderate candidate
- MCP in extension globalStorage makes project-level MCP install impossible
- Limited rule frontmatter (only `paths`) limits translation from portable format
- Cross-tool rule reading means promptpit content in .cursorrules would be picked up
