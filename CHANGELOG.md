# Changelog

## 0.5.5 (2026-04-28)

Three TUI wizards in one drop: **Uninstall**, **Collect drift**, and **Delete bundle**. Selecting any of these from a managed stack now opens an Ink wizard instead of flashing the v0.7 placeholder. Plus a new `pit delete` CLI command and a shared `ConfirmDestructive` typed-name confirm component for the high-stakes paths.

### Added

- **Uninstall wizard** (`src/tui/screens/uninstall-screen.tsx`) — state machine: `intro → configuring → confirming? → running → done | error`. Configuring exposes `Force` and `Dry run` toggles (`f` / `space`); the `Force` path routes through the typed-name confirm so a single Enter can't blow away modified artifacts. Done renders per-adapter removed counts plus shared / modified-skipped totals; dry-run additionally lists the planned files. `Uninstall for real` after a dry-run preserves the original `force` flag.
- **Collect-drift wizard** (`src/tui/screens/collect-drift-screen.tsx`) — multi-select picker over drifted artifacts (`reconcileAll` is the source of truth). Default selection is "everything that drifted." `space` toggles, `a` toggles all, `d` toggles dry-run. Done card shows accepted / skipped counts and the bundle output path; planned bundle changes are listed under dry-run. `Accept for real` after dry-run reuses the same selection.
- **Delete-bundle wizard** (`src/tui/screens/delete-bundle-screen.tsx`) — high-stakes destructive flow per spec §11. Configuring asks `Bundle only` vs `Bundle + uninstall`; both routes through typed-name confirm before the run. Bundle + uninstall runs uninstall first (while the manifest is still readable), then `rm -rf <root>/.promptpit/`. Path guard refuses any resolved path that doesn't end in `/.promptpit`.
- **`ConfirmDestructive` component** (`src/tui/components/confirm-destructive.tsx`) — shared typed-name confirm used by both Uninstall (force path) and Delete bundle. TextInput with live echo, real-time match check, Enter only fires `onConfirm` when typed === expected. No "3 strikes" lockout — Esc cancels at any time. First entry under a new `src/tui/components/` directory; sister Install cluster's `lifecycle-consent` will land here too.
- **`pit delete` CLI command** (alias `rm`) — parallels `pit uninstall`. Flags: `--also-uninstall`, `--force`, `--dry-run`. Validates the stack name against the bundle's `stack.json`, then removes `.promptpit/` (after running uninstall first when `--also-uninstall` is set). New file `src/commands/delete.ts` exporting `deleteBundle()` returning a structured `DeleteBundleResult`.
- **`collectDriftBack(root, selection, opts)`** core function (`src/core/collect-drift.ts`) — pulls local edits to installed artifacts back into the bundle, scoped to the caller-selected subset. Reuses `reconcileAll` for drift detection, copies canonical skill content (with supporting files) from `.agents/skills/` into `.promptpit/skills/`, writes adapter-format content for rules / commands / agents directly to the bundle, merges per-server MCP changes into bundle's `mcp.json`, and rehashes matching `installed.json` entries so reconcile reads as `synced` after. Companion `listDriftCandidates(root)` returns a flat picker-friendly list.

### Changed

- **`uninstallStack` returns `UninstallResult`** instead of `void` — exposes `removed` (per-artifact entries with adapter id, path, kind), `skipped` (per-artifact with `"modified" | "shared"` reason), `manifestUpdated`, `manifestRemoved`, `dryRun`, and `perAdapterRemoved` (rollup map) plus `plannedFiles` on dry-run. Existing CLI caller and headless tests ignore the return value, so behavior is unchanged for `pit uninstall`. The Uninstall wizard reads counts and per-adapter rollups directly from the result.
- **StackDetail dispatcher** (`src/tui/screens/stack-detail.tsx`) — `uninstall`, `collect-drift`, and `delete-bundle` keys are removed from the `COMING_SOON` map and routed to their wizards. `collect-drift` and `delete-bundle` show a Flash card on unmanaged stacks (these flows only apply to managed stacks).

### Notes

- **Multi-install per project is deferred.** When a project has multiple installed stacks, the scanner only exposes one row per stack root; the wizards in v0.5.5 handle single-install only. Reaching collect-drift / uninstall on a multi-install row works against the first stack's manifest entry; a follow-up will add an explicit install picker.

## 0.5.4 (2026-04-28)

First Chunk 2 wizard — `Collect` is now wired into the TUI. Selecting **Collect…** on an unmanaged stack opens an Ink wizard that walks intro → configure (with a dry-run toggle) → run → summary, instead of flashing the v0.6 placeholder. Headless `pit collect` is unchanged; this is a new entry point built on top of it.

### Added

- **Collect wizard** (`src/tui/screens/collect-screen.tsx`) — state machine: `intro → configuring → running → done | error`. Done renders a summary card with skill / agent / rule / command / MCP / secrets-stripped counts plus the bundle path; dry-run additionally lists the planned files (truncated past 12 with a "…N more" hint). Error path bubbles `collect()`'s message into a red card with Retry / Back. Enter on the unmanaged-stack `Collect…` row navigates here; the row is no longer "coming in v0.6".
- **Dry-run toggle inside the wizard** — `[ ] Dry run` toggleable with `space`. Default is off (happy path is "just collect"). When on, the primary action relabels from `Collect` to `Preview`, and Done's primary action becomes `Collect for real`.
- **`log.withMutedNotices`** (`src/shared/io.ts`) — broader counterpart to `withMutedWarnings`. Suppresses every `log.*` line, the animated `spinner()` frames, and `printDryRunReport` output for the duration of a callback. The Collect wizard wraps `collectStack` in this scope so the legacy CLI chrome (info banners, ora frames, dry-run reports) doesn't fight Ink's alt-screen.

### Changed

