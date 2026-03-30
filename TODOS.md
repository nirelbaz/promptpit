# TODOS

## v0.2

### AGENTS.md support
Add AGENTS.md read/write to collect and install. AGENTS.md is a cross-tool standard (20+ tools: Codex, Copilot, Cursor, Windsurf, Zed, Cline, Roo Code, Amp, Devin, Aider, etc.) — the single highest-reach output PromptPit can generate. During collect, read existing AGENTS.md as an instruction source. During install, generate AGENTS.md from stack instructions (not just copy — generate as a translated output like we do for .cursorrules). Use idempotent markers so multiple stacks coexist. Decision needed: merge with agent.promptpit.md or keep separate.

### Hybrid symlinks for skill installation
Write skills to `.agents/skills/<name>/` as canonical location, then symlink to tools that read native SKILL.md (Claude Code, Codex, Gemini, Goose, Kiro). Copy with format translation to tools that need a different format (Cursor → .mdc, Windsurf → .md rules, Copilot → .instructions.md, Cline/Roo → plain .md). Windows fallback to copies if symlink creation fails. Matches the skills.sh convention (43 agents, 12K stars) and agent-skill-creator pattern.

### Read `.mcp.json` during collect
`.mcp.json` at project root is the emerging project-level MCP standard (Claude Code popularized it, teams check it into git). Currently we only read MCP from adapter-specific paths (`.claude/settings.json`, `.cursor/mcp.json`). Should read `.mcp.json` directly as a first-class input during collect, and write it as an output during install alongside adapter-specific configs.

### Status command
`pit status` — show what's installed, what's in `.promptpit/`, what's drifted since install. The "git status" for AI agent stacks. Answers the first question teams will ask: "what's even installed right now?"

### Recursive duplication on collect + install
When `pit collect` reads CLAUDE.md, it captures everything including content previously installed by `pit install` (marked blocks). This causes two problems:

1. **Installed stacks get re-collected** — marked blocks from other stacks get baked into the bundle as plain text, causing recursive nesting on re-install.
2. **Project content duplicates on re-install** — the project's native CLAUDE.md content gets collected into the bundle. When the bundle is installed back (e.g. team re-sync from shared `.promptpit/`), that content appears twice: once as the file's native content, once inside markers.

**Core challenge:** The file has no concept of "what's project-native vs what was installed" beyond the marker blocks. Stripping markers on collect fixes problem 1 but not problem 2. Need a design that cleanly separates project content from stack content in both collect and install flows.

**Current mitigation:** The agents-md adapter uses fallback-only read during collect — AGENTS.md is only read when no other adapters (claude-code, cursor) are detected. This prevents the most common duplication case (CLAUDE.md + AGENTS.md with similar content) but doesn't solve the general problem. A full deduplication solution (content hashing, similarity detection across adapter outputs) is still needed.

## v0.2.x

