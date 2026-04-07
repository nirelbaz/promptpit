---
tool: cursor
display-name: Cursor
status: adapter-exists
last-verified: 2026-04-07
doc-urls:
  - https://cursor.com/docs/context/rules
  - https://cursor.com/docs/context/mcp
  - https://cursor.com/docs/context/commands
  - https://cursor.com/changelog/2-4
  - https://cursor.com/changelog/3-0
  - https://forum.cursor.com
adapter-file: src/adapters/cursor.ts
---

## Configuration

### Instructions
- File: `.cursorrules` (project root, DEPRECATED) — plain Markdown, no frontmatter
- User-level: `~/.cursor/.cursorrules`
- User Rules: plain text in Cursor Settings > Rules (applies globally, Agent/Chat only, not autocomplete)
- Team Rules (v1.7+, Enterprise): cloud dashboard, recommended or required
- Precedence: Team Rules > Project Rules > User Rules (all merged, earlier wins on conflict)
- AGENTS.md: likely supported in v2.3+/2.4+ (listed on agents.md official site), but exact version unverified

### Skills (v2.4+, March 2026)
- Location: `.cursor/skills/<name>/SKILL.md` (project) or `~/.cursor/skills/<name>/SKILL.md` (user)
- Format: SKILL.md with YAML frontmatter (Agent Skills open standard)
- Frontmatter: name (required, must match directory, lowercase+hyphens), description (required, max 1024 chars)
- Progressive disclosure: name+description advertised, full SKILL.md loaded on match
- `/migrate-to-skills` command to convert dynamic rules and slash commands
- Limitation: subagents cannot use skills directly (workaround: read skill files manually)

### MCP Servers
- Project: `.cursor/mcp.json`
- Global: `~/.cursor/mcp.json`
- Project-level wins on same server name
- Format: JSON, root key `mcpServers`
- Transports: stdio (command/args/env), SSE (url, deprecated), Streamable HTTP (url/headers, recommended)
- Type inference: type inferred from command vs url presence (explicit `type` field unverified as required/optional)
- Tool limit: ~40 active tools across all MCP servers combined — exceeding causes silent tool loss
- MCP Resources support (v1.6), Elicitation (v1.5)

### Agents
- NO native per-file agent support (no `.cursor/agents/` directory)
- Community feature request exists but not implemented
- Cursor has Commands (v1.6+): `.cursor/commands/<name>.md` — reusable AI prompts, plain Markdown, no frontmatter, invoked via `/`
- Agent Mode: default interaction (Cmd+L), autonomous file operations
- Subagents (v2.4): independent agents for discrete tasks, parallel execution
- Cloud Agents (v3.0): push tasks to cloud (replaces Background Agents from v2.0)
- cursor-agent CLI (January 2026): terminal-based agent with MCP support

### Rules
- Location: `.cursor/rules/*.mdc` (flat files — the working format)
- Folder-based `.cursor/rules/<name>/RULE.md` format: announced in v2.2 but BROKEN in practice through 2.3.10+. Settings UI still creates flat .mdc files. Do not use.
- Format: MDC with YAML frontmatter (three fields only):
  - `description` (string) — summary for intelligent matching
  - `globs` (string or comma-separated patterns) — file patterns for scoped activation
  - `alwaysApply` (boolean) — universal activation flag
- Rule type resolution by frontmatter:
  - Always: `alwaysApply: true`
  - Auto Attached: `globs` set, `alwaysApply: false`
  - Agent Requested: `description` set, no `globs`, `alwaysApply: false`
  - Manual: no frontmatter — only via @-mention
- 500-line soft limit per rule
- Naming: `rule-` prefix added by promptpit during install

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: likely yes (v2.3+/2.4+, listed on agents.md official site, but not in Cursor changelogs — unverified exact version)
- Reads .mcp.json: no (uses `.cursor/mcp.json`)
- Reads CLAUDE.md: no
- Reads .github/copilot-instructions.md: no
- Reads .vscode/settings.json: yes (inherited from VS Code fork)
- Reads .cursor/skills/*/SKILL.md: yes (v2.4+, Agent Skills standard)

### Overlap Matrix
| Config source | Read by Cursor? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | likely yes (v2.3+) | Instructions | If also writing .cursorrules, content duplicated |
| .mcp.json | no | — | None |
| .cursorrules | yes (legacy) | System prompt | Duplication with .cursor/rules/ if both present |
| .vscode/settings.json | yes | VS Code inherited settings | Low risk |

### Deduplication Notes
- If Cursor reads AGENTS.md AND promptpit writes agents inline to .cursorrules, agent content appears twice
- `.cursorrules` and `.cursor/rules/` content both loaded — avoid writing overlapping content to both
- Cursor now has native SKILL.md support (v2.4) — promptpit could install skills to `.cursor/skills/` instead of translating to .mdc rules

## Behavior
- Rules loaded on session start and when file context changes (for glob-matched)
- All applicable rules merged into model context
- No documented caching — rules read fresh each session
- User Rules apply only in Agent/Chat mode, not inline autocomplete

## Ecosystem
- Rapid release cadence with major versions every 1-2 months
- v1.5 (Aug 2025) → v1.6 (Sep) → v1.7 (Late 2025) → v2.0 (Jan 2026) → v2.2 (Feb) → v2.4 (Mar) → v3.0 (Apr 2, 2026)
- Agent Skills standard adopted in v2.4
- Cloud Agents (v3.0) replaces Background Agents
- Design Mode added in v3.0
- Notepads deprecated in v2.0
- SSE/HTTP transport deprecated in favor of Streamable HTTP

## Edge Cases
- `.mdc` files use non-standard YAML parsing — unquoted glob patterns like `**/*.ts` are valid
- Promptpit uses default gray-matter (not SAFE_MATTER_OPTIONS) when reading .mdc files for this reason
- Folder-based RULE.md format (`.cursor/rules/<name>/RULE.md`) is BROKEN — do not use, stick with flat .mdc
- `contextFiles` and `tags` frontmatter fields are NOT official — community suggestions only
- ~40 MCP tool limit — exceeding causes silent tool loss
- Subagents cannot use skills directly

## Promptpit Gaps
- **Native SKILL.md support**: Cursor v2.4+ reads `.cursor/skills/*/SKILL.md` natively. The adapter currently translates skills to .mdc rules and writes to `.cursor/rules/`. Could instead write to `.cursor/skills/` directly using the standard format, avoiding translation.
- **AGENTS.md reading**: If Cursor reads AGENTS.md natively, the Standards adapter writing to AGENTS.md + the Cursor adapter inlining agents into .cursorrules causes duplication.
- **Commands**: `.cursor/commands/*.md` (v1.6+) is a potential install target for agent-like content that the adapter doesn't handle.
- **Streamable HTTP MCP**: Headers field for MCP servers may need explicit handling.
- **Cloud Agents / cursor-agent CLI**: New execution contexts that may need consideration.
- **Team Rules**: Enterprise cloud-dashboard rules not addressable by promptpit.
