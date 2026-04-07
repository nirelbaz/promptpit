---
tool: zed
display-name: Zed
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://zed.dev/docs/ai/rules
  - https://zed.dev/docs/ai/configuration
  - https://zed.dev/docs/ai/mcp
  - https://zed.dev/releases/stable
---

## Configuration

### Instructions
- Settings: `~/.config/zed/settings.json` (global) and `.zed/settings.json` (project)
- Rules files checked in priority order (FIRST match wins, only one loaded):
  1. `.rules` (Zed native)
  2. `.cursorrules`
  3. `.windsurfrules`
  4. `.clinerules`
  5. `.github/copilot-instructions.md`
  6. `AGENT.md`
  7. `AGENTS.md`
  8. `CLAUDE.md`
  9. `GEMINI.md`
- Rules Library: built-in editor interface, @-mentionable in conversations

### Skills
- No dedicated skill system documented

### MCP Servers
- Location: `context_servers` key in settings.json (both global and project)
- Format: JSON object with named servers
- Local: `command` + `args` + `env`
- Remote: `url` + `headers` (OAuth supported)
- Tool permissions: `mcp:<server>:<tool_name>` key format
- Can add servers via Agent Panel UI

### Agents
- ACP Registry (v0.221+) for external agents (Claude Agent, Codex, Gemini CLI, GitHub Copilot)
- Session history for external agents (February 2026)

### Rules
- Plain markdown files, no frontmatter schema
- Only first matching file in priority list is used

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- BROADEST cross-tool reading of any tool researched
- Reads .rules: yes (native, highest priority)
- Reads .cursorrules: yes
- Reads .windsurfrules: yes
- Reads .clinerules: yes
- Reads .github/copilot-instructions.md: yes
- Reads AGENT.md / AGENTS.md: yes
- Reads CLAUDE.md: yes
- Reads GEMINI.md: yes
- NOTE: only FIRST matching file used (priority order above)

### Overlap Matrix
| Config source | Read by Zed? | How it's used | Conflict risk |
|---|---|---|---|
| .cursorrules | yes (priority 2) | Instructions | Only if no .rules file exists |
| AGENTS.md | yes (priority 7) | Instructions | Only if no higher-priority file exists |
| CLAUDE.md | yes (priority 8) | Instructions | Only if no higher-priority file exists |
| .github/copilot-instructions.md | yes (priority 5) | Instructions | Only if no higher-priority file exists |

### Deduplication Notes
- First-match-wins means only ONE file is ever loaded — low duplication risk within Zed
- But if promptpit writes multiple files (e.g., CLAUDE.md + AGENTS.md + .cursorrules), only the highest-priority one is used by Zed — the others are wasted

## Behavior
- Rust-based editor, macOS primary, Linux supported
- Stable + Preview release channels
- Releases every 1-2 weeks

## Ecosystem
- Very active open-source project
- ACP Registry for external agent integration
- Thinking effort controls for AI interactions

## Edge Cases
- Only ONE rules file loaded (first match in priority list) — unique among tools
- Uses `context_servers` key (not `mcpServers` or `servers`) for MCP
- No rules frontmatter — plain markdown only
- MCP tool permissions use colon-separated key format

## Promptpit Gaps
- No adapter exists yet — moderate candidate
- Unique first-match-wins priority system means adapter would need to decide WHICH file to write
- MCP uses non-standard `context_servers` key in settings.json
- No rules frontmatter support limits translation from portable format
- Broad cross-tool reading is interesting but first-match-wins limits utility
