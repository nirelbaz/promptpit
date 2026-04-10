# Custom Skills: `/develop` and `/ship`

**Date:** 2026-04-10
**Status:** Approved
**Branch:** TBD (next feature branch)

## Problem

The third-party skills we use (superpowers brainstorming/writing-plans/subagent-driven-development, gstack review/ship) work well but cost ~$25 per feature. The procedural intelligence is excellent. The infrastructure overhead (telemetry, dashboards, specialist systems, cross-model voice, 75-line preambles) doubles the cost without adding value for this project.

## Solution

Two custom skills that preserve the gold from 6 source skills while cutting the noise:

- **`/develop`** — design → plan → implement → review → simplify in one session
- **`/ship`** — push, create PR, mark TODOs complete

## What We're Preserving (and from where)

### From superpowers brainstorming
- One question at a time, multiple choice preferred
- Propose 2-3 approaches with trade-offs and recommendation
- YAGNI ruthlessly
- Spec self-review checklist (placeholder scan, consistency, ambiguity, scope)
- Explore existing code before proposing changes

### From gstack office-hours
- Premise challenge: "Is this the right problem? What happens if we do nothing? What existing code already solves this?"
- Builder-mode questions: "What's the fastest path? What existing thing is closest?"
- Smart-skip: if the user's description already answers a question, skip it
- Anti-sycophancy: take a position on every answer, challenge the strongest version

### From superpowers writing-plans
- Exact file paths in every task
- Complete code in every step (no placeholders, no "similar to Task N")
- TDD structure (failing test → verify fail → implement → verify pass → commit)
- Bite-sized granularity (2-5 min per step)
- Self-review against spec (type consistency, coverage)

### From superpowers subagent-driven-development
- Model routing: Sonnet for mechanical tasks, Opus for judgment tasks
- Implementer status protocol (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT)
- "It's OK to stop and escalate" instruction to subagents

### From gstack plan-eng-review
- Scope challenge: "What is the minimum set of changes? >8 files is a smell"
- Engineering preferences: DRY, well-tested, explicit over clever, minimal diff
- Cognitive patterns (selective): boring by default, make the change easy first, essential vs accidental complexity
- Test coverage diagram with codepath tracing (ASCII art)
- Failure modes: "For each new codepath, list one realistic way it could fail"
- TODOS.md cross-reference

### From gstack review checklist
- Shell injection checks (execFile/execFileSync patterns)
- Enum/value completeness (new union values handled everywhere)
- Race conditions (read-check-write without atomic guard)
- Fix-first heuristic: auto-fix mechanical issues, ask only for genuine judgment calls
- File:line citation requirement
- Scope drift detection

### From superpowers simplify
- Three review lenses: reuse, quality, efficiency
- Specific patterns: parameter sprawl, copy-paste variation, redundant computations, duplicated lambdas

## What We're Cutting

- All gstack preambles (75 lines of telemetry, sessions, analytics, learnings, routing, vendoring, proactive mode)
- All gstack infrastructure (gstack-config, gstack-timeline-log, gstack-review-log, gstack-learnings-search)
- Specialist dispatch system (7 parallel subagents for review)
- Red team dispatch
- Cross-model outside voice (Codex integration)
- Review readiness dashboard
- Greptile integration
- Adversarial review subagent
- Visual companion / design exploration
- Startup mode (YC diagnostic)
- Landscape awareness / web search during brainstorming
- Confidence calibration scoring (1-10 per finding)
- Worktree parallelization strategy
- Plan file review report
- Per-task spec reviewers (review once at the end)
- Separate spec review + user review gate (one approval)
- Execution handoff choice (always inline + Sonnet subagents)

---

## Skill 1: `/develop`

**File:** `.claude/commands/develop.md`

### Frontmatter

None. This is a command (`.claude/commands/`), not a skill (`.claude/skills/`). Commands are simpler — plain markdown, no frontmatter required. Matches the project's existing pattern (version.md, release.md, pre-pr-check.md).

### Phases

#### Phase 1: Design

**When to run:** Always, but scaled to the input.

1. Read CLAUDE.md, recent commits (`git log --oneline -10`), and the area of code the feature touches.

2. **Smart-skip assessment.** Read the user's description. If it already specifies:
   - What to build (behavior)
   - Where it goes (files/modules)
   - How it works (approach)
   - Edge cases / error handling

   Then skip clarifying questions and go straight to proposing approaches. Most features from an experienced author will skip.

3. **Premise challenge** (always, even if skipping questions):
   - Is this the right problem? Could a different framing yield a simpler solution?
   - What existing code already partially solves this?
   - What happens if we do nothing?

   If any premise is shaky, say so directly. Take a position.

