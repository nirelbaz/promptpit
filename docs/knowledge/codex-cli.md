---
tool: codex-cli
display-name: Codex CLI
status: adapter-exists
last-verified: 1970-01-01
doc-urls:
  - https://github.com/openai/codex
adapter-file: src/adapters/codex.ts
---

## Configuration

### Instructions
- File: `AGENTS.md` (project root) or `~/.codex/AGENTS.md` (user-level)
- Format: Plain Markdown
- Agents inlined as `## Custom Agents` section via marker blocks

### Skills
- Location: `.codex/skills/<name>/SKILL.md` (project) or `~/.codex/skills/` (user)
- Format: SKILL.md with YAML frontmatter
- Link strategy: symlink from canonical `.agents/skills/`

### MCP Servers
- File: `.codex/config.toml`
- Format: TOML, root key `mcp_servers`
- Supported transports: stdio

### Agents
- Strategy: inline (embedded in `AGENTS.md` via marker block)
- Read from: `.codex/agents/` directory (TOML-based agent definitions)
- Written as: inline `## Custom Agents` section in AGENTS.md

### Rules
- Not supported

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: yes — this IS its primary config file (shared with Standards adapter)
- Reads .mcp.json: needs verification
- Reads CLAUDE.md: no
- Reads .cursorrules: no
- Reads .github/copilot-instructions.md: no

### Overlap Matrix
| Config source | Read by Codex? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | yes | Primary instructions | HIGH — shared with Standards adapter |
| .mcp.json | needs verification | — | — |

### Deduplication Notes
- Codex and Standards both use AGENTS.md — promptpit differentiates by checking for `.codex/` directory
- If both adapters write marker blocks to AGENTS.md, content appears once per stack (markers are adapter-scoped)

## Behavior
- Needs verification from official docs via /refresh-knowledge

## Ecosystem
- Needs verification from official docs via /refresh-knowledge

## Edge Cases
- Detection requires `.codex/` directory to exist — without it, AGENTS.md-only projects are classified as Standards
- TOML-based agent reading via `readAgentsFromToml()` is unique to this adapter

## Promptpit Gaps
- Needs verification — run /audit-adapters after knowledge refresh