### Codex CLI adapter
Instructions → `AGENTS.md` (shared with AGENTS.md support), skills → `.codex/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP → `config.toml` (needs TOML writer — consider `@iarna/toml` or `smol-toml`). Detection: `~/.codex` directory exists. Also supports `.agents/skills/` as universal alias.

### Copilot adapter
Instructions → `.github/copilot-instructions.md`, rules → `.github/instructions/*.instructions.md` (`applyTo` glob frontmatter), MCP → `.vscode/mcp.json` (note: root key is `servers`, not `mcpServers`), agents → `.github/agents/*.agent.md` (native agent support with tools/mcp-servers grants). Detection: `.github` directory exists. Copilot also reads AGENTS.md, CLAUDE.md, and GEMINI.md natively.

### Windsurf adapter
Instructions → `.windsurfrules` (legacy) or `.windsurf/rules/*.md` (modern, `trigger` frontmatter: always_on/manual/model_decision/glob). MCP → global only at `~/.codeium/windsurf/mcp_config.json` — warn user that project-level MCP is not supported. Skills → convert to `.windsurf/rules/` (strip SKILL.md frontmatter, add trigger frontmatter). Detection: `~/.codeium/windsurf` exists. Also reads AGENTS.md natively.

### Gemini CLI adapter
Instructions → `GEMINI.md` (supports `@path/to/file.md` import syntax), skills → `.gemini/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP → `.gemini/settings.json` (merge into `mcpServers` key), agents → `.gemini/agents/*.md` (native agent support with name/kind/tools/model/max_turns). Detection: `~/.gemini` exists. Gemini can be configured to also read AGENTS.md and CLAUDE.md via `context.fileName` setting.

### Add `rules/` to bundle schema
Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter: `name`, `description`, `globs` (file patterns), `alwaysApply` (boolean). Translated per-adapter during install: `.claude/rules/*.md` (paths frontmatter), `.cursor/rules/*.mdc` (globs + alwaysApply + description), `.windsurf/rules/*.md` (trigger frontmatter), `.github/instructions/*.instructions.md` (applyTo globs). Tools without conditional rules get rules appended to their instructions file.

### Add `agents/` to bundle schema
Portable custom agent format in `.promptpit/agents/*.md` with YAML frontmatter: `name`, `description`, `tools` (array of allowed tools). Translated to `.github/agents/*.agent.md` (Copilot — native agent support with tool/MCP grants), `.gemini/agents/*.md` (Gemini — native with kind/model/max_turns). Tools without agent systems get agent definitions inlined into their instructions file as a section.

### Init command
`pit init` — scaffold a `.promptpit/` from scratch with prompts. For new projects or people who want to build a stack from zero without collecting from an existing setup first.

### Dry-run output
`--dry-run` flags exist but output is half-baked. Collect only shows secret stripping, install skips writes but doesn't report what would change. Need proper preview output: list files that would be created/modified, show diffs for config merges, summarize skills/MCP that would be added.

### Validate command
`pit validate` — check if a stack.json is valid, skills parse correctly, MCP configs are well-formed. Useful before publishing, and as a CI check for teams maintaining shared stacks. Can integrate with agnix (385 validation rules across 12+ AI tools, npm package with JS API: `await agnix.lint(dir, { target })`). Make agnix an optional peer dependency — detect at runtime, offer validation if present, suggest installing if not. Filter diagnostics by installed adapters (CC-* for Claude, CUR-* for Cursor, etc.).

## v0.3

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. The marker system already tracks what was installed. Needs version comparison and conflict resolution for user-modified content.

### Uninstall command
`pit uninstall <stack>` — clean reverse of install. Markers make CLAUDE.md/.cursorrules removal straightforward. Skills/MCP/env is messier (what if the user modified them after install?). Basic version: remove marked blocks + delete unmodified skill files.

### Selective install/collect
`pit install --select` / `pit collect --select` — interactive picker (checkboxes for skills, MCP servers, env vars). Power-user feature for teams where you want the coding conventions but not the MCP servers. Pairs well with `pit status`.

### Diff command
`pit diff` — show what changed between installed config and `.promptpit/` source. "Has someone updated the team stack since I last installed?" Pairs with `pit status` (what's installed) and `pit update` (apply changes).

### `pit search` via registry APIs
Query three discovery sources from the CLI: skills.sh API (`GET skills.sh/api/search?q=...`), SkillsMP API (`GET skillsmp.com/api/v1/skills/search?q=...`, Bearer token auth, 500 req/day free), MCP Registry (`GET registry.modelcontextprotocol.io/v0/servers?q=...`, no auth needed). Filter by `--type skill|mcp` or `--source skillsmp|skills.sh|mcp-registry`. Display results with install counts and source links.

### Import from Cursor rules ecosystem
`pit import --from-mdc .cursor/rules/` converts local .mdc rules to portable format. `pit import awesome-cursorrules/react` fetches from the awesome-cursorrules repo (38K+ stars, 172 curated rules). Format mapping is nearly 1:1: .mdc `description`/`globs`/`alwaysApply` → portable rule frontmatter. The awesome-cursor-rules-mdc repo (sanjeed5, 243 rules with proper YAML frontmatter) is the easiest import source. Makes 38K devs' curated rules installable into Claude Code, Copilot, Windsurf, Codex, Gemini, etc.

### Stack composition
Stack A extends stack B. Company base stack + team-specific overrides. `"extends": "github:company/base-stack"` in stack.json. Everyone gets the security skills, frontend team adds React skills on top. Like Dockerfile `FROM` for AI stacks.

## v1.0

### Publish to registry
`pit publish` — push a stack to a central registry. Makes promptpit a real ecosystem with discoverability (`pit search`). Needs: hosting, auth, moderation, versioning. The network effects feature. Consider publishing in agentskills.io-compatible format so stacks are also installable via `npx skills add` and discoverable on SkillsMP.

### Well-known protocol for distribution
Serve stacks via `/.well-known/agent-skills/index.json` (skills.sh RFC 8615 convention). Any website can host skills this way. Makes PromptPit stacks discoverable by `npx skills add` users and any tool that supports the well-known protocol. Low effort — just a JSON index pointing to skill directories.

### cursor.directory plugin API integration
Consume cursor.directory's `/api/plugins/{slug}` for composite bundles (rules + MCP servers + skills + agents). They have the richest plugin format in the ecosystem but only install to Cursor. PromptPit would be the universal installer: fetch a cursor.directory plugin, translate it, install to all detected tools.

### Clean/reset command
`pit clean` — remove all AI agent config from a project (not just one stack). Broader than uninstall. Useful for starting fresh or switching stacks entirely.

## Done

### ~~Resolve auto-collect default behavior~~
Auto-collect runs by default when GitHub repo has no .promptpit/. MCP trust prompt handles consent.

### ~~Measure npx cold-start time~~
Measured: 0.36s. No action needed.
