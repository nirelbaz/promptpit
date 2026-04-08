# TODOS

## Strategic Context

**Core thesis:** PromptPit is the composition layer for AI agent config. Translation is the entry point, stack management keeps things in sync, composition lets teams build on each other's work.

**Phased roadmap:** ~~Team Platform (v0.3)~~ -> Stack Composer (v0.5) -> Ecosystem Bridge (v1.0)

**Landscape (April 2026):** AGENTS.md adopted by 60K+ repos (Linux Foundation). Vercel Agent Skills / skills.sh is the emerging skill package manager (45+ agents, Cloudflare `.well-known` RFC for discovery). .mcp.json converging as project-level MCP standard. Agent Skills spec is complementary, not competing — it defines the individual skill format, PromptPit adds composition (bundling instructions + skills + MCP + env as one distributable unit). PromptPit already parses Agent Skills frontmatter.

**Adapter tiers:** Tier 1 (creator-maintained): Claude Code, Cursor, Codex, Copilot. Tier 2 (community-contributed): Windsurf, Gemini, Junie, Continue.dev.

## Known Bugs

**BUG 22:** `writeMcpToToml()` only writes `command`/`args`/`env` — drops `url`/`serverUrl` for HTTP MCP servers on Codex install. Data loss for url-only servers like exa.

**BUG 23:** Codex `config.toml` install strips comments and reformats, causing immediate drift in `pit status`. Either preserve non-managed sections or hash only managed fields.

**BUG 24:** Install into a repo that already has rules creates `rule-` prefixed duplicates alongside originals. Consider skipping `rule-{name}` when `{name}` already exists in the target directory.

**BUG 25:** `readSkillsFromDir()` only globs `*/SKILL.md`, missing standalone `.md` skill files (e.g. positron's `review-upstream-merge.md`).

**BUG 26:** Validator CC-AG-009/CC-AG-003 false positives on Copilot/Codex-native tool and model names. Validator should be platform-aware or skip tool/model validation for non-Claude-origin agents.

## Adapter Audit Findings

Discovered via `/audit-adapters` using the AI Stack Expert knowledge base. See `docs/knowledge/` for per-tool evidence.

| # | Severity | Issue |
|---|----------|-------|
| 1 | HIGH | **MCP duplication:** Claude Code reads `.mcp.json` natively. Standards + Claude Code adapters both write MCP, causing servers to appear twice. Same for Copilot (`.mcp.json` + `.vscode/mcp.json`). Need dedup strategy. |
| 2 | HIGH | **AGENTS.md instruction duplication:** Standards always writes AGENTS.md. Copilot and Cursor also read it natively. Both adapters active = instructions appear twice. Need conditional write logic. |
| 3 | MEDIUM | **Cursor native SKILL.md:** Cursor v2.4+ supports `.cursor/skills/<name>/SKILL.md` natively. Adapter still translates to `.mdc` (lossy). Change `skillLinkStrategy` to `"symlink"` targeting `.cursor/skills/`. |
| 4 | MEDIUM | **Codex agent write format mismatch:** Codex reads agents from `.codex/agents/*.toml` but adapter writes inline in AGENTS.md. Consider writing native TOML agent files. |
| 5 | LOW | **Copilot missing agent frontmatter:** `agentToGitHubAgent` drops `target`, `disable-model-invocation`, `user-invocable`, `mcp-servers`, `metadata` fields. |
| 6 | LOW | **Copilot skill reading:** `read()` returns `skills: []` but Copilot discovers skills from `.github/skills/`. Should be read during collect. |
| 7 | LOW | **Codex AGENTS.override.md:** Codex supports `AGENTS.override.md` (takes precedence over AGENTS.md). Not handled during collect. |
| 8 | LOW | **Schema enrichment:** Many new Claude Code agent/skill frontmatter fields not typed in Zod schema. They pass through via `.passthrough()` but are untyped. |

## Phase 2 — Stack Composer (v0.3 -> v0.5)

Goal: let teams layer stacks on top of each other. Company base stack + team overrides + personal preferences, all composable.

### Stack composition (`extends`)
`"extends": ["github:company/base-stack@1.0.0"]` in stack.json. `pit install` recursively fetches and resolves the dependency graph. Base instructions merge first, team overrides layer on top. Provisional merge semantics: last-declared-wins with a warning on conflicts, explicit `overrides` block in stack.json for intentional resolution. This is the feature that makes multi-team setups practical.

### Diff command
`pit diff` — show what changed between installed config and `.promptpit/` source. Natural byproduct of the merge/composition logic. Pairs with `pit status` and `pit update`.

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. Needs version comparison and conflict resolution for user-modified content.

### Embrace AGENTS.md as primary format
With 60K+ repos adopting AGENTS.md as the cross-tool standard, PromptPit should read it as a primary input — not just generate it during install. Start with read-only parsing (behind feature flag until spec stabilizes), then graduate to full read/write.

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
Instructions to `.windsurfrules` (legacy) or `.windsurf/rules/*.md` (modern, `trigger` frontmatter). MCP to global only at `~/.codeium/windsurf/mcp_config.json` — warn that project-level MCP is unsupported. Skills via Agent Skills standard. Reads AGENTS.md natively. Unique `trigger` field maps from portable `alwaysApply`/`globs`. Character limits: 6K global, 12K workspace.

### Gemini CLI
Instructions to `GEMINI.md` (supports `@path/to/file.md` imports). Skills to `.gemini/skills/` (native SKILL.md, symlinked). MCP to `.gemini/settings.json`. Agents to `.gemini/agents/*.md`. Detection: `~/.gemini` exists.

### JetBrains Junie
Instructions to `.junie/AGENTS.md` or `AGENTS.md`. Guidelines from `.junie/rules/*.md` and `.junie/guidelines.md` (legacy). Skills to `.junie/skills/<name>/SKILL.md`. MCP to `.junie/mcp/mcp.json`. Detection: `.junie/` directory. Strong candidate — clean namespace, Agent Skills + MCP + AGENTS.md all supported.

### Continue.dev
Instructions via `.continue/config.yaml`. Rules to `.continue/rules/*.md` with richest frontmatter (includes `regex` field — unique). MCP to `.continue/mcpServers/*.yaml`. Reads AGENTS.md. Detection: `.continue/` directory.

## Phase 3 — Ecosystem Bridge (v0.5 -> v1.0)

Goal: install from anywhere, publish to anywhere. Connect the ecosystem.

### Broader SKILL.md discovery
Expand GitHub source discovery: (1) `.claude-plugin/marketplace.json` skills paths, (2) standard locations `skills/*/SKILL.md`, `.github/skills/*/SKILL.md`, (3) root-level subdirectory scan, (4) existing `.claude/skills/`, `.cursor/rules/`. Stop at first strategy returning results.

### Subdirectory / path install
`pit install github:owner/repo/path/to/skill[@ref]`. Path resolution after clone: directory with SKILL.md -> install skill, directory without -> scan subtree, file -> run through format reader, not found -> error.

### Format reader system
Pluggable `FormatReader` interface: `id`, `extensions`, `canRead(path)`, `read(path): SkillEntry`. Ship readers for: `.mdc`, `.cursorrules`, `.clinerules`, `.windsurfrules`, `CONVENTIONS.md`, `.agent.md`, `.instructions.md`, `aiprompt.json`.

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
