# TODOS

## Strategic Context

**Core thesis:** PromptPit is the composition layer for AI agent config. Translation is the entry point, stack management is the product, composition is the moat.

**Phased roadmap:** Team Platform (v0.3) -> Stack Composer (v0.5) -> Ecosystem Bridge (v1.0)

**Landscape (April 2026):** AGENTS.md adopted by 60K+ repos (Linux Foundation). Vercel Agent Skills / skills.sh is the emerging skill package manager (45+ agents, Cloudflare `.well-known` RFC for discovery). SkillKit (rohitg00/skillkit) claims 44 agents but only has 4 real format translators (breadth-without-depth, 104K lines from 1 contributor in 2 months). .mcp.json converging as project-level MCP standard. Translation alone is being commoditized. PromptPit's differentiator is composition: bundling instructions + skills + MCP + env as one distributable, composable unit. Agent Skills spec is complementary, not competing — it defines the individual skill format, PromptPit is the composition layer it lacks. PromptPit already parses Agent Skills frontmatter.

**Adapter tiers:** Tier 1 (creator-maintained): Claude Code, Cursor (shipped), Codex, Copilot. Tier 2 (community-contributed): Windsurf, Gemini.

## Research (completed)

### ~~Investigate SkillKit~~
SkillKit's "44 agents" = 17 adapters with code + 27 empty enum strings. Of the 17, 13 generate identical XML. Only 4 real format translators (SKILL.md, Cursor .mdc, Copilot markdown, Windsurf markdown). 104K lines, 1 contributor, single squashed commit. Breadth-without-depth. PromptPit's adapter quality (native config paths, idempotent markers, drift detection, security hardening) is a real differentiator, not table stakes.

### ~~Read Agent Skills spec~~
Agent Skills spec (agentskills.io) = directory with SKILL.md (YAML frontmatter: name, description, license, compatibility, metadata, allowed-tools) + optional scripts/, references/, assets/. Vercel's `npx skills add` installs by symlinking into agent-native paths (45+ agents). Cloudflare `.well-known/agent-skills/index.json` RFC for web discovery with SHA-256 digest. **The formats are complementary**: Agent Skills defines individual skills, PromptPit is the composition layer it lacks (no concept of bundling skills + MCP + env + instructions). PromptPit already parses Agent Skills frontmatter in `schema.ts`. Position `.promptpit/` as "Agent Skills + composition" rather than a separate format.

## Phase 1 — Team Platform (v0.2.x -> v0.3)

Goal: give teams a reason to adopt PromptPit. "New dev joins, runs one command, every AI tool is configured."

### Unify standards adapters
Refactor agents-md + mcp-standard adapters into a unified "standards" adapter that owns all cross-tool conventions (.mcp.json, AGENTS.md, .agents/skills/). Currently split across two adapters because the outside voice on the v0.2 eng review correctly noted that absorbing agents-md during a feature release is risky churn. Ship as a separate refactor PR after v0.2 lands. The adapter contract (detect/read/write) fits cross-tool standards well, but the refactor should be its own atomic change with no feature work mixed in.

