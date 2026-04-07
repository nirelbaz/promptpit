---
tool: github-copilot
display-name: GitHub Copilot
status: adapter-exists
last-verified: 1970-01-01
doc-urls:
  - https://docs.github.com/en/copilot/customizing-copilot
  - https://github.blog/changelog/label/copilot/
adapter-file: src/adapters/copilot.ts
---

## Configuration

### Instructions
- File: `.github/copilot-instructions.md` (project) or `~/.github/copilot-instructions.md` (user)
- Format: Plain Markdown

### Skills
- Location: `.github/instructions/*.instructions.md`
- Format: Markdown with YAML frontmatter (`applyTo` field for glob scoping)
- Link strategy: translate-copy (SKILL.md → .instructions.md with `applyTo`)
- Translation: `context` → `applyTo`

### MCP Servers
- File: `.vscode/mcp.json`
- Format: JSON, root key `servers` (not `mcpServers`)
- Each entry requires a `type` field: `"stdio"` or `"http"` (inferred by promptpit from config shape)
- Supported transports: stdio, HTTP/SSE

### Agents
- Strategy: native (per-file)
- Location: `.github/agents/*.agent.md`
- Read pattern: `*.md` glob (catches both `*.agent.md` and plain `*.md`)
- Frontmatter: name, description, tools
- `model` field: stripped during translation (Copilot doesn't support per-agent model selection)

### Rules
- Location: `.github/instructions/*.instructions.md`
- Format: Markdown with `applyTo` frontmatter
- Naming: `rule-` prefix added by promptpit
- Shared directory with skills (both use `.github/instructions/`)

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: needs verification
- Reads .mcp.json: needs verification
- Reads CLAUDE.md: no
- Reads .cursorrules: no

### Overlap Matrix
| Config source | Read by Copilot? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | needs verification | — | — |
| .mcp.json | needs verification | — | — |

### Deduplication Notes
- Skills and rules share `.github/instructions/` directory — naming convention (`rule-` prefix) prevents collisions
- Verify whether Copilot reads any standards files natively

## Behavior
- Needs verification from official docs via /refresh-knowledge

## Ecosystem
- Needs verification from official docs via /refresh-knowledge

## Edge Cases
- Skills and rules share the same directory (`.github/instructions/`)
- Agent reading uses broad `*.md` glob to catch both `.agent.md` and plain `.md` files
- MCP config uses different root key (`servers`) than other tools (`mcpServers`)
- `type` field is added during translation but ignored during hash comparison (`computeMcpServerHash`)

## Promptpit Gaps
- Needs verification — run /audit-adapters after knowledge refresh
