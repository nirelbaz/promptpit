# Real-World Validation Report

## Test Suite

9 repos, all 5 adapters covered, 91 tests (83 passed, 8 failed).

Test file: `test/e2e/real-world-repos.test.ts`

## Repos Tested

| Repo | Stars | Adapters | Skills | Agents | Rules | MCP |
|------|-------|----------|--------|--------|-------|-----|
| posit-dev/positron | 4,039 | Claude Code, Copilot | 7 CC skills | 3 Copilot agents | 2 CC rules, 9 Copilot instructions | 2 (.vscode/mcp.json) |
| specklesystems/speckle-server | 786 | Cursor, Copilot | 0 | 0 | 4 .mdc, 7 instructions | 1 (.cursor/mcp.json) |
| Azure/azure-sdk-for-js | 2,287 | Claude Code, Copilot, Codex | 0 | 8 Copilot agents | 0 | 2 (.vscode/mcp.json) |
| microsoft/apm | 925 | Copilot | 0 | 6 Copilot agents | 6 instructions | 1 |
| ModelEngine-Group/fit-framework | 2,107 | Codex, Claude Code | 0 | 0 | 0 | 0 |
| affaan-m/everything-claude-code | 134,793 | Claude Code, Cursor, Codex, Standards | 1 CC + 10 Cursor | 0 | 39 Cursor + 2 CC | 6 (.mcp.json) |
| kurrent-io/KurrentDB | 5,765 | Claude Code, Standards | 0 | 0 | 0 | 4-8 (.mcp.json + .claude) |
| getsentry/spotlight | 573 | Claude Code, Cursor, Codex, Standards | 0 | 0 | 0 | 2 (.mcp.json) |
| snyk/snyk-intellij-plugin | 65 | Cursor | 4 Cursor skills | 0 | 1 .mdc | 0 |

## Coverage Matrix (collected vs source)

```
Repo                                Adapters                               Skills       Agents       Rules        MCP
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
posit-dev/positron                  claude-code, codex, standards, copilot  7/7          1/3 (-2)     0/11 (-11)   0/1 (-1)
specklesystems/speckle-server       cursor, copilot                        0/0          0/0          0/11 (-11)   1/1
Azure/azure-sdk-for-js              claude-code, codex, standards, copilot  0/0          0/8 (-8)     0/0          2/2
microsoft/apm                       copilot                                0/0          3/6 (-3)     0/6 (-6)     1/1
ModelEngine-Group/fit-framework     claude-code, codex, standards           0/0          0/0          0/0          0/0
affaan-m/everything-claude-code     claude-code, cursor, codex, standards   1/11 (-10)   0/0          0/41 (-41)   5/6 (-1)
kurrent-io/KurrentDB                claude-code, standards                  0/0          0/0          0/0          4/8 (-4)
getsentry/spotlight                 claude-code, cursor, codex, standards   0/0          0/0          0/0          0/2 (-2)
snyk/snyk-intellij-plugin           cursor                                 0/4 (-4)     0/0          0/1 (-1)     0/0
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL DROPPED                                                              14           13           70           8
```

**pit is currently dropping 105 artifacts across 9 real-world repos.**

---

## Bugs Found

### BUG 1 (Critical): Rules without `name` frontmatter silently dropped — 70 rules lost

**Repos affected:** ALL repos with rules (positron, speckle-server, apm, everything-claude-code, snyk)

Real-world rules from Claude Code, Cursor, and Copilot use native frontmatter:
- Claude Code: `paths: [...]` (no `name`, no `description`)
- Cursor .mdc: `description: ...`, `globs: ...` (no `name`)
- Copilot: `description: ...`, `applyTo: ...` (no `name`)

pit's `ruleFrontmatterSchema` requires both `name` and `description`. The collect step writes rules to the bundle (adapters have their own parsing), but `readStack()` and `validateStack()` reject every single rule because the portable format requires `name`.

**Impact:** 70 rules across all tested repos are silently dropped. Zero rules survive the collect→install pipeline.

**Fix:** Infer `name` from filename (already done for skills). Make `description` optional or infer from first paragraph.

---

### BUG 2 (Critical): Agents without `name` frontmatter silently dropped — 13 agents lost

**Repos affected:** Azure/azure-sdk-for-js (8/8 dropped), microsoft/apm (3/6 dropped), positron (2/3 dropped)

Real-world Copilot agents use:
```yaml
---
description: Expert in public API design...
tools: ["read", "search", "bash"]
---
```

No `name` field. pit's `agentFrontmatterSchema` requires `name`. Agents without it are skipped.

Note: microsoft/apm has 3 of 6 agents that DO include `name` — confirming it's inconsistent across repos.

**Fix:** Infer `name` from filename (strip `.agent.md` extension).

---

### BUG 3 (Medium): JSONC not parsed — MCP servers lost in VS Code ecosystem

**Repos affected:** positron (2 MCP servers lost)

`.vscode/mcp.json` commonly contains JavaScript-style comments (`// ...`). `JSON.parse()` fails silently.

**Fix:** Use a JSONC parser (`strip-json-comments` or `jsonc-parser`).

---

### BUG 4 (Medium): Standards MCP suppressed when other adapters read zero MCP — 2+ repos affected

**Repos affected:** spotlight (2 MCP servers lost), everything-claude-code (1 lost), KurrentDB (4 lost)

