# Real-World Validation Report

## Test Suite

9 repos, all 5 adapters covered, 91 tests passing.

Test file: `test/e2e/real-world-repos.test.ts`

## Repos Tested

| Repo | Stars | Adapters | Skills | Agents | Rules | MCP |
|------|-------|----------|--------|--------|-------|-----|
| posit-dev/positron | 4,039 | Claude Code, Copilot | 7 CC skills | 3 Copilot agents | 2 CC rules, 9 Copilot instructions | 2 (.vscode/mcp.json) |
| specklesystems/speckle-server | 786 | Cursor, Copilot | 0 | 0 | 4 .mdc | 1 (.cursor/mcp.json) |
| Azure/azure-sdk-for-js | 2,287 | Claude Code, Copilot, Codex | 0 | 8 Copilot agents | 0 | 2 (.vscode/mcp.json) |
| microsoft/apm | 925 | Copilot | 0 | 6 Copilot agents | 6 instructions | 1 |
| ModelEngine-Group/fit-framework | 2,107 | Codex, Claude Code | 0 | 0 | 0 | 0 |
| affaan-m/everything-claude-code | 134,793 | Claude Code, Cursor, Codex, Standards | 1 CC + 10 Cursor | 0 | 39 Cursor + 2 CC | 6 (.mcp.json) |
| kurrent-io/KurrentDB | 5,765 | Claude Code, Standards | 0 | 0 | 0 | 4-8 (.mcp.json + .claude) |
| getsentry/spotlight | 573 | Claude Code, Cursor, Codex, Standards | 0 | 0 | 0 | 2 (.mcp.json) |
| snyk/snyk-intellij-plugin | 65 | Cursor | 4 Cursor skills | 0 | 1 .mdc | 0 |

---

## Bugs Found & Fix Status

