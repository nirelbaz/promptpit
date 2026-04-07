---
tool: claude-code
display-name: Claude Code
status: adapter-exists
last-verified: 2026-04-07
doc-urls:
  - https://code.claude.com/docs/en/settings
  - https://code.claude.com/docs/en/memory
  - https://code.claude.com/docs/en/skills
  - https://code.claude.com/docs/en/mcp
  - https://code.claude.com/docs/en/sub-agents
  - https://code.claude.com/docs/en/hooks
  - https://code.claude.com/docs/en/changelog
  - https://github.com/anthropics/claude-code
adapter-file: src/adapters/claude-code.ts
---

## Configuration

### Instructions
- File: `CLAUDE.md` (project root or `.claude/CLAUDE.md`) and `~/.claude/CLAUDE.md` (user-level)
- Also: `CLAUDE.local.md` (personal project-specific, gitignored)
- Managed: `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/CLAUDE.md` (Linux)
- Format: Plain Markdown, no frontmatter required
- Precedence: Managed > Local > Project > User (all concatenated, not overriding)
- Walks UP directory tree from CWD, loading CLAUDE.md + CLAUDE.local.md at each level
- Supports `@path/to/file` import syntax (max 5 hops)
- Survives `/compact` — re-read from disk
- Target: under 200 lines per file for best adherence
- `claudeMdExcludes` setting (glob patterns) to skip specific files in monorepos

### Settings
- Project: `.claude/settings.json` (shared via git)
- Local: `.claude/settings.local.json` (gitignored, overrides project)
- User: `~/.claude/settings.json`
- Managed: `managed-settings.json` in system dirs (cannot be overridden)
- Drop-in directory: `managed-settings.d/` merged alphabetically
- Precedence: Managed > CLI args > Local > Project > User
- JSON Schema: `https://json.schemastore.org/claude-code-settings.json`

