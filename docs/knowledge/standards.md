---
tool: standards
display-name: Standards (Agent Skills Spec)
status: adapter-exists
last-verified: 2026-04-07
doc-urls:
  - https://agentskills.io/specification
  - https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md
  - https://github.com/agentskills/agentskills
adapter-file: src/adapters/standards.ts
---

## Configuration

### Instructions
- File: `AGENTS.md` (project root) — cross-tool universal instructions file
- User-level: `~/.agents/AGENTS.md` (promptpit convention)
- Format: Plain Markdown, no standardized format — just markdown instructions
- Purpose: lingua franca for AI coding tool instructions
- AGENTS.md predates the Agent Skills spec and is a separate convention

### Skills
- Location: `.agents/skills/<name>/SKILL.md` (canonical cross-tool location)
- User-level: `~/.agents/skills/<name>/SKILL.md` (promptpit convention)
- Format: SKILL.md with YAML frontmatter (Agent Skills open standard)
- Spec released: December 18, 2025 by Anthropic
- Stewarded by Agentic AI Foundation under the Linux Foundation
- Frontmatter: name (required, max 64 chars, lowercase+hyphens), description (required, max 1024 chars)
- Progressive disclosure: advertise → load → read resources
- Adopted by 30+ tools: Claude Code, Codex, Copilot, Cursor, Gemini CLI, JetBrains Junie, and more

### MCP Servers
- File: `.mcp.json` (project root) — emerging standard
- User-level: `~/.agents/mcp.json` (promptpit convention)
- Format: JSON, root key `mcpServers` (camelCase)
- Used by: Claude Code (project-scoped), Cursor uses same key in `.cursor/mcp.json`
- NOT used by: Codex (uses config.toml), VS Code/Copilot (uses `"servers"` key in `.vscode/mcp.json`)

### Agents
- Strategy: inline (embedded in AGENTS.md via marker blocks)
- No standardized per-file agent format in the Agent Skills spec
- No agent reading during collect (Standards adapter returns empty array)

### Rules
- Not supported (no cross-tool rule standard exists)

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- This IS the standards layer — other tools read from it
- AGENTS.md read natively by: Codex (primary), Copilot (with `chat.useAgentsMdFile`), Cursor (likely v2.3+)
- AGENTS.md NOT read by: Claude Code (reads CLAUDE.md, can @-import AGENTS.md)
- .mcp.json read by: Claude Code (project-scoped)
- .agents/skills/ read by: Codex, Copilot, and tools adopting Agent Skills spec

### Overlap Matrix
| Config source | Read natively by | Conflict risk |
|---|---|---|
| AGENTS.md | Codex (confirmed), Copilot (with setting), Cursor (likely) | HIGH — if tools read AGENTS.md + their own config with same content |
| .mcp.json | Claude Code | MEDIUM — if Claude Code reads .mcp.json AND its own .claude/settings.json |
| .agents/skills/ | Codex, Copilot | LOW — canonical location, but tools also have native paths |

### Deduplication Notes
- Standards adapter always writes during install (even if not detected during collect)
- PRIMARY duplication risk: tool reads AGENTS.md natively AND promptpit writes same content to tool's native config
  - Codex: reads AGENTS.md + gets inline agents via marker → agents appear once per stack (marker-scoped)
  - Copilot: reads AGENTS.md (if enabled) + gets content in copilot-instructions.md → instructions duplicated
  - Cursor: reads AGENTS.md (if supported) + gets agents in .cursorrules → content duplicated
- MCP: Claude Code reads .mcp.json + gets MCP in .claude/settings.json → servers duplicated

## Behavior
- Standards adapter always included as write target during install
- Detection: presence of AGENTS.md or .mcp.json
- Does not collect agents (read returns empty array)
- Does not install skills (skillLinkStrategy: "none") — canonical location managed by skill-store

## Ecosystem
- Agent Skills spec released December 18, 2025
- Rapid adoption: 30+ tools within months
- AGENTS.md convention agreed by Google, OpenAI, Sourcegraph, Cursor, Factory in February 2026
- .mcp.json emerged as de facto standard from Claude Code usage
- Not formally part of Agent Skills spec — separate conventions that complement each other

## Edge Cases
- Detection overlap with Codex: both use AGENTS.md — resolved by requiring `.codex/` directory for Codex
- Global paths differ from project paths (`~/.agents/` prefix)
- User-level paths (`~/.agents/AGENTS.md`, `~/.agents/mcp.json`) — unverified if any tool reads from these natively
- .mcp.json root key `mcpServers` matches some tools (Claude Code, Cursor) but not VS Code/Copilot (`servers`)

## Promptpit Gaps
- **Always-write behavior**: Standards adapter always writes during install, which can cause duplication for tools that read AGENTS.md natively. Consider making Standards write conditional on whether target tools already read standards files.
- **Skill reading**: Standards adapter returns `skills: []` in read() but skills may exist at `.agents/skills/`. Not critical since it's primarily a write target.
- **No agent standard**: No cross-tool agent file format exists in the spec. Agents are inlined in AGENTS.md which works but loses structured data.
- **MCP root key inconsistency**: .mcp.json uses `mcpServers` but VS Code/Copilot uses `servers` — not a Standards adapter bug, but a gap in the standard.
- **User-level paths**: `~/.agents/` paths are a promptpit convention, not part of any spec. May not be read by any tool natively.
