---
tool: jetbrains-ai
display-name: JetBrains AI / Junie
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://junie.jetbrains.com/docs/guidelines-and-memory.html
  - https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html
  - https://junie.jetbrains.com/docs/agent-skills.html
---

## Configuration

### Instructions (Guidelines)
- Checked in order (first match wins): custom path (JUNIE_GUIDELINES_FILENAME env var) → `.junie/AGENTS.md` → `AGENTS.md` (project root) → `.junie/rules/*.md` (concatenated) → `.junie/guidelines.md` (legacy)
- Format: plain Markdown (AGENTS.md format), no frontmatter

### Skills (Agent Skills, March 2026)
- Project: `.junie/skills/<name>/SKILL.md`
- User: `~/.junie/skills/<name>/SKILL.md`
- Format: SKILL.md with YAML frontmatter (name required, description required)
- Follows open Agent Skills standard
- Optional: scripts/, templates/, checklists/ subdirectories

### MCP Servers
- Project: `.junie/mcp/mcp.json`
- Global: `~/.junie/mcp/mcp.json`
- Format: JSON, root key `mcpServers`
- Transports: stdio, HTTP (remote)
- CLI flags: `--mcp-default-locations`, `--mcp-location <path>`
- Starting 2025.2: JetBrains IDEs include built-in MCP server for external clients

### Agents
- No per-file agent system documented
- Junie CLI as standalone terminal agent

### Rules
- Location: `.junie/rules/*.md` (concatenated, no frontmatter)

### Hooks
- Action Allowlist for auto-approving commands

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: YES (primary supported format, in .junie/ or project root)
- Reads .junie/guidelines.md: yes (legacy native)
- Reads .mcp.json: no
- Reads CLAUDE.md: no
- Reads .cursorrules: no

### Overlap Matrix
| Config source | Read by Junie? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | YES | Guidelines | Duplication if also writing .junie/ configs |

### Deduplication Notes
- Reads AGENTS.md from both `.junie/AGENTS.md` and project root — would need to pick one write target

## Behavior
- Tied to JetBrains IDE release cycle (quarterly: 20XX.1, .2, .3)
- Works across all JetBrains IDEs
- Junie CLI available as standalone

## Ecosystem
- Agent Skills adopted March 2026
- Built-in IDE MCP server (2025.2) allows external tools to control JetBrains
- Junie = JetBrains' agentic coding assistant (replaces AI Assistant for agentic tasks)

## Edge Cases
- JUNIE_GUIDELINES_FILENAME env var can redirect guidelines loading
- Guidelines checked in specific priority order — first match wins
- Built-in MCP server makes JetBrains both an MCP client AND server

## Promptpit Gaps
- No adapter exists yet — strong candidate due to Agent Skills support, MCP, AGENTS.md
- Rich config: skills (SKILL.md), MCP (.junie/mcp/mcp.json), guidelines (AGENTS.md)
- Unique `.junie/` directory prefix — would need its own adapter paths
- CLI + IDE support means both project and global paths needed
