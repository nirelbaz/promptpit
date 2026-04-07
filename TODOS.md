# TODOS

## Strategic Context

**Core thesis:** PromptPit is the composition layer for AI agent config. Translation is the entry point, stack management keeps things in sync, composition lets teams build on each other's work.

**Phased roadmap:** Team Platform (v0.3) -> Stack Composer (v0.5) -> Ecosystem Bridge (v1.0)

**Landscape (April 2026):** AGENTS.md adopted by 60K+ repos (Linux Foundation). Vercel Agent Skills / skills.sh is the emerging skill package manager (45+ agents, Cloudflare `.well-known` RFC for discovery). .mcp.json converging as project-level MCP standard. Agent Skills spec is complementary, not competing. It defines the individual skill format, PromptPit adds composition (bundling instructions + skills + MCP + env as one distributable unit). PromptPit already parses Agent Skills frontmatter.

**Adapter tiers:** Tier 1 (creator-maintained): Claude Code, Cursor (shipped), Codex, Copilot. Tier 2 (community-contributed): Windsurf, Gemini.

## Research (completed)

### ~~Investigate SkillKit~~
Reviewed SkillKit (rohitg00/skillkit). Different approach: 17 adapters with code, 4 real format translators. PromptPit focuses on composition (bundling + drift detection + security) rather than breadth of format support.

### ~~Read Agent Skills spec~~
Agent Skills spec (agentskills.io) = directory with SKILL.md (YAML frontmatter: name, description, license, compatibility, metadata, allowed-tools) + optional scripts/, references/, assets/. Vercel's `npx skills add` installs by symlinking into agent-native paths (45+ agents). Cloudflare `.well-known/agent-skills/index.json` RFC for web discovery with SHA-256 digest. **The formats are complementary**: Agent Skills defines individual skills, PromptPit is the composition layer it lacks (no concept of bundling skills + MCP + env + instructions). PromptPit already parses Agent Skills frontmatter in `schema.ts`. Position `.promptpit/` as "Agent Skills + composition" rather than a separate format.

## ~~Phase 1 — Team Platform (v0.2.x -> v0.3)~~ ✅

Goal: give teams a reason to adopt PromptPit. "New dev joins, runs one command, every AI tool is configured." **Completed v0.3.0 (2026-04-01).** Five Tier 1 adapters, seven commands, drift detection, dry-run previews, CI integration.

### ~~Unify standards adapters~~
Merged agents-md + mcp-standard into a single `standards` adapter that owns AGENTS.md, .mcp.json, and .agents/skills/.

### ~~Codex CLI adapter (Tier 1)~~
**Completed:** v0.2.5 (2026-04-01). Instructions to AGENTS.md, skills symlinked to `.codex/skills/`, MCP merged into `.codex/config.toml` via `smol-toml`. Detection: AGENTS.md, `.codex/` directory, or `.codex/config.toml`. Validated against Codex CLI docs via context7. 29 new tests (12 TOML utils + 17 adapter).

