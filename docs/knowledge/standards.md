---
tool: standards
display-name: Standards (Agent Skills Spec)
status: adapter-exists
last-verified: 1970-01-01
doc-urls:
  - https://github.com/anthropics/agent-skills-spec
adapter-file: src/adapters/standards.ts
---

## Configuration

### Instructions
- File: `AGENTS.md` (project root) or `~/.agents/AGENTS.md` (user-level)
- Format: Plain Markdown
- Purpose: Cross-tool standard for agent instructions

### Skills
- Location: `.agents/skills/` (canonical location, used by all adapters)
- Format: SKILL.md with YAML frontmatter
- Link strategy: none (Standards adapter doesn't install skills itself — it's the canonical source)

### MCP Servers
- File: `.mcp.json` (project root) or `~/.agents/mcp.json` (user-level)
- Format: JSON, root key `mcpServers`
- Supported transports: stdio

### Agents
- Strategy: inline (embedded in AGENTS.md via marker blocks)
- No native per-file agent support
- No agent reading during collect (returns empty array)

### Rules
- Not supported

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- This IS the standards layer — other tools read from it
- AGENTS.md: read by Codex CLI natively; may be read by others
- .mcp.json: needs verification per tool

### Overlap Matrix
| Config source | Read natively by | Conflict risk |
|---|---|---|
| AGENTS.md | Codex CLI (confirmed), others (needs verification) | HIGH if tools read AGENTS.md + their own config |
| .mcp.json | needs verification | Possible duplication with tool-specific MCP configs |

### Deduplication Notes
- Standards adapter always writes (even if not detected during collect)
- If a tool reads AGENTS.md natively AND promptpit writes to that tool's config, content is duplicated
- This is the primary source of cross-tool duplication risk

## Behavior
- Always included as a write target during install
- Detection: presence of AGENTS.md or .mcp.json
- Does not collect agents (read returns empty array)

## Ecosystem
- Part of the Agent Skills open specification
- Intended as the lingua franca for AI coding tool config

## Edge Cases
- Detection overlap with Codex: both use AGENTS.md — resolved by requiring `.codex/` directory for Codex detection
- Global paths differ from project paths (`~/.agents/` prefix)

## Promptpit Gaps
- Needs verification — run /audit-adapters after knowledge refresh