4. **Clarifying questions** (only if smart-skip didn't trigger): Ask 1-3 questions, one at a time, multiple choice preferred. Focus on: approach decisions with real trade-offs, ambiguous requirements, security model choices.

5. **Propose 2-3 approaches** with trade-offs and a recommendation. Lead with the recommended option and explain why. YAGNI: remove unnecessary features.

6. **Write spec** to `docs/specs/YYYY-MM-DD-<topic>-design.md`. Keep it short — the lifecycle scripts spec was 153 lines, that's about right. Commit it.

7. **Self-review the spec** (inline, no separate pass):
   - Placeholder scan: any TBD, TODO, incomplete sections?
   - Internal consistency: does architecture match feature descriptions?
   - Ambiguity: could any requirement be interpreted two ways?
   - Fix inline, move on.

8. Ask user to review. One approval gate, not two.

#### Phase 2: Plan

**When to run:** After design is approved. No separate skill invocation — this is inline.

1. **Scope check:**
   - What is the minimum set of changes?
   - Does this touch >8 files or introduce >2 new modules? If so, challenge scope.
   - Can any work be deferred without blocking the core objective?

2. **Write implementation plan** to `docs/plans/YYYY-MM-DD-<topic>.md`. Format:

   ```markdown
   # [Feature] Implementation Plan

   **Goal:** One sentence
   **Architecture:** 2-3 sentences
   **Tech Stack:** Key technologies

   ---

   ### Task N: [Name]

   **Files:**
   - Create/Modify: `exact/path`
   - Test: `exact/path`

   - [ ] Step 1: Write the failing test
   [actual test code]

   - [ ] Step 2: Run test, verify fail
   Run: `npm test -- path/to/test`

   - [ ] Step 3: Implement
   [actual implementation code]

   - [ ] Step 4: Run test, verify pass

   - [ ] Step 5: Commit
   ```

   Rules:
   - Exact file paths always
   - Complete code in every step — no placeholders, no "similar to Task N"
   - TDD: test first, then implement
   - One logical change per commit

3. **Self-review plan against spec:**
   - Does every spec requirement have a task?
   - Are types/function names consistent across tasks?
   - Any missing test coverage?

4. Commit the plan. Proceed to implementation.

#### Phase 3: Implement

**When to run:** After plan is written. No user gate — proceed directly.

1. **Model routing.** For each task, decide:

   | Task type | Execution | Why |
   |-----------|-----------|-----|
   | Schema/type additions | Sonnet subagent | Mechanical, clear spec |
   | CLI flag wiring | Sonnet subagent | Copy-paste pattern |
   | Test fixtures | Sonnet subagent | No judgment needed |
   | Core module creation | Inline (Opus) | Design judgment needed |
   | Multi-file integration | Inline (Opus) | Needs codebase context |
   | Fixes from review | Inline (Opus) | Needs full context |

   **Subagent rule:** Only dispatch a Sonnet subagent when the task touches 1-2 files AND the plan has complete code for it. Everything else stays inline.

2. **Subagent briefing template** (for Sonnet subagents):

   ```
   You are implementing Task N: [name]

   ## Task
   [FULL task text from plan — paste it, don't make subagent read the file]

   ## Context
   [1-2 sentences: where this fits, what's already done]

   ## Your Job
   1. Implement exactly what the task specifies (TDD if task says to)
   2. Run tests: npm test -- [specific test file]
   3. Run lint: npm run lint
   4. Commit with: git add [files] && git commit -m "[message]"
   5. Report: Status (DONE/BLOCKED/NEEDS_CONTEXT), what you did, test results, files changed

   If something is unclear or too hard, STOP and report BLOCKED. Bad work is worse than no work.

   Work from: [directory]
   ```

3. **Execute tasks in plan order.** For inline tasks, follow the plan steps directly. For subagent tasks, dispatch and verify results.

4. **No per-task reviews.** Move to the next task after tests pass. Review happens once in Phase 4.

5. After all tasks: run `npm test && npm run lint && npm run build`. All must pass before Phase 4.

#### Phase 4: Review

**When to run:** After all tasks implemented and tests pass. One review pass, not two.

1. **Scope drift check:**
   ```
   Scope Check: [CLEAN / DRIFT / MISSING]
   Intent: [what was requested]
   Delivered: [what the diff does]
   [If drift: list each out-of-scope change]
   [If missing: list each unaddressed requirement]
   ```

2. **Checklist pass.** Read `git diff origin/main -- src/` and check:

   **Critical (flag immediately):**
   - Shell injection: `execSync` or `exec` with string interpolation (should use `execFile` or `execFileSync` with args array)
   - Enum/value completeness: new union type values — grep for sibling values, read each consumer, verify new value is handled
   - Race conditions: read-check-write without atomic guard
   - YAML safety: `matter()` calls without try/catch (prior learning: gray-matter throws on invalid YAML)

   **Informational (fix or note):**
   - DRY violations: repeated code blocks, duplicated lambdas
   - Missing test paths: trace codepaths, flag gaps
   - Schema consistency: Zod schema matches actual usage
   - Unused imports/variables

3. **Test coverage diagram.** For each new/modified file, trace every codepath:

   ```
   [+] src/core/new-module.ts
       │
       ├── functionA()
       │   ├── [TESTED] Happy path — test.ts:42
       │   ├── [GAP]    Error path — NO TEST
       │   └── [TESTED] Edge case — test.ts:58
       │
       └── functionB()
           └── [TESTED] All paths — test.ts:70-85

   COVERAGE: X/Y paths tested (Z%)
   GAPS: N paths need tests
   ```

4. **Failure modes.** For each new codepath, list one realistic way it could fail in production. Flag as critical gap if: no test AND no error handling AND would be silent.

5. **TODOS.md cross-reference.** Does this branch address any open TODOs? Does it create work that should become a TODO?

6. **Fix-first.** For each finding:
   - Mechanical fix (unused import, duplicated lambda, missing type): auto-fix directly
   - Judgment call (security, design, removing functionality): ask user
   - Be terse. One line problem, one line fix.

#### Phase 5: Simplify

**When to run:** After review fixes applied. Inline, not a separate pass.

Quick scan of changed files for:
- **Reuse:** new code that duplicates existing utilities in `src/shared/`
- **Quality:** parameter sprawl, copy-paste with slight variation, unnecessary comments
- **Efficiency:** redundant computations, repeated collection/filtering, missed concurrency

Apply fixes directly. No subagent dispatch for this — it's a 2-minute inline pass.

#### Completion

Run `npm test && npm run lint && npm run build` one final time. Report:
- Test count and status
- Files changed (`git diff origin/main --stat`)
- Commits on branch (`git log origin/main..HEAD --oneline`)

---

## Skill 2: `/ship`

**File:** `.claude/commands/ship.md`

### Steps

1. **Verify clean.** Run `npm test && npm run lint && npm run build`. All three must pass. If any fail, fix first.

2. **Check working tree.** `git status`. If uncommitted changes exist, ask whether to commit them or stash.

3. **Push.** `git push -u origin [branch]`.

4. **Create PR.**
   ```bash
   gh pr create --title "[type]: [short description]" --body "$(cat <<'EOF'
   ## Summary
   [2-3 bullets extracted from git log]

   ## Test plan
   [Checklist extracted from test files changed]

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   PR title: under 70 chars, conventional commit prefix (feat/fix/refactor/test/docs).
   Summary: extract from commit messages, not from thin air.
   Test plan: extract from actual test names in the diff.

5. **TODOS.md.** Check if this branch addresses any open items. If yes, suggest marking them complete (with strikethrough + completion note, matching existing TODOS.md format).

6. **Report.** Print the PR URL.

---

## File Locations

```
.claude/commands/
├── develop.md       # /develop — design → plan → implement → review → simplify
├── ship.md          # /ship — push + PR
├── pre-pr-check.md  # (existing, will be replaced by /develop's review phase)
├── version.md       # (existing, unchanged)
└── release.md       # (existing, unchanged)
```

`/pre-pr-check` becomes redundant since `/develop` includes review. Keep it for now (it's useful for branches developed without `/develop`), but note the overlap.

## Cost Estimate

For a lifecycle-scripts-sized feature (~150 line spec, 8 implementation tasks, 6 source files):

| Phase | Est. Cost | Model |
|-------|-----------|-------|
| Design (Phase 1) | ~$1.00 | Opus (main session) |
| Plan (Phase 2) | ~$0.50 | Opus (main session) |
| Mechanical tasks (3-4 Sonnet subagents) | ~$2.00 | Sonnet subagents |
| Integration tasks (inline) | ~$3.00 | Opus (main session) |
| Review + simplify (Phase 4-5) | ~$2.00 | Opus (main session) |
| /ship | ~$0.50 | Opus (main session) |
| **Total** | **~$9.00** | **vs. $25 today (~64% reduction)** |

Cost reduction comes from:
- One skill load instead of 6 (~3,000 tokens saved per skill prompt)
- Inline execution instead of subagent-driven for most tasks (~20,000 tokens saved in briefing)
- Sonnet subagents for mechanical tasks (~5x cheaper per task)
- One review pass instead of two (~$8 saved)
- No gstack infrastructure overhead (~2,000 tokens saved per invocation)
