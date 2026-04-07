---
tool: claude-code
display-name: Claude Code
status: adapter-exists
last-verified: 1970-01-01
doc-urls:
  - https://docs.anthropic.com/en/docs/claude-code
  - https://github.com/anthropics/claude-code
adapter-file: src/adapters/claude-code.ts
---

## Configuration

### Instructions
- File: `CLAUDE.md` (project root) or `~/.claude/CLAUDE.md` (user-level)
- Format: Plain Markdown, no frontmatter required
- Precedence: User-level CLAUDE.md is loaded first, project-level adds to it
- Multiple CLAUDE.md files can exist in subdirectories (loaded contextually)

### Skills
- Location: `.claude/skills/<name>/SKILL.md` (project) or `~/.claude/skills/` (user)
- Format: Markdown with YAML frontmatter (name, description, allowed-tools, context, etc.)
- Link strategy: symlink from canonical `.agents/skills/`
- Frontmatter fields: name, description, license, metadata, allowed-tools, context, agent, user-invocable, model

### MCP Servers
- File: `.claude/settings.json` (project) or `~/.claude/settings.json` (user)
- Format: JSON, root key `mcpServers`
- Supported transports: stdio
- Remote/SSE: not supported natively

### Agents
- Strategy: native (per-file)
- Location: `.claude/agents/*.md` (project) or `~/.claude/agents/*.md` (user)
- Frontmatter: name, description, tools (array), model
- Model field: supported (e.g., opus, sonnet, haiku)

### Rules
- Location: `.claude/rules/*.md`
- Format: Markdown with YAML frontmatter
- Frontmatter fields: name, description, paths (array — Claude-specific, translated from portable `globs`)
- alwaysApply: not a native field — rules without `paths` are always active

### Hooks
- Supported: yes
- Location: `.claude/settings.json` under `hooks` key
- Types: PreToolUse, PostToolUse, Notification, etc.

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: no
- Reads .mcp.json: no
- Reads .cursorrules: no
- Reads .github/copilot-instructions.md: no

### Overlap Matrix
| Config source | Read by Claude Code? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | no | — | None |
| .mcp.json | no | — | None |
| .cursorrules | no | — | None |

### Deduplication Notes
- Claude Code only reads its own config paths — low duplication risk
- Safe to write CLAUDE.md alongside other tool configs

## Behavior
- Needs verification from official docs via /refresh-knowledge

## Ecosystem
- Needs verification from official docs via /refresh-knowledge

## Edge Cases
- Needs verification from official docs via /refresh-knowledge

## Promptpit Gaps
- Needs verification — run /audit-adapters after knowledge refresh
