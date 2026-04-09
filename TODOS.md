# TODOS

## Strategic Context

**Core thesis:** PromptPit is the composition layer for AI agent config. Translation is the entry point, stack management keeps things in sync, composition lets teams build on each other's work.

**Phased roadmap:** ~~Team Platform (v0.3)~~ -> Stack Composer (v0.5) -> Ecosystem Bridge (v1.0)

**Landscape (April 2026):** AGENTS.md adopted as cross-tool convention (Linux Foundation, agreed by Google, OpenAI, Sourcegraph, Cursor, Factory — February 2026). Agent Skills spec (agentskills.io) defines the individual skill format; 30+ tools support it. skills.sh is the emerging skill package manager with Cloudflare `.well-known` RFC for discovery. `.mcp.json` supported by Claude Code and Copilot at the project level, but not yet a universal standard (Codex uses TOML, Cursor uses `.cursor/mcp.json`, others have their own paths).

**Adapter tiers:**
- Tier 1 (creator-maintained): Claude Code, Cursor, Codex, Copilot
- Tier 2 (community-contributed): Windsurf, Gemini, Junie, Continue.dev
- Evaluated and deferred: Zed (first-match-wins limits utility), Cline (MCP in extension globalStorage, no project-level path), Roo Code (no rules frontmatter), Amazon Q (non-standard MCP format), Aider (minimal config surface)

## Known Bugs

~~**BUG 22:** `writeMcpToToml()` only writes `command`/`args`/`env` — drops `url`/`serverUrl` for HTTP MCP servers on Codex install. Data loss for url-only servers like exa.~~ **Completed:** v0.3.11 (2026-04-08)

~~**BUG 23:** Codex `config.toml` install strips comments and reformats, causing immediate drift in `pit status`. Either preserve non-managed sections or hash only managed fields.~~ **Completed:** v0.3.12 (2026-04-09)

~~**BUG 24:** Install into a repo that already has rules creates `rule-` prefixed duplicates alongside originals. Consider skipping `rule-{name}` when `{name}` already exists in the target directory.~~ **Completed:** v0.3.11 (2026-04-08)