### ~~Copilot adapter (Tier 1)~~
**Completed:** v0.2.3 (2026-04-01). Instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` (applyTo glob frontmatter), MCP to `.vscode/mcp.json` (root key `servers`, type field per entry). Detection via `.github/copilot-instructions.md`, `.github/instructions/`, or `.vscode/mcp.json`. Agents deferred to Phase 2 (not yet in StackBundle schema).

### ~~`pit check`~~
**Completed:** v0.2.6 (2026-04-01). Two-phase CI check: freshness (stack.json vs installed.json) and drift (installed.json vs disk). Supports `--json`. GitHub Actions example deferred to README update.

### ~~Dry-run output~~
**Completed:** v0.2.8 (2026-04-01). `--dry-run` on both collect and install now shows file-by-file preview (create/modify per adapter, with details). `-v`/`--verbose` adds unified diffs for modified files.

## Phase 2 — Stack Composer (v0.3 -> v0.5)

Goal: let teams layer stacks on top of each other. Company base stack + team overrides + personal preferences, all composable.

### Stack composition (`extends`)
`"extends": ["github:company/base-stack@1.0.0"]` in stack.json. `pit install` recursively fetches and resolves the dependency graph. Base instructions merge first, team overrides layer on top. Provisional merge semantics: last-declared-wins with a warning on conflicts, explicit `overrides` block in stack.json for intentional resolution. The skeleton (schema change + recursive `cloneAndResolve` + `mergeStacks()`) is a weekend build; correct conflict resolution semantics should be validated against real team usage from Phase 1 before hardcoding. This is the feature that makes multi-team setups practical.

### Diff command
`pit diff` — show what changed between installed config and `.promptpit/` source. "Has someone updated the team stack since I last installed?" Natural byproduct of the merge/composition logic. Pairs with `pit status` (what's installed) and `pit update` (apply changes).

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. The marker system already tracks what was installed. Needs version comparison and conflict resolution for user-modified content.

### Embrace AGENTS.md as primary format
Currently PromptPit generates AGENTS.md during install. With 60K+ repos adopting it as THE cross-tool standard, PromptPit should also read AGENTS.md as a primary input — treat it as the canonical instructions format alongside tool-specific ones. Start with read-only parsing (behind feature flag until the spec stabilizes), then graduate to full read/write.

### Formalize Agent Skills alignment
PromptPit already parses Agent Skills frontmatter (`skillFrontmatterSchema` in `schema.ts`). Formalize this: ensure full spec compliance (name validation: 1-64 chars, lowercase alphanumeric + hyphens; description: 1-1024 chars), support optional `scripts/`, `references/`, `assets/` directories in skills, and document that `.promptpit/` is "Agent Skills + composition." This ensures PromptPit stacks are valid Agent Skills packages, not a parallel format.

### ~~Add `rules/` to bundle schema~~
**Completed:** v0.3.5 (2026-04-02). Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter (`name`, `description`, `globs`, `alwaysApply`). Translated per-adapter: Claude Code (`.claude/rules/*.md`, globs→paths), Cursor (`.cursor/rules/rule-*.mdc`), Copilot (`.github/instructions/rule-*.instructions.md`, globs→applyTo). Cursor/Copilot use `rule-` prefix to avoid collision with skills in shared directories. Windsurf translation deferred to Tier 2 adapter. 35 new tests.

### ~~Add `agents/` to bundle schema~~
**Completed:** v0.3.6 (2026-04-02). Portable custom agents in `.promptpit/agents/*.md` with YAML frontmatter (`name`, `description`, `tools`, `model`). Native write to Claude Code (`.claude/agents/*.md`) and Copilot (`.github/agents/*.agent.md`), inline for Codex/Cursor/Standards. Copilot translation strips `model` field. `pit collect` reads agents from Claude Code and Copilot. `pit validate`, `pit status`, and `pit check` all handle agents. `pit init` scaffolds `agents/` directory.

### Known bugs from real-world validation (QA rounds 1-3)

**BUG 22:** `writeMcpToToml()` only writes `command`/`args`/`env` — drops `url`/`serverUrl` for HTTP MCP servers on Codex install. Data loss for url-only servers like exa.

**BUG 23:** Codex `config.toml` install strips comments and reformats, causing immediate drift in `pit status`. Either preserve non-managed sections or hash only managed fields.

**BUG 24:** Install into a repo that already has rules creates `rule-` prefixed duplicates alongside originals. Consider skipping `rule-{name}` when `{name}` already exists in the target directory.

**BUG 25:** `readSkillsFromDir()` only globs `*/SKILL.md`, missing standalone `.md` skill files (e.g. positron's `review-upstream-merge.md`).

**BUG 26:** Validator CC-AG-009/CC-AG-003 false positives on Copilot/Codex-native tool and model names. Validator should be platform-aware or skip tool/model validation for non-Claude-origin agents.

### ~~Collect commands directories~~
**Completed:** v0.3.10 (2026-04-07). Portable commands in `.promptpit/commands/**/*.md` with nested directory support. Collected from Claude Code (`.claude/commands/`), Cursor (`.cursor/commands/`), and Copilot (`.github/prompts/*.prompt.md`). Copilot frontmatter translated (description preserved, model/tools/agent stripped). Install-time warnings when source param syntax ($ARGUMENTS, $1, ${input:x}) doesn't match target adapter. Full drift detection in `pit status`, freshness checking in `pit check`, validation in `pit validate`, and scaffolding in `pit init`. ~38 new tests.

### Command param syntax translation
Translate `$ARGUMENTS` (Claude Code) ↔ `$1` (Cursor) ↔ `${input:arguments}` (Copilot) during install. Currently commands are copied verbatim with warnings when source syntax doesn't match the target adapter. Single-param translation is clean, but multi-param ($1/$2/$3 → $ARGUMENTS) is lossy. Regex approach has false positive risks ($1 matching inside $10). Deferred until user demand validates the need. Consider AST-level placeholder detection instead of regex.

### Claude Code settings.json permissions/hooks
spotlight has a rich `.claude/settings.json` with `permissions`, `hooks`, and `enabledMcpServers`. Only `mcpServers` is collected. Consider porting these as optional bundle sections.

### Large instruction file warning
KurrentDB has a 25.1KB CLAUDE.md. No warning about unusually large instruction files that may cause issues for some AI tools. Add a size threshold warning during collect/validate.

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

Goal: install from anywhere, publish to anywhere. Connect the ecosystem.

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

### ~~MCP schema and drift detection fixes~~
**Completed:** v0.2.9 (2026-04-01). `mcpServerSchema` now supports HTTP remote servers (url/serverUrl). Drift detection uses canonical hashing (`computeMcpServerHash`) that ignores adapter-added fields. Each adapter declares `mcpFormat`/`mcpRootKey` in capabilities for native MCP reading in status. Empty MCP configs rejected via Zod refine. 19 new tests.

### ~~Dry-run output~~
**Completed:** v0.2.8 (2026-04-01). `--dry-run` on both collect and install now shows file-by-file preview (create/modify per adapter, with details). `-v`/`--verbose` adds unified diffs for modified files.

### ~~`pit check`~~
**Completed:** v0.2.6 (2026-04-01). Two-phase CI check: freshness (stack.json vs installed.json) and drift (installed.json vs disk). Supports `--json`. GitHub Actions example deferred to README update.

### ~~Codex CLI adapter (Tier 1)~~
**Completed:** v0.2.5 (2026-04-01). Instructions to AGENTS.md, skills symlinked to `.codex/skills/`, MCP merged into `.codex/config.toml` via `smol-toml`. Detection: AGENTS.md, `.codex/` directory, or `.codex/config.toml`. Validated against Codex CLI docs via context7. 29 new tests (12 TOML utils + 17 adapter).

### ~~Copilot adapter (Tier 1)~~
**Completed:** v0.2.3 (2026-04-01). Instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` (applyTo glob frontmatter), MCP to `.vscode/mcp.json` (root key `servers`, type field per entry). Detection via `.github/copilot-instructions.md`, `.github/instructions/`, or `.vscode/mcp.json`. Agents deferred to Phase 2 (not yet in StackBundle schema).

### ~~Unify standards adapters~~
Merged agents-md + mcp-standard into a single `standards` adapter that owns AGENTS.md, .mcp.json, and .agents/skills/.

### ~~Validate command~~
**Completed:** v0.2.7 (2026-04-01). `pit validate` checks stack.json, agent.promptpit.md, skills, mcp.json, and .env.example. Reports all errors at once. `--json` for CI. Optional agnix integration auto-detects the binary for 385+ adapter-specific lint rules.

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

### ~~Init command~~
**Completed:** v0.2.4 (2026-04-01). `pit init` scaffolds a `.promptpit/` stack from scratch with interactive prompts for name, version, description, author, and optional files (agent instructions, MCP config, .env.example). Validates against stack schema, sanitizes dirname defaults, uses `js-yaml` for frontmatter generation.

### ~~Verbose status flag~~
**Completed:** v0.2.2 (2026-04-01). `pit status --verbose` / `-v` shows per-adapter detail: skill names, MCP server names, instruction paths, and individual hash status for each artifact.
