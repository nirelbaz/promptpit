---
tool: windsurf
display-name: Windsurf (Codeium)
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://docs.windsurf.com/windsurf/cascade/memories
  - https://docs.windsurf.com/windsurf/cascade/mcp
  - https://docs.windsurf.com/windsurf/cascade/agents-md
  - https://windsurf.com/changelog
---

## Configuration

### Instructions
- Global rules: `~/.codeium/windsurf/memories/global_rules.md` (6,000 char limit, always on)
- Workspace rules: `.windsurf/rules/*.md` (one file per rule, 12,000 char limit each)
- AGENTS.md: supported at project root (auto-activated) and in subdirectories (glob-scoped)
- Memories: `~/.codeium/windsurf/memories/` (workspace-specific, local only)

### Skills
- Agent Skills support added January 2026 for Cascade
- Details on discovery paths need further verification

### MCP Servers
- File: `~/.codeium/windsurf/mcp_config.json`
- Format: JSON, root key `mcpServers`
- Supports env variable interpolation: `${env:VARIABLE_NAME}`
- Max 100 tools across all MCP servers
- Transports: stdio, HTTP/remote

### Agents
- No per-file agent support documented
- Cascade is the primary agent mode

### Rules
- Location: `.windsurf/rules/*.md`
- Frontmatter fields: `trigger` (always_on | model_decision | glob | manual), `globs` (file patterns)
- Rule types by trigger: always_on = in system prompt; model_decision = description-only initially; glob = activated when matching files touched; manual = requires @mention

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: YES (natively, including directory-scoped)
- Reads .mcp.json: no
- Reads CLAUDE.md: no
- Reads .cursorrules: no
- Reads .clinerules: no

### Overlap Matrix
| Config source | Read by Windsurf? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | YES | Auto-activated instructions | If adapter existed, duplication with .windsurf/rules/ |

### Deduplication Notes
- If a promptpit adapter were created, would need to avoid writing to both AGENTS.md (Standards) and .windsurf/rules/

## Behavior
- Frequent releases (roughly bi-weekly "waves")
- Stable + "Windsurf Next" channels
- Plan Mode available alongside Cascade

## Ecosystem
- Active development with frequent releases
- JetBrains plugin also available
- Arena Mode for model comparison (February 2026)
- Agent Skills support for Cascade (January 2026)

## Edge Cases
- Global rules have 6,000 char limit; workspace rules have 12,000 char limit
- MCP tool limit of 100 across all servers
- Unique `trigger` frontmatter field unlike other tools' `alwaysApply`

## Promptpit Gaps
- No adapter exists yet
- Windsurf has mature config: rules with frontmatter, MCP, AGENTS.md support, Agent Skills — strong adapter candidate
- Unique `trigger` field would need translation from portable `alwaysApply`/`globs` format
- MCP config at user-level path (`~/.codeium/windsurf/`) rather than project-level