- **`collectStack` returns `CollectResult`** instead of `void` — exposes `outputDir`, detected adapter ids, structured `counts`, a `dryRun` flag, and `plannedFiles` (dry-run only). Existing callers (`cli.ts`, `sources/github.ts`, e2e tests) ignore the return value, so behavior is unchanged for the headless `pit collect` command. The new wizard reads counts directly from the result rather than re-parsing `.promptpit/stack.json` from disk.
- **`Collect for real` after a dry-run runs the real collect** — previously the post-dry-run primary action returned the user to the configuring screen with `[x] Dry run` still checked, leaving the wizard one space-bar away from collecting for real. It now jumps straight to a real collect; `Run again` on a real-collect result still opens configuring so options can be tweaked.
- **StackDetail and the stack list refresh after collect** — the wizard now invalidates the cached scan when a real collect succeeds, and StackDetail re-resolves its stack from the active scan instead of holding the captured snapshot from when it was opened. Popping back from the wizard to the same stack now shows the chip, version, and managed-only menu items (Update, Validate, Status & diff) without backing out to the main list. New helpers: `useScanOptional`, `useFreshStack` (`src/tui/scan-context.tsx`).

## 0.5.3 (2026-04-27)

Maintenance release — dependency bumps and CI cleanup. No runtime behavior changes.

### Dependencies