### BUG 1 (Critical): Rules without `name` frontmatter silently dropped — 70 rules lost
**Status: FIXED** (PR #37)

Real-world rules use native frontmatter without `name`. Fix: infer `name` from filename via `inferRuleDefaults()`, make `description` optional in schema.

### BUG 2 (Critical): Agents without `name` frontmatter silently dropped — 13 agents lost
**Status: FIXED** (PR #37)

Real-world Copilot agents lack `name` field. Fix: infer `name` from filename (strip `.agent.md`), infer `description` from first body paragraph via `inferAgentDefaults()`.

### BUG 3 (Medium): JSONC not parsed — MCP servers lost in VS Code ecosystem
**Status: FIXED** (PR #40)

`.vscode/mcp.json` contains JS-style comments. Fix: added `strip-json-comments` dependency, JSONC parsing in `readMcpFromSettings()`.

### BUG 4 (Medium): Standards MCP suppressed when other adapters read zero MCP
**Status: FIXED** (PR #41)

Standards MCP was cleared when other adapters "supported" MCP but read zero servers. Fix: only suppress when another adapter actually has non-empty `mcpServers`.

### BUG 5 (Medium): Status shows "drifted" immediately after fresh install
**Status: FIXED** (PR #38 partial, PR #44 complete)

Install manifest hashed source content, but status compared against on-disk translated content. Fix: hash translated content at install time — `buildInlineContent()` for inline adapters, `agentToGitHubAgent()` for Copilot agents.

### BUG 6 (Medium): Cursor `.cursor/skills/` not read by Cursor adapter — 14 skills lost
**Status: FIXED** (PR #37)

Added `readSkillsFromDir` call for `.cursor/skills/` in the Cursor adapter's `read()`.

### BUG 7 (Low): Rule with `globs: null` fails validation
**Status: FIXED** (PR #37)

Added `.nullable().transform()` to globs field in Zod schema — `null` treated as `undefined`.

### BUG 8 (Low): Standards adapter not tracked in manifest for instructions-only installs
**Status: FIXED** (PR #38)

### BUG 9: agnix AGENTS.md uses custom YAML frontmatter
**Status: DEFERRED** — agnix upstream issue, added to known gaps.

### BUG 10 (Medium): MCP version pins lost during dedup
**Status: FIXED** (PR #42)

When both Standards and another adapter had the same MCP server, the pinned version (e.g. `@2025.4.8`) was discarded. Fix: prefer version-pinned args via `hasVersionPins()` heuristic.

### BUG 11 (Medium): Status drift for inline agents and Copilot agent translation
**Status: FIXED** (PR #44)

Install manifest used raw agent content, but status read translated content. Fix: instructions hash uses `buildInlineContent()` for inline adapters; agent hashes use `agentToGitHubAgent()` for Copilot; only records agent hashes for `"native"` adapters.

### BUG 12 (Medium): Copilot rule applyTo→globs translation lost in content
**Status: FIXED** (PR #45)

Copilot reader stored raw file content (with `applyTo`) but portable frontmatter (with `globs`). Claude Code's `ruleToClaudeFormat` parsed the content, not frontmatter, losing the translation. Fix: rebuild content with portable frontmatter via `matter.stringify`.

### BUG 13: agnix MCP uses custom format
**Status: DEFERRED** — agnix upstream issue, added to known gaps.

### BUG 14 (Medium): Codex .toml agents not collected
**Status: FIXED** (PR #46)

Codex agents use `.toml` format with `developer_instructions`, `model`, `sandbox_mode` fields. Added `readAgentsFromToml()` to parse TOML agent files and map to portable `AgentEntry` format.

### BUG 15 (Medium): `pit init` hangs with piped/non-interactive stdin
**Status: FIXED** (PR #47)

Added `--yes` and `--name` flags for non-interactive use. Extracted `parseManifest()` and `buildInstructionsContent()` helpers.

### BUG 16 (Medium): Codex adapter self-inflicts drift via shared AGENTS.md
**Status: FIXED** (PR #48)

Both Codex and Standards adapters claimed AGENTS.md. Fix: Codex detection now requires `.codex/` directory to exist, preventing false detection on Standards-only projects.

### BUG 17 (Medium): Standards MCP version pins lost during collect
**Status: FIXED** (PR #49)

The wholesale Standards MCP wipe (`config.mcpServers = {}`) discarded version-pinned servers before the merger could see them. Fix: per-server dedup that preserves Standards servers with version pins.

### BUG 18 (Medium): Standards HTTP MCP servers dropped during collect
**Status: FIXED** (PR #49)

HTTP servers (url-based, e.g. `https://mcp.exa.ai/mcp`) only existed in Standards and were wholesale-wiped. Fix: per-server dedup preserves Standards-only servers. Also added HTTP server support to TOML reader.

### BUG 19 (Low): Verbose dry-run diffs not shown for new file creates
**Status: FIXED** (PR #49)

The `result.existed` guard in `markersDryRunEntry` prevented diffs for newly created files. Removed the guard so both creates and modifies show verbose diffs.

### BUG 20 (Low): MCP overwrite warnings on idempotent re-install
**Status: FIXED** (PR #49)

Re-installing the same stack triggered spurious "overwriting" warnings. Fix: `warnMcpOverwrites()` uses `computeMcpServerHash()` for key-order-independent comparison, skipping warnings for identical content.

### BUG 21: Cursor globs comma-separated string
**Status: NOT A BUG** — Cursor reader already splits comma-separated globs back to arrays.

---

## QA Round 3 Findings (post-fix validation)

After all 18 fixes landed, ran agent-based QA across all 9 repos. 7/9 fully clean. New findings:

### BUG 22 (High): Codex TOML writer drops `url` field for HTTP MCP servers
**Status: OPEN**

`writeMcpToToml()` in `toml-utils.ts` only writes `command`/`args`/`env` fields. HTTP/SSE servers (url-only, e.g. `exa`) lose their config on Codex install. The `readMcpFromToml()` correctly reads `url`/`serverUrl` (fixed in PR #49), but the writer doesn't round-trip them.

**Repo affected:** everything-claude-code (exa MCP server)

### BUG 23 (Medium): Codex config.toml drift after install
**Status: OPEN**

Installing MCP to an existing `config.toml` strips comments and reformats the file. The hash computed at install time doesn't match the on-disk content after TOML serialization, causing immediate drift in `pit status`.

**Repo affected:** everything-claude-code

### BUG 24 (Medium): Rule duplication on install into source repo
**Status: OPEN**

When installing back into a repo that already has rules, `rule-` prefixed copies are created alongside the originals (e.g. `general.mdc` + `rule-general.mdc`). Technically correct (pit manages `rule-` prefixed files), but confusing for users doing collect→install round-trips.

**Repos affected:** positron, speckle-server, snyk-intellij-plugin

### BUG 25 (Low): Standalone skill .md files not collected
**Status: OPEN**

Skills that are single `.md` files in `.claude/skills/` (not in a subdirectory with `SKILL.md`) are silently dropped by `readSkillsFromDir()` which only globs `*/SKILL.md`.

**Repo affected:** positron (`review-upstream-merge.md`)

### BUG 26 (Low): Validator false positives on cross-platform tool/model names
**Status: OPEN**

CC-AG-009 flags Copilot-native tool names (`agent/runSubagent`, `vscode/extensions`) and CC-AG-003 flags Codex model names (`gpt-5.4`) as errors. The validator only knows Claude Code's allowlist.

**Repos affected:** positron, azure-sdk-for-js, apm, everything-claude-code

---

## Remaining Gaps

### GAP 1 (High): Commands directories not collected — 46+ files lost
`.claude/commands/*.md` and `.codex/commands/*.md` are slash commands. pit doesn't collect them.

### GAP 2 (Medium): Skills only port SKILL.md, companion files lost
`readSkillsFromDir` only reads `*/SKILL.md`. Companion files (scripts, configs) in skill directories are lost.

### GAP 3 (Medium): Codex skills untested (no public repos use them)
No public repo has `.codex/skills/*/SKILL.md`. The Codex ecosystem uses `.codex/commands/` and `.codex/agents/` instead.

### GAP 4 (Low): Claude Code settings.json permissions/hooks not ported
spotlight has a rich `.claude/settings.json` with `permissions`, `hooks`, and `enabledMcpServers`. Only `mcpServers` is collected.

### GAP 5 (Low): Large file size not reported
KurrentDB has a 25.1KB CLAUDE.md. No warning about unusually large instruction files.

### GAP 6: agnix uses non-standard formats
agnix AGENTS.md has custom YAML frontmatter and non-standard MCP config. Out of scope for pit.

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Bugs found | 20 | 26 |
| Bugs fixed | 0 | 18 |
| Bugs deferred | 0 | 2 (agnix upstream) |
| Bugs open | 0 | 5 (QA round 3) |
| Not a bug | 0 | 1 |
| Tests | 83/91 passing | 91/91 passing |
| Unit tests | ~350 | 433 |
| PRs shipped | 0 | 13 (#37–#49) |

### Fixes by PR

| PR | Title | Bugs Fixed |
|----|-------|-----------|
| #37 | fix: infer name/description defaults for rules and agents | 1, 2, 6, 7 |
| #38 | fix: status drift and manifest tracking | 5 (partial), 8 |
| #39 | fix: copilot adapter reads .instructions.md from subdirectories | (coverage) |
| #40 | fix: parse JSONC comments in MCP config files | 3 |
| #41 | fix: standards MCP not suppressed when other adapters read zero servers | 4 |
| #42 | fix: prefer version-pinned MCP servers during dedup | 10 |
| #43 | fix: preserve adapter-specific agent fields during collection | (agent passthrough) |
| #44 | fix: hash translated content in install manifest to prevent status drift | 5 (complete), 11 |
| #45 | fix: rebuild Copilot rule content with portable globs instead of applyTo | 12 |
| #46 | feat: collect Codex .toml agents from .codex/agents/ | 14 |
| #47 | feat: add --yes and --name flags to pit init | 15 |
| #48 | fix: require .codex/ directory for Codex adapter detection | 16 |
| #49 | fix: preserve MCP version pins and HTTP servers during collect dedup | 17, 18, 19, 20 |