~~**BUG 25:** `readSkillsFromDir()` only globs `*/SKILL.md`, missing standalone `.md` skill files (e.g. positron's `review-upstream-merge.md`).~~ **Completed:** v0.3.11 (2026-04-08)

~~**BUG 26:** Validator CC-AG-009/CC-AG-003 false positives on Copilot/Codex-native tool and model names. Validator should be platform-aware or skip tool/model validation for non-Claude-origin agents.~~ **Completed:** v0.3.12 (2026-04-09)

~~**BUG 27:** `pit install --save` installs content AND saves to extends, then a subsequent `pit install` creates a second marker block.~~ **Completed:** `--save` now saves first, then resolves extends and installs once (one marker block).

~~**BUG 28:** Merged instructions include the repo's own collected CLAUDE.md, creating recursive content duplication.~~ **Completed:** `mergeGraph` gains `skipRootInstructions` option, used by `--save` to exclude root's instructions from the marker (they're already in the target file).

## Adapter Audit Findings

Discovered via `/audit-adapters` using the AI Stack Expert knowledge base. See `docs/knowledge/` for per-tool evidence.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | ~~HIGH~~ | ~~**MCP duplication:** Claude Code reads `.mcp.json` natively. Standards + Claude Code adapters both write MCP, causing servers to appear twice. Same for Copilot (`.mcp.json` + `.vscode/mcp.json`).~~ | **Completed** v0.3.12 — `nativelyReads` capability + dedup orchestrator with `--prefer-universal`/`--force-standards` flags |
| 2 | ~~HIGH~~ | ~~**AGENTS.md instruction duplication:** Standards always writes AGENTS.md. Copilot, Cursor, and Codex also read it natively. Both adapters active = instructions appear twice.~~ | **Completed** v0.3.12 — Standards adapter skips MCP/instructions when tool-specific adapter handles them; `installMode` recorded in manifest |
| 3 | ~~HIGH~~ | ~~**Cursor native SKILL.md:** Cursor v2.4+ supports `.cursor/skills/<name>/SKILL.md` natively. Adapter still translates to `.mdc` (lossy).~~ | **Completed** v0.3.12 — switched `skillLinkStrategy` to `"symlink"` targeting `.cursor/skills/`, dropped `skillToMdc()` translation |
| 4 | ~~MEDIUM~~ | ~~**Codex agent write format mismatch:** Codex reads agents from `.codex/agents/*.toml` but adapter writes inline in AGENTS.md via `buildInlineContent`.~~ | **Completed** v0.3.13 — native TOML agent write to `.codex/agents/` |
| 5 | ~~LOW~~ | ~~**Copilot missing agent frontmatter:** `agentToGitHubAgent` drops `target`, `disable-model-invocation`, `user-invocable`, `mcp-servers`, `metadata` fields.~~ | **Completed** v0.3.13 — switched to full frontmatter passthrough |
| 6 | ~~LOW~~ | ~~**Copilot skill reading:** `read()` returns `skills: []` but Copilot discovers skills from `.github/skills/`. Should be read during collect.~~ | **Completed** v0.3.13 — reads from `.github/skills/` via `readSkillsFromDir()` |
| 7 | ~~LOW~~ | ~~**Codex AGENTS.override.md:** Codex supports `AGENTS.override.md` (takes precedence over AGENTS.md). Not handled during collect — could miss overriding content.~~ | **Completed** v0.3.13 — override checked first, wins when present |
| 8 | ~~LOW~~ | ~~**Schema enrichment:** Many new Claude Code agent/skill frontmatter fields not typed in Zod schema. They pass through via `.passthrough()` but are untyped.~~ | **Completed** v0.3.13 — portable fields typed, categorization policy documented |

## Adapter Gaps (not in audit, discovered during review)

**Copilot reads CLAUDE.md** (with `chat.useClaudeMdFile` setting). If both Claude Code and Copilot adapters are active, instructions may appear twice in Copilot. Needs at minimum a documented warning, ideally conditional write logic.

**`.claude/commands/` is NOT deprecated** — merged into skills. Both `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` create `/deploy` and work identically. Commands still work; skills win on name conflict and add optional features (auto-invocation, supporting files, path rules). No removal timeline. Current PromptPit implementation (read/write to `.claude/commands/`) is correct. Future enhancement: optionally install commands as skills for richer features. Verified 2026-04-09.

**Claude Code `@path/to/file` import syntax** in CLAUDE.md is not resolved during collect. If a project's CLAUDE.md uses imports, collected instructions will contain the literal import directives instead of referenced content. Can produce incomplete stacks silently.

**Gemini CLI knowledge file missing.** The Tier 2 adapter proposal is based on general knowledge, not verified research. Create `docs/knowledge/gemini.md` before building the adapter.

**Zed adapter** worth noting: broadest cross-tool reading of any tool (reads `.cursorrules`, `.windsurfrules`, `.clinerules`, AGENTS.md, CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`). A Zed adapter might be as simple as writing a `.rules` file (highest priority in its first-match-wins system).

## Recommended Execution Order

### Tier 0 — Blocking (fix before Phase 2)
1. ~~Audit #1 + #2 (MCP and AGENTS.md duplication)~~ — completed v0.3.12
2. ~~BUG 23 (Codex TOML comment stripping — immediate user-visible drift)~~ — completed v0.3.12
3. ~~BUG 26 (Validator false positives — blocks valid stacks)~~ — completed v0.3.12
4. ~~Audit #3 (Cursor native SKILL.md — lossy translation, high impact)~~ — completed v0.3.12

### Tier 1 — Correctness
5. ~~Audit #4 (Codex native TOML agents — data loss)~~ — completed v0.3.13
6. ~~Audit #5-8 (Copilot agent fields, skill reading, Codex override, schema enrichment)~~ — completed v0.3.13
7. ~~Verify `.claude/commands/` deprecation status~~ — verified 2026-04-09, not deprecated (merged into skills)
8. ~~Deduplication test coverage (integration tests for multi-adapter install scenarios)~~ — completed v0.3.13

### Tier 2 — Phase 2 features
9. Stack composition (`extends`) — headline feature
10. Uninstall command — needed for safe stack iteration
11. Update command — depends on composition logic
12. Everything else in Phase 2

### Tier 3 — Tier 2 adapters
13. Junie — cleanest config (AGENTS.md + SKILL.md + MCP + rules), least friction
14. Windsurf — good config, but global-only MCP requires a design decision (not just a warning)
15. Continue.dev — note: accepts JSON configs directly in `.continue/mcpServers/`, simpler than YAML translation
16. Gemini CLI — create knowledge file first, verify all claims before building

---

## Phase 2 — Stack Composer (v0.3 -> v0.5)

Goal: let teams layer stacks on top of each other. Company base stack + team overrides + personal preferences, all composable.

### Stack composition (`extends`)
`"extends": ["github:company/base-stack@1.0.0"]` in stack.json. `pit install` recursively fetches and resolves the dependency graph. Base instructions merge first, team overrides layer on top. Provisional merge semantics: last-declared-wins with a warning on conflicts, explicit `overrides` block in stack.json for intentional resolution. This is the feature that makes multi-team setups practical.

### Diff command
`pit diff` — show the actual text diff between installed config and `.promptpit/` source. Distinct from `pit status` (which shows hash-level drift). This is a UI feature, not a composition feature.

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. Needs version comparison and conflict resolution for user-modified content.

### Formalize Agent Skills alignment
PromptPit already parses Agent Skills frontmatter (`skillFrontmatterSchema` in `schema.ts`). Formalize: ensure full spec compliance (name: 1-64 chars lowercase alphanumeric + hyphens; description: 1-1024 chars), support optional `scripts/`, `references/`, `assets/` directories, and document that `.promptpit/` is "Agent Skills + composition."

### Command param syntax translation
Translate `$ARGUMENTS` (Claude Code) <-> `$1` (Cursor) <-> `${input:arguments}` (Copilot) during install. Currently commands are copied verbatim with warnings. Single-param translation is clean, but multi-param ($1/$2/$3 -> $ARGUMENTS) is lossy. Deferred until user demand validates the need.

### Claude Code settings.json permissions/hooks
spotlight has a rich `.claude/settings.json` with `permissions`, `hooks`, and `enabledMcpServers`. Only `mcpServers` is collected. Consider porting these as optional bundle sections.

### Large instruction file warning
KurrentDB has a 25.1KB CLAUDE.md. No warning about unusually large instruction files. Add a size threshold warning during collect/validate.

### Uninstall command
`pit uninstall <stack>` — clean reverse of install. Markers make instruction removal straightforward. Skills/MCP/env is messier (what if the user modified them?). Basic version: remove marked blocks + delete unmodified skill files.

### Selective install/collect
`pit install --select` / `pit collect --select` — interactive picker for skills, MCP servers, env vars. Power-user feature for teams where you want conventions but not MCP servers.

## Phase 2.5 — Tier 2 Adapters (community-contributed)

Design the adapter interface for easy community contribution, then invite contributions.

### Windsurf
Instructions to `.windsurfrules` (legacy) or `.windsurf/rules/*.md` (modern, `trigger` frontmatter). MCP to global only at `~/.codeium/windsurf/mcp_config.json` — this is a design decision, not just a warning: every other adapter writes project-level MCP, so Windsurf needs either (a) write to user-level path by default, or (b) skip MCP with a warning. Skills via Agent Skills standard. Reads AGENTS.md natively. Unique `trigger` field maps from portable `alwaysApply`/`globs`. Character limits: 6K global, 12K workspace.

### Gemini CLI
**Prerequisite:** Create `docs/knowledge/gemini.md` with verified research. Claims below are unverified.

Instructions to `GEMINI.md` (supports `@path/to/file.md` imports). Skills to `.gemini/skills/` (native SKILL.md, symlinked). MCP to `.gemini/settings.json`. Agents to `.gemini/agents/*.md`. Detection: `~/.gemini` exists.

### JetBrains Junie
Instructions to `.junie/AGENTS.md` or `AGENTS.md`. Guidelines from `.junie/rules/*.md` and `.junie/guidelines.md` (legacy). Skills to `.junie/skills/<name>/SKILL.md`. MCP to `.junie/mcp/mcp.json`. Detection: `.junie/` directory. Strong candidate — clean namespace, Agent Skills + MCP + AGENTS.md all supported.

### Continue.dev
Instructions via `.continue/config.yaml`. Rules to `.continue/rules/*.md` with richest frontmatter (includes `regex` field — unique). MCP to `.continue/mcpServers/` — accepts JSON configs from Claude/Cursor directly, so no YAML translation needed. Reads AGENTS.md. Detection: `.continue/` directory.

## Phase 3 — Ecosystem Bridge (v0.5 -> v1.0)

Goal: install from anywhere, publish to anywhere. Connect the ecosystem.

### Broader SKILL.md discovery
Expand GitHub source discovery: (1) `.claude-plugin/marketplace.json` skills paths, (2) standard locations `skills/*/SKILL.md`, `.github/skills/*/SKILL.md`, (3) root-level subdirectory scan, (4) existing `.claude/skills/`, `.cursor/rules/`. Stop at first strategy returning results.

### Subdirectory / path install
`pit install github:owner/repo/path/to/skill[@ref]`. Path resolution after clone: directory with SKILL.md -> install skill, directory without -> scan subtree, file -> run through format reader, not found -> error.

### Format reader system
Import from any tool's native format when installing from non-promptpit repos. Readers for: `.mdc`, `.cursorrules`, `.clinerules`, `.windsurfrules`, `CONVENTIONS.md`, `.agent.md`, `.instructions.md`, `aiprompt.json`. Note: adapters already read their native formats during collect — this is specifically for the `pit install github:repo` path where the repo isn't a promptpit stack.

### Smart catalog prompting
When repo has >20 skills, prompt: install all / pick / cancel. `--all` flag skips prompt. Non-TTY without `--all` exits with error. If `marketplace.json` provides plugin groupings, offer bundles.

### `pit search` via registry APIs
Query skills.sh API, SkillsMP API, MCP Registry from the CLI. Filter by `--type skill|mcp` or `--source`. Display results with install counts and source links.

### Bundle / plugin install
`pit install github:anthropics/skills --plugin document-skills` installs a group of skills using marketplace.json plugin definitions. Support additional manifest formats.

### Publish to registry
`pit publish` — push a stack to a registry target (initially GitHub releases). Consider Agent Skills spec format for skills.sh discoverability.

### Well-known protocol for distribution
Serve stacks via `/.well-known/agent-skills/index.json` (skills.sh RFC 8615 convention). Any website can host skills this way.

### cursor.directory plugin API integration
Consume cursor.directory's `/api/plugins/{slug}` for composite bundles. PromptPit becomes the universal installer: fetch a cursor.directory plugin, translate, install to all detected tools.

### Write marketplace.json during collect
Generate `.claude-plugin/marketplace.json` during `pit collect`, making pit-bundled stacks installable via Claude Code's native plugin marketplace.

### TUI picker for catalog repos
Interactive TUI with search, filtering by tags/category, and plugin/bundle grouping. Depends on format readers and bundle install.

### README community catalog
Curated list of tested repos in the README. Per entry: repo, stars, skill count, `pit install` command, status.

## v1.0+

### Clean/reset command
`pit clean` — remove all AI agent config from a project. Broader than uninstall. Useful for starting fresh or switching stacks entirely.
