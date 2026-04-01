# User Stories Research — Design Spec

**Date:** 2026-04-01
**Goal:** Enumerate real-world user journeys for pit CLI, verify each works end-to-end, identify gaps, and produce a test backlog.

## Approach

Hybrid: persona-based narrative journeys cross-referenced against a command coverage matrix. Each journey is tagged with support status, test coverage, and priority to serve as a QA reference, gap analysis, and test backlog simultaneously.

---

## Personas

| # | Persona | Context | Primary Goal |
|---|---------|---------|-------------|
| 1 | **Solo Dev** | Uses 1-2 AI tools, personal projects | Bundle config once, use across tools |
| 2 | **Team Lead** | 10-person team, standardized tooling | Ensure every dev has the same AI config on clone |
| 3 | **New Hire** | Day 1, unfamiliar with the project's AI setup | Get fully configured with one command |
| 4 | **Open Source Maintainer** | Publishes a repo others clone | Ship AI config that "just works" for contributors |
| 5 | **Stack Consumer** | Installs someone else's stack (GitHub, local) | Use a curated stack they didn't author |
| 6 | **CI/CD Pipeline** | Automated checks in PR flow | Block merges when AI config drifts |
| 7 | **Tool Migrator** | Moving from Cursor to Claude Code (or adding a tool) | Carry config to a new tool without manual rewrite |
| 8 | **Skill Author** | Develops custom skills for their team | Write skills once, distribute via pit to all tools |
| 9 | **Multi-Stack User** | Uses a base company stack + team-specific overlay | Compose stacks without conflicts |

---

## Journey Template

Each journey follows this structure:

```
## Journey N: [Title]
**Persona:** [who]
**Preconditions:** [what's true before they start]
**Goal:** [what they're trying to accomplish]

### Steps
1. [action] → [expected outcome]
2. [action] → [expected outcome]

### Tags
- Status: supported | partial | unsupported
- Test coverage: tested | untested | partial
- Priority: P0 (core) | P1 (important) | P2 (nice-to-have)
- Commands exercised: [list]
```

---

## Journeys

### Solo Dev

#### Journey 1: First-Time Bundle
**Persona:** Solo Dev
**Preconditions:** Has a project with Claude Code and Cursor configs scattered across native config files.
**Goal:** Bundle all AI configs into a single portable stack and verify the round-trip.

**Steps:**
1. Run `pit collect --dry-run --verbose` → Preview what would be bundled, see unified diffs
2. Run `pit collect` → `.promptpit/` created with `stack.json`, `agent.promptpit.md`, `skills/`, `mcp.json`
3. Run `pit install` → Configs written back to tool-native paths via idempotent markers
4. Run `pit status` → Everything shows `synced`
5. Commit `.promptpit/` to git

**Tags:**
- Status: supported
- Test coverage: tested (round-trip.test.ts + round-trip-dedup.test.ts)
- Priority: P0
- Commands: `collect`, `collect --dry-run --verbose`, `install`, `status`

---

#### Journey 2: Add a New Tool
**Persona:** Solo Dev
**Preconditions:** Has a pit stack installed. Installs Codex CLI for the first time.
**Goal:** Get Codex configured from the existing stack without touching other tools' configs.

**Steps:**
1. Install Codex CLI (external)
2. Run `pit install` → Codex gets configured (AGENTS.md, .codex/skills/, config.toml). Claude Code and Cursor configs unchanged.
3. Run `pit status` → All three tools show `synced`

**Tags:**
- Status: supported
- Test coverage: tested (journeys-solo-dev.test.ts "install adds a new adapter without touching existing ones")
- Priority: P1
- Commands: `install`, `status`

---

#### Journey 3: Manual Edit Detection
**Persona:** Solo Dev
**Preconditions:** Has a pit stack installed and synced.
**Goal:** Detect and decide how to handle a manual edit to a tool config.

**Steps:**
1. Edit `.cursorrules` by hand (outside of pit)
2. Run `pit status` → Shows `drifted` for Cursor adapter
3. Decision fork:
   - Run `pit collect` → Adopts the manual change into the stack
   - Run `pit install` → Reverts to the stack version

