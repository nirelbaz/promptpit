# TODOS

## v0.2

### Verbose status flag
`pit status --verbose` (or `-v`) shows detailed info per adapter: skill names, MCP server names, instruction file paths, and individual hash status for each artifact. The default output stays compact (counts only), verbose expands to full inventory. Useful for debugging drift and verifying exactly what's installed.

## v0.2.x

### Unify standards adapters
Refactor agents-md + mcp-standard adapters into a unified "standards" adapter that owns all cross-tool conventions (.mcp.json, AGENTS.md, .agents/skills/). Currently split across two adapters because the outside voice on the v0.2 eng review correctly noted that absorbing agents-md during a feature release is risky churn. Ship as a separate refactor PR after v0.2 lands. The adapter contract (detect/read/write) fits cross-tool standards well, but the refactor should be its own atomic change with no feature work mixed in.

### Codex CLI adapter
Instructions → `AGENTS.md` (shared with AGENTS.md support), skills → `.codex/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP → `config.toml` (needs TOML writer — consider `@iarna/toml` or `smol-toml`). Detection: `~/.codex` directory exists. Also supports `.agents/skills/` as universal alias. Confirmed by ecosystem research: microsoft/skills uses `.codex/skills/` symlinks, antigravity generates `.codex/skills/` directories.

### Copilot adapter
Instructions → `.github/copilot-instructions.md`, rules → `.github/instructions/*.instructions.md` (`applyTo` glob frontmatter), MCP → `.vscode/mcp.json` (note: root key is `servers`, not `mcpServers`), agents → `.github/agents/*.agent.md` (native agent support with tools/mcp-servers grants), skills → `.github/skills/*/SKILL.md` (standard Agent Skills spec). Detection: `.github` directory exists. Copilot also reads AGENTS.md, CLAUDE.md, and GEMINI.md natively. Confirmed by ecosystem research: microsoft/skills uses `.github/skills/` for core skills, `.github/plugins/*/skills/` for bundles, and `marketplace.json` for registry. github/awesome-copilot (27.8K stars) has 257 skills, 230+ agents, 100+ instructions — all with YAML frontmatter. Also supports `.schemas/collection.schema.json` for bundle definitions.

### Windsurf adapter
Instructions → `.windsurfrules` (legacy) or `.windsurf/rules/*.md` (modern, `trigger` frontmatter: always_on/manual/model_decision/glob). MCP → global only at `~/.codeium/windsurf/mcp_config.json` — warn user that project-level MCP is not supported. Skills → convert to `.windsurf/rules/` (strip SKILL.md frontmatter, add trigger frontmatter). Detection: `~/.codeium/windsurf` exists. Also reads AGENTS.md natively. Confirmed by ecosystem research: ruler writes to `.windsurf/skills/`, ai-rulez generates `.windsurf/*.md`, skillkit writes to `.windsurf/skills/`.

### Gemini CLI adapter
Instructions → `GEMINI.md` (supports `@path/to/file.md` import syntax), skills → `.gemini/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP → `.gemini/settings.json` (merge into `mcpServers` key), agents → `.gemini/agents/*.md` (native agent support with name/kind/tools/model/max_turns). Detection: `~/.gemini` exists. Gemini can be configured to also read AGENTS.md and CLAUDE.md via `context.fileName` setting. Confirmed by ecosystem research: alirezarezvani/claude-skills provides `.gemini/skills-index.json` (270 entries), antigravity generates `.gemini/skills/` directories.

### Add `rules/` to bundle schema
Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter: `name`, `description`, `globs` (file patterns), `alwaysApply` (boolean). Translated per-adapter during install: `.claude/rules/*.md` (paths frontmatter), `.cursor/rules/*.mdc` (globs + alwaysApply + description), `.windsurf/rules/*.md` (trigger frontmatter), `.github/instructions/*.instructions.md` (applyTo globs). Tools without conditional rules get rules appended to their instructions file.

### Add `agents/` to bundle schema
Portable custom agent format in `.promptpit/agents/*.md` with YAML frontmatter: `name`, `description`, `tools` (array of allowed tools). Translated to `.github/agents/*.agent.md` (Copilot — native agent support with tool/MCP grants), `.gemini/agents/*.md` (Gemini — native with kind/model/max_turns). Tools without agent systems get agent definitions inlined into their instructions file as a section. Confirmed by ecosystem research: `.agent.md` format (description, name, tools, model frontmatter) used by github/awesome-copilot (230+ agents) and microsoft/skills (6 agent personas). `.instructions.md` format (description, applyTo glob) used by github/awesome-copilot (100+ instructions).

### Init command
`pit init` — scaffold a `.promptpit/` from scratch with prompts. For new projects or people who want to build a stack from zero without collecting from an existing setup first.

### Dry-run output
`--dry-run` flags exist but output is half-baked. Collect only shows secret stripping, install skips writes but doesn't report what would change. Need proper preview output: list files that would be created/modified, show diffs for config merges, summarize skills/MCP that would be added.

### Validate command
`pit validate` — check if a stack.json is valid, skills parse correctly, MCP configs are well-formed. Useful before publishing, and as a CI check for teams maintaining shared stacks. Can integrate with agnix (385 validation rules across 12+ AI tools, npm package with JS API: `await agnix.lint(dir, { target })`). Make agnix an optional peer dependency — detect at runtime, offer validation if present, suggest installing if not. Filter diagnostics by installed adapters (CC-* for Claude, CUR-* for Cursor, etc.).

## v0.2.5 — Ecosystem Release

Design doc: `~/.gstack/projects/pit-cli/nirelbaz-nirelbaz-add-a-list-of-repos-to-readme-design-20260331-office-hours.md`
Research: `docs/research/ecosystem-landscape.md`

### Broader SKILL.md discovery
Currently auto-collect only looks in `.claude/skills/*/SKILL.md` and `.cursor/rules/*.mdc`. Expand the GitHub source discovery pipeline to scan in priority order: (1) `.claude-plugin/marketplace.json` — read `plugins[].skills[]` paths to resolve skill directories, (2) standard locations `skills/*/SKILL.md`, `.github/skills/*/SKILL.md`, `.github/plugins/*/skills/*/SKILL.md`, (3) root-level scan of immediate subdirectories for `SKILL.md` (handles gstack layout), (4) existing detection `.claude/skills/`, `.cursor/rules/`. Stop at first strategy returning at least one valid SkillEntry. This strategy pipeline replaces `collectStack()` for GitHub sources; `bundleFromSkills()` constructs the StackBundle instead. The `.promptpit/` check remains first (before the pipeline), preserving backward compat.

### Subdirectory / path install
Support path specifiers: `pit install github:owner/repo/path/to/skill[@ref]`. New regex: `github:([^/]+)\/([^/@]+)(?:\/([^@]+))?(?:@(.+))?`. Path resolution after clone: directory with SKILL.md → install that skill, directory without SKILL.md → scan subtree, file (.mdc, .cursorrules) → run through format reader, path not found → error. SAFE_NAME validates owner and repo only; path skips it (contains `/`). Ref validation unchanged. Breaking change to `parseGitHubSource()` — update `GitHubSource` type and existing tests.

### Format reader system
Pluggable `FormatReader` interface: `id`, `extensions`, `canRead(path)`, `read(path): SkillEntry`. Ship two readers with v0.2.5:
- `.mdc` reader: Parse YAML frontmatter (`description`, `globs`), map to SKILL.md frontmatter (`name` from filename stem, `description` from frontmatter, `context` from globs).
- `.cursorrules` reader: Wrap plain text as skill content, `name` = slugified parent dir name, `description` = `"Cursor rules imported from {owner}/{repo}/{dirName}"`.

Default metadata rule for frontmatter-less formats: readers MUST produce valid `SkillFrontmatter` with `name` (slugified from directory/filename) and `description` (from first heading, first paragraph, or fallback `"Imported from {owner}/{repo}"`).

### Smart catalog prompting
When repo has >20 skills, prompt: install all / pick / cancel. `--all` flag skips prompt. Non-TTY without `--all` exits with error for repos above threshold. If `marketplace.json` provides plugin groupings, offer bundles.

### `bundleFromSkills()` construction
New function to construct `StackBundle` from raw `SkillEntry[]` when no `.promptpit/` exists. Synthetic manifest: `name` = `"{owner}-{repo}"`, `version` = `"0.0.0"`, empty agent instructions, empty MCP/env. Slots into `cloneAndResolve()` as alternative to `collectStack()`.

### README community catalog
Curated list of tested repos in the README. Per entry: repo name + link + stars, skill count + format, `pit install` command, status (works now / v0.2.5 / planned). Organized by tier: SKILL.md repos (anthropics, microsoft, gstack, antigravity), rule collections (awesome-cursorrules, cline/prompts), reference (awesome lists, competing tools).

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

### ~~Import from Cursor rules ecosystem~~ → Absorbed into v0.2.5 format readers
The `.mdc` and `.cursorrules` format readers in v0.2.5 handle this. `pit install github:PatrickJS/awesome-cursorrules/rules-new/react.mdc` replaces the planned `pit import awesome-cursorrules/react`.

### Additional format readers
Extend the format reader system from v0.2.5 with more readers: `.clinerules` (rich frontmatter: description, author, version, category, tags, globs — from cline/prompts), `.windsurfrules` (plain text wrapper), `CONVENTIONS.md` (plain markdown wrapper — from Aider-AI/conventions), `.agent.md` (map tools, model to skill metadata — from github/awesome-copilot), `.instructions.md` (map applyTo to context globs — from github/awesome-copilot), `aiprompt.json` (parse JSON manifest + referenced .md files — from instructa/ai-prompts).

### Bundle / plugin install
`pit install github:anthropics/skills --plugin document-skills` installs a group of skills using marketplace.json plugin definitions. Support additional manifest formats: `data/skills_index.json` (antigravity), `data/editorial-bundles.json` (antigravity starter packs), `.gemini/skills-index.json` (alirezarezvani), `data/index.json` (instructa/ai-prompts). Enable `--bundle` flag for named bundles.

### TUI picker for catalog repos
Upgrade the simple list prompt from v0.2.5 to a full interactive TUI with search, filtering by tags/category (when metadata available), and plugin/bundle grouping. Depends on format readers and bundle install being complete.

### Stack composition
Stack A extends stack B. Company base stack + team-specific overrides. `"extends": "github:company/base-stack"` in stack.json. Everyone gets the security skills, frontend team adds React skills on top. Like Dockerfile `FROM` for AI stacks.

## v1.0

### Publish to registry
`pit publish` — push a stack to a central registry. Makes promptpit a real ecosystem with discoverability (`pit search`). Needs: hosting, auth, moderation, versioning. The network effects feature. Consider publishing in agentskills.io-compatible format so stacks are also installable via `npx skills add` and discoverable on SkillsMP. Ecosystem research confirms the Agent Skills spec (agentskills.io) is the open standard adopted by 30+ tools. Publishing in this format maximizes cross-tool reach.

### Well-known protocol for distribution
Serve stacks via `/.well-known/agent-skills/index.json` (skills.sh RFC 8615 convention). Any website can host skills this way. Makes PromptPit stacks discoverable by `npx skills add` users and any tool that supports the well-known protocol. Low effort — just a JSON index pointing to skill directories. Ecosystem research confirms this is the emerging standard; Vercel Labs' `skills` CLI (`npx skills add`) already uses it.

### cursor.directory plugin API integration
Consume cursor.directory's `/api/plugins/{slug}` for composite bundles (rules + MCP servers + skills + agents). They have the richest plugin format in the ecosystem but only install to Cursor. PromptPit would be the universal installer: fetch a cursor.directory plugin, translate it, install to all detected tools. Ecosystem research confirms cursor.directory (pontusab/directories) is DB-backed (Supabase), not git-scrapable — only 3 sample rules in the repo. Plugin API is the only viable integration path.

### Write marketplace.json during collect
Generate `.claude-plugin/marketplace.json` during `pit collect`, making pit-bundled stacks also installable via Claude Code's native `/plugin marketplace add` command. Format: `{ name, plugins: [{ name, description, skills: ["./skills/name"] }] }`. This makes every pit stack automatically discoverable by Claude Code, Copilot CLI, and any tool that reads the marketplace.json convention. Research shows anthropics/skills, microsoft/skills, antigravity, alirezarezvani, and levnikolaevich all use this format.

### Clean/reset command
`pit clean` — remove all AI agent config from a project (not just one stack). Broader than uninstall. Useful for starting fresh or switching stacks entirely.

## Done

### ~~Resolve auto-collect default behavior~~
Auto-collect runs by default when GitHub repo has no .promptpit/. MCP trust prompt handles consent.

### ~~Measure npx cold-start time~~
Measured: 0.36s. No action needed.

### ~~AGENTS.md support~~
Added in v0.1.5. AGENTS.md adapter with fallback-only read during collect and always-write during install. Shared `writeWithMarkers` helper extracted for DRY.

### ~~Hybrid symlinks for skill installation~~
Added in v0.1.6. Skills written to `.agents/skills/` as canonical location, symlinked into Claude Code, copied+translated for Cursor. Windows fallback to copies. `skillLinkStrategy` capability replaces boolean `skills` flag.

### ~~Read `.mcp.json` during collect~~
**Completed:** v0.2.0 (2026-04-01). Added `mcp-standard` adapter that reads/writes `.mcp.json` as a first-class project-level MCP config alongside adapter-specific paths.

### ~~Status command~~
**Completed:** v0.2.0 (2026-04-01). `pit status` shows installed stacks, per-adapter sync state, and drift detection via SHA-256 content hashes. Supports `--json` and `--short` output modes.

### ~~Watch command~~
**Completed:** v0.2.0 (2026-04-01). `pit watch` monitors `.agents/skills/` and re-translates skill files for non-symlinked adapters (Cursor `.mdc`) when they change. 200ms debounce for batch changes.

### ~~Recursive duplication on collect + install~~
**Completed:** v0.2.0 (2026-04-01). `stripAllMarkerBlocks()` removes installed content during collect. Instruction hash dedup in the merger prevents identical content from multiple adapters being collected twice. Round-trip collect→install→collect now produces identical output.