### Codex CLI adapter (Tier 1)
Instructions to AGENTS.md (shared with AGENTS.md support), skills to `.codex/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP to `config.toml` (needs TOML writer, consider `@iarna/toml` or `smol-toml`). Detection: `~/.codex` directory exists. Also supports `.agents/skills/` as universal alias. Confirm paths against current Codex CLI docs before shipping.

### Copilot adapter (Tier 1)
Instructions to `.github/copilot-instructions.md`, rules to `.github/instructions/*.instructions.md` (`applyTo` glob frontmatter), MCP to `.vscode/mcp.json` (note: root key is `servers`, not `mcpServers`), agents to `.github/agents/*.agent.md` (native agent support with tools/mcp-servers grants), skills to `.github/skills/*/SKILL.md` (standard Agent Skills spec). Detection: `.github` directory exists. Copilot also reads AGENTS.md, CLAUDE.md, and GEMINI.md natively. Confirm paths against current Copilot docs before shipping.

### `pit check` (NEW)
CI integration command. Exits non-zero if: (a) required skills from stack.json are missing, (b) installed config has drifted from the stack's expected hashes (already tracked in installed.json), or (c) adapter-specific configs are out of sync. Simplest useful version: compare installed.json against what `pit install` would produce, exit 1 on any diff. Ship a GitHub Actions example in README.

### Dry-run output
`--dry-run` flags exist but output is half-baked. Collect only shows secret stripping, install skips writes but doesn't report what would change. Need proper preview output: list files that would be created/modified, show diffs for config merges, summarize skills/MCP that would be added.

### Init command
`pit init` — scaffold a `.promptpit/` from scratch with prompts. For new projects or people who want to build a stack from zero without collecting from an existing setup first.

### Validate command
`pit validate` — check if a stack.json is valid, skills parse correctly, MCP configs are well-formed. Useful before publishing, and as a CI check for teams maintaining shared stacks. Can integrate with agnix (385 validation rules across 12+ AI tools, npm package with JS API: `await agnix.lint(dir, { target })`). Make agnix an optional peer dependency — detect at runtime, offer validation if present, suggest installing if not. Filter diagnostics by installed adapters (CC-* for Claude, CUR-* for Cursor, etc.).

## Phase 2 — Stack Composer (v0.3 -> v0.5)

Goal: make PromptPit the composition layer. The moat. Once teams use `extends`, they're locked in by their dependency graph.

### Stack composition (`extends`)
`"extends": ["github:company/base-stack@1.0.0"]` in stack.json. `pit install` recursively fetches and resolves the dependency graph. Base instructions merge first, team overrides layer on top. Provisional merge semantics: last-declared-wins with a warning on conflicts, explicit `overrides` block in stack.json for intentional resolution. The skeleton (schema change + recursive `cloneAndResolve` + `mergeStacks()`) is a weekend build; correct conflict resolution semantics should be validated against real team usage from Phase 1 before hardcoding. This is the single most important feature for PromptPit's long-term positioning.

### Diff command
`pit diff` — show what changed between installed config and `.promptpit/` source. "Has someone updated the team stack since I last installed?" Natural byproduct of the merge/composition logic. Pairs with `pit status` (what's installed) and `pit update` (apply changes).

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. The marker system already tracks what was installed. Needs version comparison and conflict resolution for user-modified content.

### Embrace AGENTS.md as primary format
Currently PromptPit generates AGENTS.md during install. With 60K+ repos adopting it as THE cross-tool standard, PromptPit should also read AGENTS.md as a primary input — treat it as the canonical instructions format alongside tool-specific ones. Start with read-only parsing (behind feature flag until the spec stabilizes), then graduate to full read/write.

### Formalize Agent Skills alignment
PromptPit already parses Agent Skills frontmatter (`skillFrontmatterSchema` in `schema.ts`). Formalize this: ensure full spec compliance (name validation: 1-64 chars, lowercase alphanumeric + hyphens; description: 1-1024 chars), support optional `scripts/`, `references/`, `assets/` directories in skills, and document that `.promptpit/` is "Agent Skills + composition." This positions PromptPit as the composition layer on top of the Agent Skills ecosystem rather than a parallel format.

### Add `rules/` to bundle schema
Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter: `name`, `description`, `globs` (file patterns), `alwaysApply` (boolean). Translated per-adapter during install: `.claude/rules/*.md` (paths frontmatter), `.cursor/rules/*.mdc` (globs + alwaysApply + description), `.windsurf/rules/*.md` (trigger frontmatter), `.github/instructions/*.instructions.md` (applyTo globs). Tools without conditional rules get rules appended to their instructions file.

### Add `agents/` to bundle schema
Portable custom agent format in `.promptpit/agents/*.md` with YAML frontmatter: `name`, `description`, `tools` (array of allowed tools). Translated to `.github/agents/*.agent.md` (Copilot — native agent support with tool/MCP grants), `.gemini/agents/*.md` (Gemini — native with kind/model/max_turns). Tools without agent systems get agent definitions inlined into their instructions file as a section.

### Uninstall command
`pit uninstall <stack>` — clean reverse of install. Markers make CLAUDE.md/.cursorrules removal straightforward. Skills/MCP/env is messier (what if the user modified them after install?). Basic version: remove marked blocks + delete unmodified skill files.

### Selective install/collect
`pit install --select` / `pit collect --select` — interactive picker (checkboxes for skills, MCP servers, env vars). Power-user feature for teams where you want the coding conventions but not the MCP servers. Pairs well with `pit status`.

## Phase 2.5 — Tier 2 Adapters (community-contributed, v0.3+)

These adapters are lower priority for the solo maintainer. Design the adapter interface to make community contribution easy, then invite contributions.

### Windsurf adapter (Tier 2)
Instructions to `.windsurfrules` (legacy) or `.windsurf/rules/*.md` (modern, `trigger` frontmatter: always_on/manual/model_decision/glob). MCP to global only at `~/.codeium/windsurf/mcp_config.json` — warn user that project-level MCP is not supported. Skills to `.windsurf/rules/` (strip SKILL.md frontmatter, add trigger frontmatter). Detection: `~/.codeium/windsurf` exists. Also reads AGENTS.md natively.

### Gemini CLI adapter (Tier 2)
Instructions to `GEMINI.md` (supports `@path/to/file.md` import syntax), skills to `.gemini/skills/` (native SKILL.md, symlinked from `.agents/skills/`), MCP to `.gemini/settings.json` (merge into `mcpServers` key), agents to `.gemini/agents/*.md` (native agent support with name/kind/tools/model/max_turns). Detection: `~/.gemini` exists. Gemini can be configured to also read AGENTS.md and CLAUDE.md via `context.fileName` setting.

## Phase 3 — Ecosystem Bridge (v0.5 -> v1.0)

Goal: network effects. Install from anywhere, publish to anywhere. PromptPit becomes the hub.

### Broader SKILL.md discovery
Expand GitHub source discovery pipeline to scan in priority order: (1) `.claude-plugin/marketplace.json` — read `plugins[].skills[]` paths, (2) standard locations `skills/*/SKILL.md`, `.github/skills/*/SKILL.md`, `.github/plugins/*/skills/*/SKILL.md`, (3) root-level scan of immediate subdirectories for `SKILL.md`, (4) existing detection `.claude/skills/`, `.cursor/rules/`. Stop at first strategy returning at least one valid SkillEntry.

### Subdirectory / path install
Support path specifiers: `pit install github:owner/repo/path/to/skill[@ref]`. New regex: `github:([^/]+)\/([^/@]+)(?:\/([^@]+))?(?:@(.+))?`. Path resolution after clone: directory with SKILL.md -> install that skill, directory without SKILL.md -> scan subtree, file (.mdc, .cursorrules) -> run through format reader, path not found -> error.

### Format reader system
Pluggable `FormatReader` interface: `id`, `extensions`, `canRead(path)`, `read(path): SkillEntry`. Ship readers for: `.mdc` (YAML frontmatter), `.cursorrules` (plain text wrapper), `.clinerules` (rich frontmatter), `.windsurfrules` (plain text), `CONVENTIONS.md` (markdown wrapper), `.agent.md` (map tools/model to metadata), `.instructions.md` (map applyTo to globs), `aiprompt.json` (parse JSON manifest).

### Smart catalog prompting
When repo has >20 skills, prompt: install all / pick / cancel. `--all` flag skips prompt. Non-TTY without `--all` exits with error for repos above threshold. If `marketplace.json` provides plugin groupings, offer bundles.

### `pit search` via registry APIs
Query discovery sources from the CLI: skills.sh API, SkillsMP API, MCP Registry. Initially GitHub-only search, registry sources added as they're integrated. Filter by `--type skill|mcp` or `--source`. Display results with install counts and source links.

### Bundle / plugin install
`pit install github:anthropics/skills --plugin document-skills` installs a group of skills using marketplace.json plugin definitions. Support additional manifest formats: `data/skills_index.json`, `data/editorial-bundles.json`, `.gemini/skills-index.json`, `data/index.json`.

### Publish to registry
`pit publish` — push a stack to a registry target (initially GitHub releases). Consider publishing in Agent Skills spec format so stacks are discoverable by skills.sh users. Consider agentskills.io-compatible format for maximum cross-tool reach.

### Well-known protocol for distribution
Serve stacks via `/.well-known/agent-skills/index.json` (skills.sh RFC 8615 convention). Any website can host skills this way. Makes PromptPit stacks discoverable by `npx skills add` users.

### cursor.directory plugin API integration
Consume cursor.directory's `/api/plugins/{slug}` for composite bundles (rules + MCP servers + skills + agents). They have the richest plugin format but only install to Cursor. PromptPit would be the universal installer: fetch a cursor.directory plugin, translate it, install to all detected tools. Plugin API is the only viable integration path (DB-backed, not git-scrapable).

### Write marketplace.json during collect
Generate `.claude-plugin/marketplace.json` during `pit collect`, making pit-bundled stacks also installable via Claude Code's native `/plugin marketplace add` command.

### TUI picker for catalog repos
Upgrade simple list prompt to interactive TUI with search, filtering by tags/category, and plugin/bundle grouping. Depends on format readers and bundle install being complete.

### README community catalog
Curated list of tested repos in the README. Per entry: repo name + link + stars, skill count + format, `pit install` command, status. Organized by tier: SKILL.md repos, rule collections, reference.

## v1.0+

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

### ~~Verbose status flag~~
**Completed:** v0.2.2 (2026-04-01). `pit status --verbose` / `-v` shows per-adapter detail: skill names, MCP server names, instruction paths, and individual hash status for each artifact.