**Tags:**
- Status: supported
- Test coverage: tested (round-trip-dedup.test.ts "status detects drifted skill after manual edit")
- Priority: P0
- Commands: `status`, `collect` or `install`

---

#### Journey 29: Scaffold from Scratch
**Persona:** Solo Dev
**Preconditions:** New project, no AI tool configs exist yet.
**Goal:** Create a pit stack skeleton to start building from.

**Steps:**
1. Run `pit init` → Interactive prompts for name, version, description, author
2. `.promptpit/` created with `stack.json` skeleton and `skills/` directory
3. Manually add instructions to `agent.promptpit.md`, add skills, configure MCP
4. Run `pit install` → Tools configured from the hand-built stack

**Tags:**
- Status: supported
- Test coverage: tested (init.test.ts covers interactive scaffold)
- Priority: P1
- Commands: `init`, `install`

---

### Team Lead

#### Journey 4: Standardize Team Config
**Persona:** Team Lead
**Preconditions:** Multi-tool project with configs for Claude Code, Cursor, and Copilot.
**Goal:** Create a canonical stack and enforce it across the team.

**Steps:**
1. Run `pit collect` → Bundles all tool configs into `.promptpit/`
2. Add `pit check` to CI pipeline (e.g., GitHub Actions)
3. Commit `.promptpit/` and push
4. Tell the team: "Run `pit install` after pulling"

**Tags:**
- Status: supported
- Test coverage: partial (collect.test.ts + check.test.ts tested individually, not as a combined flow)
- Priority: P0
- Commands: `collect`, `check`

---

#### Journey 5: Update the Stack
**Persona:** Team Lead
**Preconditions:** Team has a pit stack in CI. Lead adds a new MCP server.
**Goal:** Update the bundle so the team gets the new server.

**Steps:**
1. Add MCP server to `.claude/settings.json`
2. Run `pit collect` → Stack updated with new MCP server (secrets stripped)
3. Run `pit install` → Verify it installs correctly locally
4. Push → CI passes (`pit check` sees fresh stack + matching install)

**Tags:**
- Status: supported
- Test coverage: tested (journeys-team-ci.test.ts "collect after config change updates the bundle")
- Priority: P0
- Commands: `collect`, `install`, `check`

---

#### Journey 6: Enforce Compliance
**Persona:** Team Lead (via CI)
**Preconditions:** Stack was updated, a dev pushes without re-installing.
**Goal:** CI blocks the merge because config is stale.

**Steps:**
1. Team lead updates stack and pushes
2. Dev pulls but forgets to run `pit install`
3. Dev pushes their branch
4. CI runs `pit check` → Exits non-zero (freshness check fails: `installed.json` version < `stack.json` version)
5. PR blocked until dev runs `pit install` and pushes

**Tags:**
- Status: supported
- Test coverage: tested (journeys-team-ci.test.ts "check fails when stack updated but not re-installed" + check.test.ts)
- Priority: P0
- Commands: `check`

---

### New Hire

#### Journey 7: Day-One Onboarding
**Persona:** New Hire
**Preconditions:** Clones a repo that has `.promptpit/` committed. Has Claude Code and Cursor installed.
**Goal:** Get fully configured with one command.

**Steps:**
1. Clone the repo
2. Run `pit install` → Claude Code gets CLAUDE.md + skills + MCP. Cursor gets .cursorrules + .cursor/rules/ + .cursor/mcp.json.
3. Run `pit status` → Everything shows `synced`
4. Start working — AI tools have full project context

**Tags:**
- Status: supported
- Test coverage: tested (install-status-integration.test.ts "install with skills + MCP + instructions")
- Priority: P0
- Commands: `install`, `status`

---

#### Journey 8: Partial Tooling
**Persona:** New Hire
**Preconditions:** Clones repo with `.promptpit/`. Only has Claude Code (not Cursor or Codex).
**Goal:** Get configured without errors for missing tools.

**Steps:**
1. Clone the repo
2. Run `pit install` → Claude Code configured. Other tools silently skipped (no errors).
3. Run `pit status` → Claude Code shows `synced`. Other adapters not listed (or listed as `not detected`).