The collect logic (collect.ts:68-77) clears Standards MCP when any other adapter "supports" MCP — but checks the capability flag, not whether the adapter actually read any servers. When `.claude/settings.json` exists but has no `mcpServers` key, the `.mcp.json` servers are still suppressed.

**Fix:** Only suppress Standards MCP when another adapter actually has non-empty `mcpServers` in its read config.

---

### BUG 5 (Medium): Status shows "drifted" immediately after fresh install

**Repos affected:** positron

`pit status` reports `drifted` for cursor, copilot, and standards adapters right after install. The instructions hash in the manifest is computed from raw `agentInstructions` but the file on disk has marker blocks that alter the hash on re-read.

---

### BUG 6 (Medium): Cursor `.cursor/skills/` not read by Cursor adapter — 14 skills lost

**Repos affected:** snyk-intellij-plugin (4 skills), everything-claude-code (10 skills)

The Cursor adapter reads `.cursor/rules/*.mdc` for rules but does NOT read `.cursor/skills/*/SKILL.md`. This is a valid skill directory used by real repos — snyk has 4 skills (commit, create-implementation-plan, implementation, verification) and everything-claude-code has 10.

**Fix:** Add `readSkillsFromDir` call for `.cursor/skills/` in the Cursor adapter's `read()` function.

---

### BUG 7 (Low): Rule with `globs: null` fails validation

**Repo affected:** snyk-intellij-plugin

The .mdc rule has a frontmatter field that parses as `globs: null`. The Zod schema expects `string | string[]` — `null` is not accepted, causing a validation error: "Expected array, received null".

**Fix:** Accept `null` as equivalent to `undefined` in the globs field (`.nullable()` or `.transform()`).

---

### BUG 8 (Low): Standards adapter not tracked in manifest for instructions-only installs

**Repo affected:** snyk-intellij-plugin

When a stack has only instructions (no skills, agents, rules, or MCP), the Standards adapter writes to `AGENTS.md` but the manifest check `if (record.instructions || record.skills || ...)` may not fire if no adapter-specific config path matches. The test expects Standards to always be tracked but it wasn't for the snyk target.

---

## Gaps Found

### GAP 1 (High): Commands directories not collected — 46+ files lost

**Repos affected:** fit-framework (23 `.codex/commands/` + 23 `.claude/commands/`), positron (`.claude/commands/`)

`.claude/commands/*.md` and `.codex/commands/*.md` are slash commands/custom prompts. pit doesn't collect them at all. This is a major feature gap.

### GAP 2 (High): Cursor skills directory not read

See BUG 6 above. `.cursor/skills/*/SKILL.md` is a real pattern in the wild.

### GAP 3 (Medium): Skills only port SKILL.md, companion files lost

`readSkillsFromDir` only reads `*/SKILL.md`. `installCanonical` only writes `SKILL.md`. Any companion files (scripts, configs, templates) in a skill directory are silently lost.

### GAP 4 (Medium): Codex skills don't exist in the wild

No public repo has `.codex/skills/*/SKILL.md`. The Codex ecosystem uses `.codex/commands/` and `.codex/agents/` instead. The skills feature of the Codex adapter is untested against real-world data.

### GAP 5 (Low): Claude Code settings.json permissions/hooks not ported

spotlight has a rich `.claude/settings.json` with `permissions`, `hooks`, and `enabledMcpServers`. Only `mcpServers` is collected.

---

## UX Issues

### UX 1: Warning spam — "invalid frontmatter (Required, Required)" on valid files

Every rule triggers a "Skipping rule: invalid frontmatter (Required)" warning. This floods the output (100+ warnings across 9 repos). The warning doesn't name the missing fields.

**Fix:** Include field names: "missing required fields: name, description"

### UX 2: Duplicate MCP dedup warnings

Re-collecting from an installed target shows duplicate "MCP server found in multiple tools" warnings.

### UX 3: Large file size not reported

KurrentDB has a 25.1KB CLAUDE.md. No warning or note about unusually large instruction files that may cause issues for some AI tools.

---

## Summary of Required Fixes

| Priority | Issue | Type | Artifacts Lost |
|----------|-------|------|---------------|
| **P0** | Rules without `name` silently dropped | Bug | 70 rules |
| **P0** | Agents without `name` silently dropped | Bug | 13 agents |
| **P0** | Cursor `.cursor/skills/` not read | Bug | 14 skills |
| **P1** | JSONC in .vscode/mcp.json not parsed | Bug | 2+ MCP servers |
| **P1** | Standards MCP suppressed incorrectly | Bug | 8+ MCP servers |
| **P1** | Commands directories not collected | Gap | 46+ files |
| **P2** | Status drifted after fresh install | Bug | — |
| **P2** | Rule `globs: null` fails validation | Bug | 1 rule |
| **P2** | Standards not tracked in manifest edge case | Bug | — |
| **P2** | Multi-file skills lose companion files | Gap | unknown |
| **P2** | Warning messages don't name missing fields | UX | — |
| **P3** | Duplicate MCP warnings | UX | — |
| **P3** | Codex skills untestable (no public repos) | Gap | — |
| **P3** | Claude Code permissions/hooks not ported | Gap | — |

**Total: 105 artifacts silently dropped across 9 real-world repos (14 skills, 13 agents, 70 rules, 8 MCP servers)**