- Bump `ora` from 9.3.0 to 9.4.0 (#85).
- Bump `diff` from 8.0.4 to 9.0.0 (#80) — major bump verified end-to-end against `pit diff` (unified patch, colorized output, `--json` mode, marker-block scoping).
- Bump `softprops/action-gh-release` from 2 to 3 (#74) in the release workflow.
- Bump `postcss` dev-dep from 8.5.8 to 8.5.12 (#86).
- Bump dev-dependencies group: 5 updates (#79).

### CI

- Skip AI Code Review on Dependabot PRs — GitHub strips secrets from `pull_request` runs triggered by Dependabot, so `claude-code-action` was failing for lack of `ANTHROPIC_API_KEY`. Existing CI (test, codeql, version-check, dogfood) covers correctness for lockfile bumps.

## 0.5.2 (2026-04-22)

MVP-2 preview of the new interactive TUI. Bare `pit` now opens a full-screen Ink app with a grouped stack list, per-stack action menu, and three live actions (Validate, Status & diff, Open folder). Install / update / collect wizards arrive in v0.6; destructive flows in v0.7.

### Added

- **Interactive TUI for bare `pit`** — typing `pit` with no subcommand opens a full-screen Ink app with alt-screen buffer restore on exit, so quitting feels like `vim`/`less`. Non-TTY stdin (CI, pipes) gets a one-line error pointing at `pit ls` instead of hanging.
- **Grouped main stack list** — stacks partition into `● Managed`, `○ Unmanaged`, `◉ Global` sections with tone-colored counts. Each row shows version + drift chip + compact per-adapter summary (`claude-code: 3s/1a/2c/i`). Legend line decodes the summary code. Cursor lands on the selected stack; Enter opens the action menu.
- **Scope picker** (`s` key) — widen the scan between current tree + global, global only, or everywhere (depth 8 under home). Scope choice persists across rescans; state survives nav push/pop so returning to the main list doesn't re-scan unnecessarily.
- **Per-stack action menu** (`Enter`) — kind-aware options (managed / unmanaged / global) with an always-visible "coming in v0.6 / v0.7" flash for unshipped wizards, so the menu is fully navigable without dead clicks.
- **Validate action** — runs `validateStack` against `.promptpit/` and renders both pit and agnix diagnostics inline (source tag, rule code, file, message).
- **Status & diff action** — runs `reconcileAll` + `computeDiff` in parallel (`Promise.allSettled`), renders per-adapter drift and a list of drifted artifacts with paths relativized to the stack root. Surfaces a soft-error banner if the diff half fails but reconcile succeeds.
- **Open-folder action** — spawns `open` (macOS) / `explorer` (Windows) / `xdg-open` (Linux) to reveal the stack root in the platform file manager.
- **Empty-state screen** — when no stacks are found, shows CLI guidance (`pit init`, `pit install`, `pit collect`) instead of a dead-end menu. Widen-scope option is wired.
- **Rotating TUI error log** — uncaught renders write a timestamped log under `~/.promptpit/logs/tui-<ts>.log`. Alt-screen is restored and buffered stderr is flushed on hard crash so the user actually sees the error.
- **New shared modules** — `src/shared/text.ts` (`safe()` control-char sanitization, `clip()` hard-clipper), `errorMessage()` in `src/shared/utils.ts` (Error → message extractor), `src/tui/path-display.ts` (`homeify`, `toForwardSlash`, `describeStackPath` — shared by the `pit ls` string renderer and the TUI screens).

### Changed

- **`pit ls` renderer dedupes against the TUI** — path helpers, glyphs, and `safe()` sanitization now live in shared modules, so `pit ls` and the TUI stay visually aligned.
- **Esc-to-quit** from the main list and empty state, matching Esc-to-back on every other screen. `q` and Ctrl-C continue to work.
- **Frame footer grammar** — labeled `keys:` prefix + `·` separators, matching the main-list legend line grammar. Bottom status block reads as one cohesive chrome block.

### Fixed

- **Ghost-header bug on Status & diff + Validate** — every stderr write while Ink owns the terminal is now buffered and replayed after unmount (1 MB cap, drop counter for overflow). Per-screen `log.withMutedWarnings` wraps the core calls as belt-and-suspenders.
- **SIGINT no longer drops buffered stderr** — the SIGINT handler now flushes the stderr buffer before `process.exit(130)` so adapter warnings survive Ctrl-C.
- **TUI entry point positions cursor at top** — `\x1b[?1049h\x1b[H\x1b[2J` on enter, so Ink renders from (0,0) instead of wherever the CLI prompt left the cursor.

## 0.5.1 (2026-04-20)

MVP-1 of the new-UX plan. Core infrastructure for the forthcoming interactive TUI plus a scope-aware, scriptable `pit ls` — no TUI yet. See `docs/superpowers/plans/2026-04-20-new-ux.md`.

### Added

- **`pit ls`** — lists AI-config stacks in scope. Flags: `--scope current|global`, `--path <dir>`, `--deep`, `--all`, `--managed`, `--unmanaged`, `--drifted`, `--kind global|project`, `--short`, `--json`, `--strict`. `--json` emits `ScannedStack[]` for scripting; `--strict` exits 1 if any drift is detected. Groups by current folder, parent directories, and global, matching the upcoming TUI layout.
- **`~/.promptpit/config.json`** — user preferences (scan defaults, recents, UI toggles). Lazy — the file is never created by a read. Corrupt files fall back to in-memory defaults without overwriting the bad file. Atomic writes via tmp+rename.
- **`~/.promptpit/trust.json`** — per-source consent for lifecycle scripts. Hash-only storage (`sha256:<64hex>`) with a strict Zod regex. 256 KB preview cap and 1 MB hard-run cap enforced on script content. Kept separate from `config.json` so `pit config reset` (future) can't accidentally wipe trust.
- **`src/core/scan.ts`** — depth-limited filesystem walk producing `ScannedStack[]`. Default depth 5, never follows symlinks, prunes `node_modules`, `.git`, `dist`, and friends. Symlink cycle detection via realpath + visited set. Permission-denied directories swallowed silently. Folds monorepo sub-configs into the parent stack as annotations (Option A from the spec) rather than surfacing them as standalone stacks. Project-root detection walks up looking for `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or `.promptpit`. Surfaces `manifestCorrupt: true` when `installed.json` exists but can't be parsed — the TUI will use this for recovery actions later.
- **`src/tui/renderers/stack-list.ts` + `stack-detail.ts`** — chalk-rendered stack table and detail card. Shared between `pit ls` today and the TUI menus in MVP-2.
- **`ScriptedPrompter` test harness** in `src/shared/interactive.ts` — queue-based mock for wizard-flow tests. Lets TUI action tests assert the exact sequence of prompts without a TTY.
- Shared helpers in `src/shared/utils.ts`: `loadJsonFile` (read + Zod-validate + fall back to defaults) and `writeJsonAtomic` (tmp-then-rename). Unifies the pattern used by `config.ts` and `trust.ts`.
- `DEFAULT_IGNORE` in `src/shared/constants.ts` — single source of truth for the scan ignore list, referenced by both `scan.ts` and `configSchema`.
- `.windsurf` / `.gemini` / `.opencode` / `.ai-workspace` / `.trae` / `.zed` now surfaced under each stack as `+ unsupported: ...` so users know pit saw them even without a dedicated adapter.
- Warning dedup: `log.warnOnce(key, msg)` emits identical warnings only once per process — skip warnings and agnix notices no longer repeat N times on `pit ls`/`pit status`.
- `pit ls` now prints a one-line legend (`s=skills  a=agents  rules  cmd=commands  mcp  inst=instructions file`) so the compact count format is self-documenting.

### Changed

- Standards adapter now accepts `AGENT.md` (singular) in addition to `AGENTS.md`. Real-world repos (e.g., Snyk) ship the singular form.
- `pit ls --scope global` now actually skips the current-tree scan — header and body now agree.
- `pit ls --drifted` / `--managed` / `--unmanaged` empty states now say "No stacks match the active filters" instead of the onboarding "No AI config found" card. Reserves the onboarding card for the real empty scan.
- `pit ls` drift is now per-adapter: editing one `.cursor/rules/foo.mdc` tags only the `cursor` adapter, not all of them.
- Scan now prunes `docs`, `doc`, `examples`, `example`, `samples` by default. Fixes 17 spurious "unmanaged" entries on monorepos with translated documentation trees.
- `log.warn` / `log.info` / `log.success` now write to stderr. Previously corrupted `pit ls --json` and `pit collect --json` output when any warning fired during a scan.
- Spinner (`spinner()`) falls back to plain-text output when `stdout` isn't a TTY or `NO_COLOR` is set. Previously leaked `[32m✔[39m` escape sequences into piped output from `pit collect` / `pit install`.
- `pit collect` summary hides zero counts. Stack name falls back to the directory basename when `package.json` has no name or name `"root"`.

### Fixed

- Bare `pit` (no args) now prints help and exits 0 (was exit 1).
- `pit validate` exits 1 when errors are reported (was exit 0, breaking CI gating).
- `pit check --json` exits 1 when `pass: false` (was exit 0, diverging from the non-JSON form).
- `pit install --dry-run` exits 1 when `.promptpit/` is missing (was exit 0 with `✖` error prefix).
- `.github/prompts/*.md` files that don't match the `*.prompt.md` convention now produce a one-time info note instead of being silently skipped.

### Notes

- No TUI in this release. Bare `pit` still prints help. The interactive menu ships in v0.6.0.
- `--verbose` on `pit ls` deferred to a future version.

## 0.5.0 (2026-04-17)

### Added

- **`pit install --interactive`** — prompt to resolve `extends` conflicts. When two stacks declare the same skill, rule, MCP server, or env var, the picker surfaces each conflict and lets you choose which source wins. Choices persist to `installed.json` (and to `stack.json` as declarative `overrides` when `--save` is also passed) so you don't re-answer on the next install.
- **`pit install --select`** — interactively pick which artifacts to include, across all six categories (skills, agents, rules, commands, MCP servers, env vars). Deselections persist in `installed.json` under `excluded` and are respected on every subsequent install. Useful for "give me the conventions, skip the MCP servers."
- **`pit install --reset-exclusions`** — wipe the saved `excluded` list and reinstate all artifacts in one go. `--force` on its own no longer reintroduces artifacts the user opted out of.
- **`pit update --interactive`** — per-drifted-artifact prompt (`keep mine`, `take upstream`, `view diff`, `skip`). "Keep mine" tracks the fork in the manifest (`forked: true`, `baselineHash: <upstream-at-fork>`) so future `pit update` runs still surface upstream changes relative to the baseline. Prevents silent divergence from upstream security fixes.
- **`pit collect --select`** — interactively prune the bundle written to `.promptpit/` to just the artifacts you want.
- **Declarative `overrides` in `stack.json`** — authors can pin conflict resolutions by writing `overrides: { "rule:security": "github:company/base-stack" }`. Normalized source matching means version bumps (`@1.0.0` → `@2.0.0`) don't invalidate saved overrides.
- **Forked state in `pit status`** — artifacts the user chose to keep-local during `update --interactive` render with a `forked (baseline <hash>)` detail, so divergence is visible rather than silent.
- Install manifest gains `.passthrough()` validation so unknown fields survive when older pit versions write the manifest.
- New shared module `src/shared/interactive.ts` wrapping `@clack/prompts` with `isInteractive()` / `requireInteractive()` TTY detection. Any interactive flag errors out fast with an actionable message in non-TTY environments (CI, piped stdin) instead of silently falling back.

### Dependencies

- Added `@clack/prompts@^1.2.0` for the interactive prompts.

### Notes

- `pit init`'s readline-based prompter is unchanged in this release. The shared `@clack/prompts` wrapper coexists with it — migration is a cosmetic consistency win that touches tests, deferred to avoid scope creep.

## 0.4.3 (2026-04-16)

### Added

- **`pit update` command** — smart re-install that's drift-aware. Re-resolves your stack, re-installs any pieces that have updated upstream, and leaves locally-drifted files alone (with a warning) so you don't lose in-progress edits. Use `--force` to overwrite drifted files, `--dry-run` to preview changes, `--stack <name>` to update a single stack.
- **`pit uninstall` command** — clean removal of an installed stack. Deletes installed artifacts across all adapters, removes manifest entries, and protects canonical skills shared with other stacks.
- Install manifest now records `resolvedCommit` per stack, enabling `pit update` to detect when an upstream stack has moved forward.

### Changed

- Artifact removal logic extracted into `src/core/artifact-ops.ts` for reuse across `uninstall` and `update`.
- Adapter record building extracted into `manifest.ts` for shared use.

## 0.4.2 (2026-04-11)

### Added

- **Full skill directory support.** `pit collect` and `pit install` now handle entire skill directories, not just the SKILL.md file. Supporting files like `references/`, `scripts/`, and `assets/` are collected, installed, and tracked in the manifest. Skills that ship binaries, setup scripts, or documentation files now round-trip correctly.
- **Skill frontmatter schema tightened to match the [Agent Skills](https://agentskills.io) spec.** Name validation enforces 1-64 chars, lowercase alphanumeric + hyphens. Description capped at 1024 chars. Validation warnings now show the specific field name that failed.
- **4-part version format** in stack manifests (e.g., `0.10.1.0`) for projects that use build number versioning.
- `--pre-install` and `--post-install` CLI flags on `pit install` for running custom commands before/after install without defining them in stack.json.

### Fixed

- `pit status` now detects drift in skill supporting files, not just the main SKILL.md.
- `pit watch` correctly updates manifest hashes when supporting files change.
- Supporting files array is always written to the manifest, even when empty, preventing false drift on re-install.
- Path traversal guard on supporting file paths prevents writing outside the skill directory.

## 0.4.1 (2026-04-10)

### Added

- `pit diff` command shows the actual text diff between installed config and your `.promptpit/` source. See exactly what changed, not just "drifted" — with per-adapter and per-artifact breakdowns.
- Install lifecycle scripts: stacks can now define `scripts.preinstall` and `scripts.postinstall` in stack.json to run shell commands before/after install. Remote stacks show the script content and require explicit consent. `--trust` skips the prompt, `--ignore-scripts` skips scripts entirely, `--dry-run` shows what would run.
- Large instruction file warning during collect and validate. Files over 15KB (like a 25KB CLAUDE.md) now trigger a warning so you know before your stack bloats.
- `/develop` and `/ship` custom commands for the PromptPit project workflow.

### Changed

- Reconciliation logic extracted into `src/core/reconcile.ts` for reuse by both `pit status` and `pit diff`.
- Cleaned up docs: removed completed plan/spec/superpowers directories.

## 0.4.0 (2026-04-09)

### Added

- **Stack composition via `extends`.** Stacks can now declare dependencies on other stacks with `"extends": ["github:company/base-stack@1.0.0"]` in stack.json. `pit install` recursively fetches and resolves the dependency graph. Base instructions merge first, your overrides layer on top. This is how multi-team setups work: company publishes a base stack, teams extend it with their own skills and rules.
- **`pit install --save`** installs a stack AND adds it to your `extends` list in one command. Like `npm install --save` for AI agent configs.
- **`pit install` (no args) resolves extends** automatically. New developer clones the repo, runs `pit install`, gets everything including transitive dependencies.
- **`pit collect --include-extends`** flattens your extends chain into a self-contained bundle. Publish it and consumers install without needing access to your base stacks.
- **`pit collect` preserves extends** when re-collecting. Your `extends` and `instructionStrategy` fields survive re-runs of `pit collect`.
- **`pit status` checks upstream extends** for drift. If a base stack has new commits since you installed, you'll see a warning. Use `--skip-upstream` for offline mode.
- **`pit validate` checks extends syntax** (format validation, duplicate detection, instructionStrategy without extends warning).
- **Conflict detection with warnings.** When two stacks define the same skill, rule, agent, or MCP server, the last-declared version wins and you get a clear warning showing which source was overridden.
- **`instructionStrategy: "override"`** in stack.json lets you replace base instructions entirely instead of merging them.
- **Provenance tracking.** The install manifest records which commit each extended stack was resolved from, enabling precise drift detection.

### Changed

- `mergeConfigs` renamed to `mergeAdapterConfigs` for clarity (the new `mergeGraph` handles stack composition with different semantics).

## 0.3.14 (2026-04-09)

### Fixed

- `pit collect` no longer crashes on repos with malformed YAML frontmatter in agent, skill, or rule files. Files with unparseable YAML are now skipped with a warning showing the file path and specific parse error, instead of killing the entire command.
- Warning messages now show relative paths instead of absolute paths for cleaner output.

## 0.3.13 (2026-04-09)

### Added

- Codex agents are now written as native `.codex/agents/*.toml` files instead of being inlined in AGENTS.md. Structured fields like `sandbox_mode`, `model_reasoning_effort`, and `mcp_servers` are preserved instead of silently dropped.
- Copilot agent translation now passes through all frontmatter fields (`target`, `disable-model-invocation`, `user-invocable`, `mcp-servers`, `metadata`) instead of dropping them.
- `pit collect` now reads skills from Copilot's `.github/skills/` directory, which were previously invisible during collection.
- Codex `AGENTS.override.md` is now read during collect with proper precedence over `AGENTS.md`.
- New Claude Code agent and skill frontmatter fields are now typed in the Zod schema instead of relying on `.passthrough()`.

### Changed

- Multi-adapter dedup integration tests added, covering install mode overrides, manifest correctness, and full lifecycle scenarios.

## 0.3.12 (2026-04-09)

### Fixed

- Installing MCP servers to Codex no longer strips comments or reformats your `config.toml`. The writer now surgically edits only the managed `[mcp_servers.*]` sections, leaving your comments, model settings, and custom formatting untouched.

## 0.3.11 (2026-04-08)

### Fixed

- HTTP MCP servers (like exa) are no longer silently lost when installing to Codex. `writeMcpToToml()` now writes `url` and `serverUrl` fields instead of only `command`/`args`/`env`.
- Standalone `.md` skill files (not in a `*/SKILL.md` directory structure) are now discovered during collect. Repos like positron that use flat skill files no longer lose skills.
- Installing into a repo that already has rules no longer creates `rule-` prefixed duplicates. If `testing.mdc` exists, pit writes there instead of creating `rule-testing.mdc` alongside it.
- `pit status` no longer falsely reports rules as "deleted" after the dedup fix writes to the unprefixed path.

### Added

- `/pre-pr-check` command chains /review, AI Stack Expert adapter verification, and /simplify into a single pre-PR quality gate.

## 0.3.10 (2026-04-07)

### Added

- You can now collect, install, and sync slash commands across Claude Code, Cursor, and GitHub Copilot. Commands in `.claude/commands/`, `.cursor/commands/`, and `.github/prompts/` are bundled into `.promptpit/commands/` and installed to each tool's native path, with nested directory structures preserved.
- Copilot `.prompt.md` frontmatter is translated during collect (description preserved, model/tools/agent stripped) and extension is handled automatically during install.
- Install-time warnings when a command uses tool-specific param syntax ($ARGUMENTS, $1, ${input:x}) that may need manual adjustment for the target tool.
- `pit status` tracks command drift. `pit check` verifies command freshness. `pit validate` checks command frontmatter. `pit init` scaffolds a `commands/` directory.

## 0.3.9 (2026-04-06)

### Fixed

- `pit status` no longer shows false drift after a fresh install. The install manifest now hashes translated content (what's actually written to disk) instead of source content, fixing mismatches for inline agents and Copilot-translated agents/rules.
- Copilot rules now round-trip correctly. The reader was storing raw file content (with `applyTo`) but portable frontmatter (with `globs`), so downstream tools lost the globs translation. Content is now rebuilt with portable frontmatter.
- Standards MCP servers with version pins (e.g. `@2025.4.8`) are no longer silently replaced by unpinned versions from other adapters during collect.
- Standards HTTP MCP servers (url-only, like `https://mcp.exa.ai/mcp`) are no longer dropped during collect. Previously, all Standards MCP was wholesale-wiped when another adapter had any MCP servers.
- Codex adapter no longer falsely detects on projects that only have AGENTS.md. Detection now requires a `.codex/` directory, preventing self-inflicted drift on Standards-only projects.
- MCP overwrite warnings are suppressed on idempotent re-installs (same content, different key order).
- Adapter-specific agent fields (like Codex `sandbox_mode`, `model_reasoning_effort`) are preserved during collection instead of being stripped.
- JSONC comments in `.vscode/mcp.json` are now parsed correctly (added `strip-json-comments`).
- Standards MCP is no longer suppressed when other adapters detect MCP capability but read zero servers.
- Copilot adapter now reads `.instructions.md` files from subdirectories (e.g. `review-guide/`).
- Copilot adapter now reads plain `.md` agent files alongside `.agent.md`.

### Added

- Codex `.toml` agents (`.codex/agents/*.toml`) are now collected. Maps `developer_instructions`, `model`, `sandbox_mode`, and other TOML fields to portable agent format.
- TOML MCP reader now supports HTTP/SSE servers (`url`/`serverUrl` fields).
- `pit init` supports `--yes` and `--name` flags for non-interactive/CI use.
- Shared `warnMcpOverwrites()` helper with hash-based comparison for key-order independence.
- 80+ new tests covering all fixes and features.
- Real-world QA validation report updated with 3 rounds of testing across 9 repos.

## 0.3.8 (2026-04-06)

### Fixed

- Cursor adapter now reads `.md` rules in addition to `.mdc`. Real-world repos like `everything-claude-code` use plain `.md` format in `.cursor/rules/`, and all 39 of those rules were silently dropped.
- Cursor adapter now reads skills from `.cursor/skills/*/SKILL.md`. Previously the skills path incorrectly pointed to `.cursor/rules/` and skills were hardcoded to an empty array, losing 14 skills across repos like `snyk-intellij-plugin` and `everything-claude-code`.

## 0.3.7 (2026-04-03)

### Fixed

- Rules without `name` in frontmatter are no longer silently dropped. Real-world rules from Claude Code, Cursor, and Copilot rarely include `name`, so pit now infers it from the filename. Previously, every rule from every tested repo was lost during collect.
- Agents without `name` or `description` in frontmatter are no longer silently dropped. Name is inferred from filename, description from the first body line. Previously, 13 of 17 real-world agents were lost.
- `globs: null` in rule frontmatter no longer causes a validation error. Treated as "no globs specified."
- Validation error messages now include field names (e.g., "name: Required") instead of generic "Required, Required".

### Added

- Real-world validation test suite (`test/e2e/real-world-repos.test.ts`) that clones 9 public GitHub repos across all 5 adapters and runs the full collect, validate, install, status pipeline. Documents remaining gaps in `REAL_WORLD_REPORT.md`.

## 0.3.6 (2026-04-02)

### Added

- Portable custom agents in `.promptpit/agents/*.md` with YAML frontmatter (`name`, `description`, `tools`, `model`). Agents are written natively to Claude Code (`.claude/agents/`) and Copilot (`.github/agents/*.agent.md`), and inlined into instructions for tools without native agent support (Codex, Cursor, Standards/AGENTS.md).
- `pit collect` now reads agents from Claude Code and Copilot projects and includes them in the bundle.
- `pit install` writes agents to all detected tools with format translation (Copilot drops `model` field, uses `.agent.md` extension).
- `pit validate` checks agent frontmatter for errors.
- `pit status` detects agent drift for native adapters (hash comparison against install manifest).
- `pit check` verifies agent freshness and drift in CI.
- `pit init` scaffolds an `agents/` directory alongside `skills/` and `rules/`.
- Tools without native agent support (Windsurf, Zed, Cline, Aider, and others) get agent definitions embedded in AGENTS.md automatically.

### Fixed

- `pit check` now detects rule drift and freshness (was silently skipping rules despite install manifest tracking them).

## 0.3.5 (2026-04-02)

### Added

- Portable conditional rules in `.promptpit/rules/*.md` with YAML frontmatter (`name`, `description`, `globs`, `alwaysApply`). Rules are translated per-adapter during install: `.claude/rules/*.md` (Claude Code), `.cursor/rules/*.mdc` (Cursor), `.github/instructions/*.instructions.md` (Copilot).
- `pit collect` now reads rules from Claude Code, Cursor, and Copilot projects and includes them in the bundle.
- `pit validate` checks rule frontmatter for errors.
- `pit status` detects rule drift (modified, deleted, synced).
- `pit init` scaffolds a `rules/` directory alongside `skills/`.
- Rule files in Cursor and Copilot use a `rule-` prefix to avoid name collisions with skills in shared directories.

## 0.3.4 (2026-04-02)

### Added

- Help examples on all 7 CLI commands (`pit <command> --help` now shows usage examples)
- Next-step suggestions after `pit collect`, `pit install`, `pit validate`, and `pit check` complete
- E2E journey tests for multi-stack coexistence, corrupted manifest recovery, drift detection, and skill authoring

### Changed

- `pit init` next-steps revised: dropped "edit stack.json" step, added `pit validate` and `pit collect` hints
- `pit status` drift suggestions now use visible colors instead of dim text
- Error messages for "no .promptpit/ found" and "no AI tools found" now suggest `pit init` and `pit collect` as next actions

## 0.3.3 (2026-04-01)

### Fixed

- `pit validate` now correctly invokes agnix with `--format json` as a global flag (before the `validate` subcommand), matching agnix's actual CLI interface.

## 0.3.2 (2026-04-01)

### Changed

- `pit validate` now finds agnix when installed globally (e.g., `npm i -g agnix`), not just as a local dev dependency. Local installs are still preferred when present.

### Fixed

- `pit collect` no longer skips skills that use a single string for `allowed-tools` or `context` in SKILL.md frontmatter (e.g., `allowed-tools: Read`). YAML parses these as strings, not arrays. The schema now coerces both forms automatically.

## 0.3.0 (2026-04-01) — Phase 1: Team Platform

The "new dev joins, runs one command, every AI tool is configured" release. Five adapters, seven commands, and drift detection that actually works across all of them.

### Highlights

- **Five adapters ship as Tier 1:** Claude Code, Cursor, Codex CLI, GitHub Copilot, and Standards (AGENTS.md + .mcp.json). Install one stack, every tool gets configured in its native format
- **Seven commands:** `pit init` (scaffold), `pit collect` (bundle), `pit install` (write), `pit status` (drift check), `pit watch` (live-sync), `pit validate` (lint), `pit check` (CI gate)
- **Dry-run previews:** `--dry-run` on collect and install shows exactly what would change. `--verbose` adds unified diffs
- **HTTP remote MCP servers:** Stacks can now include url-based MCP servers alongside stdio ones. Copilot gets `type: "http"` inferred automatically

### Added

- `pit init` scaffolds a new `.promptpit/` stack with interactive prompts for name, version, description, author, and optional files
- `pit validate` checks stack.json, skills, mcp.json, agent instructions, and .env.example. Reports all errors at once. `--json` for CI. Optional agnix integration for 385+ adapter-specific lint rules
- `pit check` verifies installed config is fresh (stack.json matches installed.json) and in sync (files on disk match recorded hashes). Exits non-zero on drift. `--json` for CI pipelines
- GitHub Copilot adapter: instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` (applyTo globs), MCP to `.vscode/mcp.json` (servers key, type inference)
- Codex CLI adapter: instructions to AGENTS.md, skills symlinked to `.codex/skills/`, MCP merged into `.codex/config.toml` via TOML writer
- Standards adapter unified from separate agents-md and mcp-standard adapters. Owns AGENTS.md and .mcp.json as cross-tool outputs
- `--dry-run` on both collect and install with file-by-file preview (create/modify per adapter). `--verbose` adds unified diffs for modified files
- `--verbose` / `-v` on `pit status` shows per-adapter detail: skill names, MCP server names, instruction paths, individual hash status

### Fixed

- HTTP remote MCP servers (url-only) no longer silently break schema validation
- `pit status` no longer reports false drift for Codex TOML or Copilot MCP immediately after install
- Empty MCP server configs rejected by schema validation
- MCP drift detection uses canonical hashing that ignores adapter-added fields

### Changed

- Each adapter declares `mcpFormat` and `mcpRootKey` in its capabilities for native MCP reading
- 395 tests across 38 test files

## 0.2.9 (2026-04-01)

### Fixed

- HTTP remote MCP servers (url-only, no command) no longer silently break validation. Previously, a single remote server in your mcp.json would cause Zod schema validation to fail, dropping ALL MCP servers from the bundle with no warning. Now stdio and remote servers coexist correctly
- `pit status` no longer reports false drift for Codex and Copilot MCP immediately after install. Codex TOML files and Copilot's `servers` key + `type` field were causing hash mismatches on every check. Status now reads each adapter's MCP format natively
- Empty MCP server configs (`{}`) are now rejected by schema validation instead of silently accepted

### Changed

- MCP drift detection uses canonical hashing that ignores adapter-added fields (like Copilot's `type: "stdio"`). Only the fields you defined (command, args, env, url, serverUrl) are hashed, so adapters can transform configs without triggering false drift
- Each adapter now declares `mcpFormat` ("json" or "toml") and `mcpRootKey` in its capabilities, replacing hardcoded adapter ID checks in the status command. Adding a new adapter with a different MCP format no longer requires modifying status.ts

## 0.2.8 (2026-04-01)

### Added

- `pit collect --dry-run` and `pit install --dry-run` now show exactly what would happen before writing anything. You get a file-by-file preview: which files would be created or modified, per-adapter breakdowns (Claude Code, Cursor, Copilot, Codex, Standards), and details like "update marker block", "add 2 MCP servers", or "symlink"
- `--verbose` / `-v` flag on both commands. When combined with `--dry-run`, shows unified diffs for files that would be modified. See the exact lines that would change in your CLAUDE.md, .cursorrules, or settings.json before committing to the install

### Changed

- `writeWithMarkers` and `mergeMcpIntoJson` now return rich result objects instead of bare file paths, enabling dry-run introspection without extra file reads
- Three shared helpers (`markersDryRunEntry`, `mcpDryRunEntry`, `skillDryRunEntry`) eliminate dry-run entry construction duplication across all adapters
- `canonicalSkillBase()` extracted from `skill-store.ts` as single source of truth for canonical skill directory paths
- MCP overwrite warnings suppressed during dry-run (no point warning about overwrites that aren't happening)

## 0.2.7 (2026-04-01)

### Added

- `pit validate` checks if a `.promptpit/` stack is well-formed before publishing or installing. Validates stack.json (schema), agent.promptpit.md (frontmatter), skills (frontmatter per skill), mcp.json (config schema), and .env.example (dangerous env names). Reports all errors at once instead of failing on the first one. Supports `--json` for CI integration. Exit 0 when valid (warnings allowed), exit 1 on errors
- Optional agnix integration. When agnix is installed (`npm i -D agnix`), `pit validate` auto-detects the binary and runs 385+ adapter-specific lint rules on top of the built-in checks. Diagnostics from agnix appear in a separate section. If agnix isn't installed, a one-line tip suggests it

## 0.2.6 (2026-04-01)

### Added

- `pit check` verifies your AI config is fresh and in sync, designed for CI pipelines. Two-phase check: freshness compares `.promptpit/stack.json` against `installed.json` (catches forgotten installs, version mismatches, missing skills/MCP servers), drift compares installed files on disk against their recorded hashes (catches hand-edits and deletions). Exits non-zero on any problem. Supports `--json` for machine-readable output. Add `npx promptpit check` to your CI pipeline and never ship stale AI config again

### Changed

- `tryReadStackManifest()` and `tryReadMcpConfig()` extracted as shared helpers in `stack.ts`, eliminating duplication between `readStack()` and the new check command
- `computeStatus()` and its supporting types now exported from `status.ts` for reuse by the check command

## 0.2.5 (2026-04-01)

### Added

- Codex CLI adapter. `pit install` now detects Codex CLI projects and writes instructions to AGENTS.md, symlinks skills to `.codex/skills/`, and merges MCP servers into `.codex/config.toml` (TOML format). Codex joins Claude Code, Cursor, and Copilot as a Tier 1 adapter
- TOML config support via `smol-toml`. Reads existing `config.toml` settings (model, approval policy, etc.) and preserves them when merging MCP servers. Codex-specific fields like `enabled_tools` and `startup_timeout_sec` are stripped during collect so stacks stay portable

## 0.2.4 (2026-04-01)

### Added

- `pit init` scaffolds a new `.promptpit/` stack from scratch with interactive prompts. Asks for stack name, version, description, and author, then optionally creates agent instructions, MCP config, and .env.example files. Validates input against the stack schema before writing. Use `--force` to overwrite an existing stack, `--output` to target a custom directory
- Default stack name auto-sanitized from the directory name (strips invalid characters, falls back to `my-stack`)
- Agent instructions frontmatter now generated via `js-yaml` for correctness with special characters

## 0.2.3 (2026-04-01)

### Added

- GitHub Copilot adapter (Tier 1). `pit install` now writes to Copilot's native config paths: instructions to `.github/copilot-instructions.md`, skills translated to `.github/instructions/*.instructions.md` with `applyTo` glob frontmatter, and MCP servers to `.vscode/mcp.json` with the correct `servers` root key and required `type` field per entry
- `pit collect` now detects Copilot projects via `.github/copilot-instructions.md` and `.vscode/mcp.json`, and reads scoped instructions as rules
- `pit watch` automatically re-translates skills for Copilot when `.agents/skills/` files change (same translate-copy strategy as Cursor)
- Error message in `pit collect` now lists Copilot paths so users know what's detected

### Changed

- The separate `agents-md` and `mcp-standard` adapters are now a single `standards` adapter that owns all cross-tool conventions (AGENTS.md, .mcp.json, .agents/skills/). `pit install` writes both files in one pass instead of coordinating two adapters
- MCP JSON merge logic and permission error handling extracted into shared utilities (`mergeMcpIntoJson`, `rethrowPermissionError`), reducing ~60 lines of duplication across claude-code, cursor, and standards adapters
- All adapters that write MCP config now emit overwrite warnings when replacing existing servers, not just some of them
- `pit collect` dedup logic simplified: reads all adapters, then clears MCP from standards when other MCP-capable adapters are present (instead of pre-filtering the read set)
- `pit install` always-include logic consolidated from two separate blocks into one

## 0.2.2 (2026-04-01)

### Added

- `pit status --verbose` (or `-v`) shows the full inventory per adapter: individual skill names, MCP server names, instruction file paths, and per-artifact sync state. Default output stays compact (counts only), verbose expands to the complete picture. Useful for debugging drift and verifying exactly what's installed
- Suggestions ("Run `pit install`...") now appear in both default and verbose modes, so users debugging drift always see remediation hints

### Changed

- State severity logic centralized into `escalateState()` with a priority table, replacing scattered inline guards. Fixes a latent bug where instruction state was set unconditionally instead of escalating
- `formatLong` and `formatVerbose` unified into a single `formatDetailed` renderer, eliminating 15 lines of duplication
- Non-verbose "Changes" section now shows per-file state icons (e.g., a drifted skill shows M, a deleted skill shows D) instead of using the adapter's overall worst state for all files
- Corrupt MCP JSON files now correctly mark all servers as "drifted" instead of misclassifying them as "deleted"
- Test helper `captureOutput()` extracted, replacing 22 instances of spy/capture/restore boilerplate

## 0.2.1 (2026-04-01)

### Fixed

- `pit status` now shows correct MCP server counts for all adapters, not just .mcp.json. Previously Claude Code's MCP servers were invisible in status output
- `.mcp.json` is now created during install even when it didn't exist before. Previously you needed a pre-existing .mcp.json for the adapter to activate
- `pit status` no longer shows phantom "removed-by-user" entries for the mcp-standard adapter's instructions (it doesn't write instructions)
- Duplicate file entries in `pit status` Changes section are now deduplicated

### Added

- 6 install-to-status integration tests that verify the full loop: MCP counts, .mcp.json creation, drift detection, multi-stack manifests, re-install upsert, and dry-run isolation

## 0.2.0 (2026-04-01)

### Added

- `pit status` shows what stacks are installed, which adapters are synced, and what's drifted. Like `git status` for your AI tooling. Supports `--json` (porcelain) and `--short` output modes
- `pit watch` monitors `.agents/skills/` and re-translates skill files for non-symlinked adapters when they change. Foreground process with 200ms debounce for batch changes
- `.mcp.json` support via a new `mcp-standard` adapter. Project-level MCP configs are read during collect and written during install, alongside adapter-specific MCP paths
- Install manifest (`.promptpit/installed.json`) tracks every install with per-artifact SHA-256 content hashes. Enables status drift detection, collect dedup, and future update/uninstall/diff commands. Atomic writes via temp+rename
- Instruction hash dedup in the merger prevents identical content from multiple adapters (e.g., CLAUDE.md and AGENTS.md with the same text) from being collected twice
- `stripMarkerBlock()` and `stripAllMarkerBlocks()` in markers.ts for removing installed content during collect

### Fixed

- Recursive duplication on collect+install. Previously, re-collecting after install would bundle the installed content again, causing it to grow on each cycle. Now collect strips all promptpit marker blocks before bundling, guaranteeing the round-trip: collect -> install -> collect produces identical output

### Changed

- Replaced the fragile fallback-only read logic (excluding AGENTS.md when Claude Code is detected) with content-hash dedup in the merger. Different content from multiple adapters is now kept; only exact duplicates are removed
- Manifest schema (InstallManifest, InstallEntry, AdapterInstallRecord) co-located with existing Zod schemas in `schema.ts`

## 0.1.6 (2026-03-30)

### Added

- Skills are now installed to `.agents/skills/` as the canonical location, matching the skills.sh ecosystem convention used by 16+ AI tools
- Claude Code skill paths (`.claude/skills/`) are now symlinks to the canonical location instead of copies, so edits to `.agents/skills/` are instantly reflected
- Windows automatically falls back to file copies when symlinks aren't available
- New `pit watch` TODO for future live sync of translated skill copies

### Changed

- Each adapter now declares a `skillLinkStrategy` (`"symlink"`, `"translate-copy"`, or `"none"`) instead of a boolean `skills` flag, making it easier to add new adapters
- Cursor continues to get translated `.mdc` copies (read from bundle, not disk), while native SKILL.md tools get zero-copy symlinks

## 0.1.5 (2026-03-30)

### Added

- AGENTS.md support: `pit install` now always generates an AGENTS.md file, readable by 20+ AI tools (Codex, Copilot, Cursor, Windsurf, Zed, Cline, Roo Code, Amp, Devin, Aider, and more)
- `pit collect` reads AGENTS.md as a fallback when no other tool configs are detected, so projects that only have AGENTS.md can be collected into portable stacks

### Changed

- Extracted shared `writeWithMarkers` helper, making it easier to add new adapters with consistent marker handling

## 0.1.4 (2026-03-28)

- Added ignore tip for `.promptpit/` in team setup docs

## 0.1.3 (2026-03-28)

- `pit install` with no arguments now installs from `.promptpit/` in the current directory
- Added `.promptpit/` bundle with promptpit-starter pre-installed

## 0.1.2 (2026-03-28)

- Fixed global install crash when target directory contains symlinks (e.g., gstack skill symlinks)

## 0.1.1 (2026-03-28)

- Fixed auto-collect for repos that store skills at the repo root (e.g., gstack)
- Fixed env key matching to use line-prefix instead of substring (prevents false positives)
- Fixed stack name validation with strict regex (prevents path traversal)
- Improved warning messages for skipped skills and MCP parse errors

## 0.1.0 (2026-03-28)

Initial release.

- `pit collect` — scan Claude Code and Cursor configs, bundle into portable `.promptpit/` stack
- `pit install` — install stacks from local paths or GitHub repos
- Claude Code adapter (CLAUDE.md, skills, MCP settings)
- Cursor adapter with automatic SKILL.md to .mdc conversion
- Secret stripping for MCP configs with `.env.example` generation
- Idempotent markers for multi-stack coexistence
- `--global` flag for user-level installation
- Safe YAML parsing (prevents code execution from untrusted sources)
- Env var name validation (blocks PATH, NODE_OPTIONS, etc.)
- GitHub source with auto-collect for repos without `.promptpit/`