### Skills
- Location: `.claude/skills/<name>/SKILL.md` (project) or `~/.claude/skills/<name>/SKILL.md` (user)
- Enterprise: via managed settings
- Plugin: `<plugin>/skills/<skill-name>/SKILL.md` (namespaced `plugin-name:skill-name`)
- Format: Markdown with YAML frontmatter
- Frontmatter fields: name, description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, model, effort, context (fork), agent, hooks, paths, shell
- String substitutions: `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`
- Shell injection: `` !`command` `` or ` ```! ` fenced blocks (disabled by `disableSkillShellExecution`)
- Auto-discovery in subdirectory `.claude/skills/` for monorepo support
- Legacy `.claude/commands/` still works; skill wins on name conflict
- Budget: descriptions loaded at 1% of context window, fallback 8000 chars

### MCP Servers
- Project: `.mcp.json` at project root (shared via git)
- User: `~/.claude.json` (mcpServers field)
- Managed: `managed-mcp.json` in system dirs
- Plugin: `.mcp.json` at plugin root or inline in `plugin.json`
- Subagent inline: `mcpServers` in agent frontmatter
- Format: JSON, root key `mcpServers`
- Transports: stdio (recommended local), HTTP/Streamable HTTP (recommended remote), SSE (deprecated)
- Env var expansion: `${VAR}` and `${VAR:-default}` in command, args, env, url, headers
- OAuth 2.0 for remote HTTP servers
- Precedence: Local > Project > User
- Key settings: `enableAllProjectMcpServers`, `allowedMcpServers`/`deniedMcpServers`, `allowManagedMcpServersOnly`

### Agents
- Strategy: native (per-file)
- Project: `.claude/agents/*.md`
- User: `~/.claude/agents/*.md`
- Managed: `.claude/agents/` in managed settings dir
- CLI: `--agents '{JSON}'`
- Plugin: `<plugin>/agents/`
- Frontmatter: name (required), description (required), tools, disallowedTools, model (sonnet/opus/haiku/inherit/full ID), permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, effort, isolation (worktree), color, initialPrompt
- Model resolution: CLAUDE_CODE_SUBAGENT_MODEL env > per-invocation > frontmatter > parent model
- Built-in: Explore (haiku), Plan (inherit), general-purpose (inherit), statusline-setup (sonnet), Claude Code Guide (haiku)
- Plugin agents cannot use hooks, mcpServers, or permissionMode

### Rules
- Project: `.claude/rules/*.md` (recursive subdirectory discovery)
- User: `~/.claude/rules/*.md`
- Format: Markdown with optional YAML frontmatter
- Only supported frontmatter field: `paths` (array of glob patterns)
- Rules WITHOUT `paths` load unconditionally (always active)
- Rules WITH `paths` are conditional — loaded when Claude reads matching files
- Known bugs: `paths` only triggers on Read, not Write/Edit (issue #23478); user-level rules ignore `paths` (issue #21858); YAML globs starting with `{` or `*` need quoting (issue #13905)
- Symlinks supported in `.claude/rules/`

### Hooks
- Supported: yes
- Location: settings.json (all scopes), skill/agent frontmatter, plugin hooks
- 25 event types: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, PermissionDenied, Stop, StopFailure, Notification, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, CwdChanged, FileChanged, ConfigChange, InstructionsLoaded, PreCompact, PostCompact, Elicitation, ElicitationResult, WorktreeCreate, WorktreeRemove, SessionEnd
- Hook types: command, http, prompt, agent
- Exit code 2 = blocking error (stderr fed to Claude)
- Common fields: type, if, timeout, statusMessage, once

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: NO — Claude Code reads CLAUDE.md, not AGENTS.md (can import via `@AGENTS.md`)
- Reads .mcp.json: YES — project-scoped MCP servers loaded from `.mcp.json` at project root
- Reads .cursorrules: no
- Reads .github/copilot-instructions.md: no

### Overlap Matrix
| Config source | Read by Claude Code? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | no (unless @-imported) | — | None |
| .mcp.json | YES | Project MCP servers | Shared with other tools — duplication if also writing .claude/settings.json |
| .cursorrules | no | — | None |
| .github/copilot-instructions.md | no | — | None |

### Deduplication Notes
- Claude Code reads `.mcp.json` — if promptpit writes MCP servers to BOTH `.mcp.json` (Standards) AND `.claude/settings.json` (Claude Code adapter), servers appear twice
- Instructions: Claude Code only reads CLAUDE.md — no duplication risk with other tools' instruction files
- Skills: `.claude/skills/` is tool-specific — no cross-tool overlap

## Behavior
- Settings auto-backed up (5 most recent timestamped backups)
- File watcher detects settings.json changes mid-session for hooks
- Subagents loaded at session start; restart or `/agents` to load new ones
- Skills support live change detection from `--add-dir` directories
- CLAUDE.md survives `/compact` (re-read from disk)
- Auto memory: first 200 lines or 25KB loaded at startup; beyond that, not loaded
- Auto memory stored at `~/.claude/projects/<project>/memory/`
- `autoMemoryDirectory` setting to customize (not accepted from project settings for security)

## Ecosystem
- Release cadence: extremely rapid (~74 releases in 52 days during Feb-Mar 2026)
- Two channels: "stable" (~1 week behind, skips regressions) and "latest" (default)
- Version scheme: v2.1.X where X increments rapidly (2.1.80+ range as of April 2026)
- Agent Skills open standard at agentskills.io for cross-tool skill portability
- Plugin marketplace system
- Agent teams (multi-agent parallel work)

## Edge Cases
- Rules `paths` frontmatter only triggers on Read, not Write/Edit
- User-level rules ignore `paths` frontmatter entirely
- YAML glob patterns starting with `{` or `*` require quoting
- MCP "local scope" stores in `~/.claude.json` (confusingly, not in project directory)
- `disableAllHooks` in user/project settings cannot disable managed hooks
- Plugin subagents cannot use hooks, mcpServers, or permissionMode
- `autoMode` not read from shared project settings
- SSE transport deprecated — use HTTP (Streamable HTTP)
- `.claude/commands/` deprecated in favor of `.claude/skills/`

## Promptpit Gaps
- **MCP duplication**: Claude Code reads `.mcp.json` natively — if Standards adapter writes to `.mcp.json` AND Claude Code adapter writes to `.claude/settings.json`, MCP servers appear twice. Need deduplication strategy.
- **SSE deprecation**: Claude Code deprecated SSE transport. Adapter's `mcpRemote: false` may need updating since HTTP transport is now supported.
- **New agent frontmatter fields**: Many new fields not in our schema — disallowedTools, permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, effort, isolation, color, initialPrompt. These pass through via Zod passthrough but aren't explicitly typed.
- **New skill frontmatter fields**: argument-hint, disable-model-invocation, effort, context (fork), agent, hooks, paths, shell — not all in our schema.
- **Settings scopes**: Adapter only handles project `.claude/settings.json` for MCP, doesn't handle `.claude/settings.local.json` or managed settings.
- **CLAUDE.md import syntax**: `@path/to/file` imports not handled during collect — collected instructions may be incomplete.