**Tags:**
- Status: supported
- Test coverage: tested (journeys-onboarding.test.ts "install succeeds with only one tool present")
- Priority: P0
- Commands: `install`, `status`

---

### Open Source Maintainer

#### Journey 9: Ship Config with the Repo
**Persona:** Open Source Maintainer
**Preconditions:** Has an OSS repo with Claude Code instructions and skills for contributors.
**Goal:** Make AI config available to anyone who clones.

**Steps:**
1. Run `pit collect` → Bundles config into `.promptpit/`
2. Commit `.promptpit/`
3. Add to README: "Run `pit install` to configure your AI tools"
4. Contributors clone and install — get the maintainer's curated setup

**Tags:**
- Status: supported
- Test coverage: tested (same as journey 1 — collect.test.ts + round-trip.test.ts)
- Priority: P1
- Commands: `collect`

---

#### Journey 10: Contributor Without Pit
**Persona:** Open Source Maintainer (concerned about contributors who don't have pit)
**Preconditions:** Repo has `.promptpit/` committed. Contributor doesn't have pit installed.
**Goal:** Nothing breaks; the config is inert.

**Steps:**
1. Contributor clones the repo
2. `.promptpit/` directory exists but does nothing — it's just files
3. Contributor can manually read `agent.promptpit.md` for instructions if they want
4. No errors, no unexpected behavior

**Tags:**
- Status: supported
- Test coverage: N/A (inert by design — no pit code runs, nothing to test)
- Priority: P1
- Commands: (none — this is a non-user of pit)

---

### Stack Consumer

#### Journey 11: Install from GitHub
**Persona:** Stack Consumer
**Preconditions:** Knows about a published stack at `github:company/ai-stack@v2.0`.
**Goal:** Install it into their local project.

**Steps:**
1. Run `pit install github:company/ai-stack@v2.0` → Pit clones the repo, finds or auto-collects `.promptpit/`, installs locally
2. Run `pit status` → Shows installed stack with version info
3. Tools configured with the remote stack's instructions, skills, and MCP servers

**Tags:**
- Status: supported
- Test coverage: partial (github.test.ts tests URL parsing only; no E2E for full clone + install flow)
- Priority: P1
- Commands: `install` (GitHub source)

---

#### Journey 12: Install Globally
**Persona:** Stack Consumer
**Preconditions:** Wants a base config applied to all projects, not just one.
**Goal:** Install a stack at the user level.

**Steps:**
1. Run `pit install github:company/base-config --global` → Writes to `~/.claude/`, `~/.cursor/`, etc.
2. Every new project inherits the global config
3. Per-project stacks can layer on top

**Tags:**
- Status: supported
- Test coverage: untested (--global flag exists, no E2E for global install)
- Priority: P1
- Commands: `install --global`

---

#### Journey 13: Inspect Before Installing
**Persona:** Stack Consumer
**Preconditions:** Downloaded or cloned a stack from an untrusted source.
**Goal:** Verify it's safe before installing.

**Steps:**
1. Run `pit validate path/to/.promptpit/` → Checks stack.json schema, skill frontmatter, MCP config
2. Manually review `mcp.json` for suspicious servers
3. Check `.env.example` for required secrets
4. If satisfied, run `pit install`

**Tags:**
- Status: supported
- Test coverage: partial (validate.test.ts covers stack schema + skill validation, not the "inspect then install" full flow)
- Priority: P1
- Commands: `validate`

---

### CI/CD Pipeline

#### Journey 14: Freshness Gate
**Persona:** CI/CD Pipeline
**Preconditions:** PR opened. Stack was updated in an earlier commit but install wasn't re-run.
**Goal:** Catch stale installs before merge.

**Steps:**
1. CI runs `pit check`
2. Freshness check: compares `stack.json` version to `installed.json` version
3. Mismatch → exit code 1, PR blocked
4. Dev runs `pit install`, pushes → CI passes

**Tags:**
- Status: supported
- Test coverage: tested (check.test.ts covers version mismatch + "never been installed" + missing skill freshness)
- Priority: P0
- Commands: `check`

---

#### Journey 15: Drift Gate
**Persona:** CI/CD Pipeline
**Preconditions:** PR opened. Someone hand-edited a tool config after install.
**Goal:** Catch unauthorized manual edits.

**Steps:**
1. CI runs `pit check`
2. Drift check: recomputes SHA-256 of on-disk files, compares to `installed.json` hashes
3. Mismatch → exit code 1, PR blocked
4. Dev runs `pit install` (or `pit collect` to adopt changes), pushes → CI passes

**Tags:**
- Status: supported
- Test coverage: tested (check.test.ts covers drift detection for skills, instructions, and MCP)
- Priority: P0
- Commands: `check`

---

#### Journey 16: JSON Output for Automation
**Persona:** CI/CD Pipeline
**Preconditions:** CI needs machine-parseable results for custom logic (e.g., Slack alerts, dashboard).
**Goal:** Get structured output from pit commands.

**Steps:**
1. Run `pit check --json` → JSON with pass/fail per check
2. Run `pit status --json` → JSON with per-file sync state
3. Parse output in CI script for custom actions (e.g., post comment on PR with drift details)

**Tags:**
- Status: supported
- Test coverage: tested (check.test.ts "--json produces valid JSON"; install-status-integration.test.ts uses status --json throughout)
- Priority: P1
- Commands: `check --json`, `status --json`

---

### Tool Migrator

#### Journey 17: Migrate Config to a New Tool
**Persona:** Tool Migrator
**Preconditions:** Used Cursor exclusively. Now adding Claude Code to their workflow.
**Goal:** Get Claude Code configured from existing Cursor config without manual translation.

**Steps:**
1. Run `pit collect` → Captures Cursor config into `.promptpit/`
2. Run `pit install` → Claude Code gets translated config (CLAUDE.md, .claude/skills/, .claude/settings.json)
3. Run `pit status` → Both Cursor and Claude Code show `synced`

**Tags:**
- Status: supported
- Test coverage: tested (journeys-onboarding.test.ts "collect from Cursor project installs into Claude Code")
- Priority: P1
- Commands: `collect`, `install`, `status`

---

#### Journey 18: Drop a Tool
**Persona:** Tool Migrator
**Preconditions:** Had Codex CLI configured via pit. Uninstalls Codex.
**Goal:** pit handles the missing tool gracefully.

**Steps:**
1. Uninstall Codex CLI (external)
2. Run `pit status` → Codex shows as not detected or `removed-by-user`, not as an error
3. Other tools unaffected

**Tags:**
- Status: partial
- Test coverage: untested (status shows R for removed-by-user markers, but no explicit "tool uninstalled" scenario test)
- Priority: P2
- Commands: `status`

---

### Skill Author

#### Journey 19: Create and Distribute a Skill
**Persona:** Skill Author
**Preconditions:** Has a project with pit installed.
**Goal:** Write a custom skill and distribute it to all tools via pit.

**Steps:**
1. Create `.agents/skills/my-skill/SKILL.md` with proper frontmatter
2. Run `pit collect` → Skill appears in `.promptpit/skills/my-skill/SKILL.md`
3. Push → Team runs `pit install` → Skill lands in every tool's native format (symlink for Claude Code, .mdc for Cursor, etc.)

**Tags:**
- Status: supported
- Test coverage: tested (journeys-skill-author.test.ts "skill in .agents/skills/ is collected and distributable" + skill-store.test.ts + round-trip.test.ts)
- Priority: P1
- Commands: `collect`, `install`

---

#### Journey 20: Live Skill Development
**Persona:** Skill Author
**Preconditions:** Has pit installed. Working on a skill iteratively.
**Goal:** See changes reflected in all tools instantly without re-running install.

**Steps:**
1. Run `pit watch`
2. Edit `.agents/skills/my-skill/SKILL.md`
3. Changes auto-propagate to `.cursor/rules/`, `.github/instructions/`, etc.
4. Manifest hashes updated automatically
5. Stop watch when done

**Tags:**
- Status: supported
- Test coverage: untested (watch command exists, no E2E — file-watching is hard to test deterministically)
- Priority: P1
- Commands: `watch`

---

#### Journey 21: Skill Validation
**Persona:** Skill Author
**Preconditions:** Has written multiple skills, wants to verify they're well-formed.
**Goal:** Catch skill authoring errors before distributing.

**Steps:**
1. Run `pit validate` → Checks skill frontmatter, unique names, required fields
2. Fix any reported errors
3. Run `pit validate` again → Clean pass

**Tags:**
- Status: supported
- Test coverage: tested (validate.test.ts covers skill frontmatter, schema errors, JSON output)
- Priority: P1
- Commands: `validate`

---

### Multi-Stack User

#### Journey 22: Compose Base + Team Stack
**Persona:** Multi-Stack User
**Preconditions:** Company publishes a base stack. Team has an additional overlay stack.
**Goal:** Install both without conflicts.

**Steps:**
1. Run `pit install github:company/base-stack` → Base config installed with markers `<!-- promptpit:start:base-stack:1.0:... -->`
2. Run `pit install github:team/frontend-stack` → Team config installed with different markers
3. Both coexist in the same files via idempotent markers
4. Run `pit status` → Both stacks show `synced`

**Tags:**
- Status: supported
- Test coverage: tested (install-status-integration.test.ts "two stacks installed → status shows both with correct counts")
- Priority: P1
- Commands: `install` (multiple), `status`

---

#### Journey 23: Stack Conflict Detection
**Persona:** Multi-Stack User
**Preconditions:** Two stacks define the same MCP server with different configs.
**Goal:** Pit surfaces the conflict rather than silently picking one.

**Steps:**
1. Install stack A (has MCP server "db" with config X)
2. Install stack B (has MCP server "db" with config Y)
3. Pit warns or errors about the conflicting MCP server definition
4. User decides which to keep

**Tags:**
- Status: partial
- Test coverage: untested (MCP merge warns on conflict in merger.ts, but conflict surfacing at install is not clearly tested)
- Priority: P2
- Commands: `install`

---

#### Journey 24: Selective Re-Install
**Persona:** Multi-Stack User
**Preconditions:** Has two stacks installed. Only the team stack was updated.
**Goal:** Re-install only the updated stack, leave the other untouched.

**Steps:**
1. Team stack gets a new version
2. Run `pit install path/to/team-stack/.promptpit/` → Only team stack markers replaced (matched by stack name in markers)
3. Base stack markers and content untouched
4. Run `pit status` → Both show `synced`

**Note:** This requires pit to selectively replace only markers matching the installed stack name. Verify whether current install logic handles this or overwrites all markers.

**Tags:**
- Status: supported
- Test coverage: tested (journeys-edge-cases.test.ts "re-installing one stack does not clobber another")
- Priority: P2
- Commands: `install`, `status`

---

### Cross-Cutting Edge Cases

#### Journey 25: Empty Project
**Persona:** Any
**Preconditions:** Project has no AI tool configs at all.
**Goal:** `pit collect` handles gracefully.

**Steps:**
1. Run `pit collect` in a project with no `.claude/`, `.cursor/`, `.codex/`, etc.
2. Pit reports "no tool configs found" with a helpful message
3. No crash, no empty `.promptpit/` created

**Tags:**
- Status: supported
- Test coverage: tested (collect.test.ts "errors when no AI tools detected" — throws with helpful message, no crash)
- Priority: P1
- Commands: `collect`

---

#### Journey 26: Corrupted Manifest
**Persona:** Any
**Preconditions:** `installed.json` is malformed JSON.
**Goal:** Pit handles gracefully with a clear error.

**Steps:**
1. Corrupt `installed.json` (e.g., truncated, invalid JSON)
2. Run `pit status` → Reports "manifest corrupted" or similar, doesn't throw stack trace
3. Suggests re-running `pit install` to regenerate

**Tags:**
- Status: supported (computeStatus catches parse errors, returns empty result with hasManifest: false)
- Test coverage: tested (journeys-edge-cases.test.ts "status handles corrupted installed.json gracefully")
- Priority: P2
- Commands: `status`

---

#### Journey 27: Secrets in MCP Config
**Persona:** Any (especially Team Lead, OSS Maintainer)
**Preconditions:** MCP config contains real API keys.
**Goal:** `pit collect` strips secrets before bundling.

**Steps:**
1. `.claude/settings.json` has MCP server with `"OPENAI_API_KEY": "sk-abc123..."` in env
2. Run `pit collect` → `mcp.json` has `"OPENAI_API_KEY": "${OPENAI_API_KEY}"` (placeholder)
3. `.env.example` lists `OPENAI_API_KEY=` as required
4. No real secrets in `.promptpit/`

**Tags:**
- Status: supported
- Test coverage: tested (security.test.ts covers stripSecrets — URL credentials + API key patterns + safe values)
- Priority: P0
- Commands: `collect`

---

#### Journey 28: Re-Install Idempotency
**Persona:** Any
**Preconditions:** Stack is installed and synced.
**Goal:** Running install again produces identical results.

**Steps:**
1. Run `pit install` → Config written with markers
2. Run `pit install` again → Exact same files, no duplicate markers, no doubled content
3. Run `pit status` → `synced`
4. `git diff` → No changes

**Tags:**
- Status: supported
- Test coverage: tested (round-trip-dedup.test.ts "re-install replaces manifest entry (upsert)" + install-status-integration.test.ts "re-install updates manifest without duplicating entries")
- Priority: P0
- Commands: `install`, `status`

---

## Command Coverage Matrix

| Command / Capability | Journeys |
|---|---|
| `pit init` | 29 |
| `pit collect` | 1, 4, 5, 9, 17, 19, 25, 27 |
| `pit collect --dry-run --verbose` | 1 |
| `pit install` (local) | 1, 2, 4, 5, 7, 8, 19, 22, 24, 28, 29 |
| `pit install` (GitHub) | 11, 22 |
| `pit install --global` | 12 |
| `pit status` | 2, 3, 7, 8, 17, 18, 22, 24, 28 |
| `pit status --json` | 16 |
| `pit watch` | 20 |
| `pit validate` | 13, 21 |
| `pit check` | 4, 6, 14, 15 |
| `pit check --json` | 16 |
| Secret stripping | 27 |
| Idempotent markers | 22, 28 |
| Multi-stack coexistence | 22, 23, 24 |
| Graceful error handling | 8, 10, 18, 25, 26 |
| Adapter translation | 2, 7, 17, 19 |
| Skill distribution | 19, 20, 21 |

---

## Findings

### Summary

- **29 journeys** across 9 personas
- **22 supported + tested** (including 11 new E2E tests added during this verification)
- **4 supported + untested** (not feasible to E2E test — see below)
- **2 partial** (gaps identified — see below)
- **1 N/A** (Journey 10 — non-user of pit, inert by design)

### Gaps Identified

| Journey | Issue | Severity | Recommendation |
|---------|-------|----------|----------------|
| 18. Drop a tool | Status shows `removed-by-user` for deleted markers but no explicit handling for "tool was uninstalled" | P2 | Consider graceful skip when adapter paths no longer exist |
| 23. Stack conflict detection | MCP merge warns on conflict in merger.ts but warnings aren't surfaced clearly at install time | P2 | Surface MCP server name conflicts as visible warnings during `pit install` |

### Not Testable as E2E

| Journey | Reason |
|---------|--------|
| 10. Contributor without pit | Non-user — .promptpit/ is inert by design, nothing to test |
| 11. Install from GitHub | Requires network access (git clone) |
| 12. Install globally | Requires writing to user home directory (~/.claude, ~/.cursor) |
| 20. Live skill development | Watch command requires filesystem watcher timing, hard to test deterministically |

### New E2E Tests Added

| Test File | Journeys Covered |
|-----------|-----------------|
| `test/e2e/journeys-solo-dev.test.ts` | 2, 25, 29 |
| `test/e2e/journeys-team-ci.test.ts` | 5, 6/14, 15 |
| `test/e2e/journeys-onboarding.test.ts` | 8, 17 |
| `test/e2e/journeys-edge-cases.test.ts` | 24, 26, 28 |
| `test/e2e/journeys-skill-author.test.ts` | 19 |

### Key Discovery

Journey 26 (corrupted manifest) was originally tagged as `partial` — we assumed `readManifest` would throw on invalid JSON. Testing revealed that `computeStatus` in `status.ts` already catches the error and returns `{ stacks: [], hasManifest: false }`, making this fully supported.
