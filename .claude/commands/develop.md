Full development workflow for PromptPit features. Runs design, planning, implementation, review, and simplification in one session. Use this when starting a new feature or significant change.

## Phase 1: Design

1. **Explore context.** Read CLAUDE.md, `git log --oneline -10`, and the area of code the feature touches. Understand what exists before proposing anything.

2. **Smart-skip assessment.** Read the user's description. If it already specifies what to build, where it goes, how it works, and edge cases — skip clarifying questions and go straight to step 4. Most features from an experienced author will skip.

3. **Clarifying questions** (only if smart-skip didn't trigger). Ask 1-3 questions, one at a time, multiple choice preferred. Focus on approach decisions with real trade-offs, ambiguous requirements, and security model choices. Don't ask questions the code can answer.

4. **Premise challenge** (always run, even if skipping questions):
   - Is this the right problem? Could a different framing yield a simpler solution?
   - What existing code already partially solves this? Search `src/` for related patterns.
   - What happens if we do nothing?
   
   Take a position on each. If a premise is shaky, say so directly.

5. **Propose 2-3 approaches** with trade-offs. Lead with your recommendation and explain why. YAGNI: remove unnecessary features from all options.

6. **Write spec** to `docs/specs/YYYY-MM-DD-<topic>-design.md`. Keep it concise (100-200 lines is right for most features). Commit it.

7. **Self-review the spec** inline: placeholder scan, internal consistency, ambiguity check. Fix issues, don't re-review. Then ask the user to review — one approval gate.

## Phase 2: Plan

Proceed directly after design approval. No separate skill invocation.

1. **Scope check.** What is the minimum set of changes that achieves the goal? If touching >8 files or introducing >2 new modules, challenge the scope before proceeding.

2. **Write implementation plan** to `docs/plans/YYYY-MM-DD-<topic>.md` with this format:

   ```markdown
   # [Feature] Implementation Plan

   **Goal:** One sentence
   **Architecture:** 2-3 sentences

   ---

   ### Task N: [Name]

   **Files:**
   - Create/Modify: `exact/path/to/file.ts`
   - Test: `exact/path/to/test.ts`

   - [ ] Step: Write the failing test
   [actual test code here]

   - [ ] Step: Run test, verify fail
   Run: `npm test -- path/to/test`

   - [ ] Step: Implement
   [actual implementation code here]

   - [ ] Step: Run test, verify pass

   - [ ] Step: Commit
   ```

   Rules:
   - Exact file paths in every task
   - Complete code in every step — no placeholders, no "similar to Task N"
   - TDD: test first, then implement
   - One logical change per commit

3. **Self-review plan against spec.** Does every spec requirement have a task? Are types and function names consistent across tasks? Commit the plan, proceed directly to implementation.

## Phase 3: Implement

Proceed directly after plan is written. No user gate needed.

**Model routing.** For each task, decide how to execute:

- **Sonnet subagent** — when the task touches 1-2 files AND the plan has complete code for it. Examples: schema changes, CLI flag wiring, test fixtures, type additions.
- **Inline (Opus)** — when the task needs design judgment, multi-file coordination, or codebase understanding. Examples: core module creation, integration wiring, debugging.

**Sonnet subagent briefing:**

```
You are implementing Task N: [name]

## Task
[FULL task text from plan]

## Context
[1-2 sentences: where this fits, what's already done]

## Your Job
1. Implement exactly what the task specifies (TDD if task says to)
2. Run: npm test -- [specific test file]
3. Run: npm run lint
4. Commit: git add [specific files] && git commit -m "[message]"
5. Report: Status (DONE/BLOCKED/NEEDS_CONTEXT), what you did, test results, files changed

If something is unclear or too hard, STOP and report BLOCKED.
Bad work is worse than no work.

Work from: [directory path]
```

**Execute tasks in plan order.** No per-task reviews — review happens once in Phase 4. After all tasks complete, run `npm test && npm run lint && npm run build`. All must pass before Phase 4.

## Phase 4: Review

One review pass. Not two. Read `git diff origin/main -- src/` and apply these checks:

**Scope drift:**
```
Scope Check: [CLEAN / DRIFT / MISSING]
Intent: [what was requested]
Delivered: [what the diff does]
```

**Critical checks (flag immediately):**
- Shell injection: `execSync` or `exec` with string interpolation — should use `execFile`/`execFileSync` with args array
- Enum/value completeness: new union type values — grep for sibling values, read each consumer, verify new value is handled
- Race conditions: read-check-write without atomic guard
- YAML safety: `matter()` calls without try/catch (gray-matter throws on invalid YAML)

**Informational checks (fix or note):**
- DRY violations: repeated code blocks, duplicated lambdas
- Missing test paths
- Schema consistency: Zod schema matches actual usage
- Unused imports/variables

**Test coverage diagram.** Trace every codepath in new/modified files:
```
[+] src/core/module.ts
    |
    +-- functionA()
    |   +-- [TESTED] Happy path — test.ts:42
    |   +-- [GAP]    Error path — NO TEST
    |
    +-- functionB()
        +-- [TESTED] All paths — test.ts:70

COVERAGE: X/Y paths (Z%)
GAPS: N paths need tests
```

**Failure modes.** For each new codepath, name one realistic way it could fail. Flag as critical if: no test AND no error handling AND would be silent.

**TODOS.md cross-reference.** Does this branch address any open TODOs?

**Fix-first heuristic:**
- Mechanical fix (unused import, duplicated lambda, missing type): auto-fix directly
- Judgment call (security, design, removing functionality): ask user
- One line problem, one line fix. No preamble.

## Phase 5: Simplify

Inline pass over changed files. No subagent dispatch. Check for:
- New code that duplicates existing utilities in `src/shared/`
- Parameter sprawl, copy-paste with slight variation
- Redundant computations, repeated collection/filtering
- Unnecessary comments explaining WHAT (keep only non-obvious WHY)

Apply fixes directly.

## Completion

Run `npm test && npm run lint && npm run build` one final time. Report:
- Test count and pass/fail
- Files changed: `git diff origin/main --stat`
- Commits: `git log origin/main..HEAD --oneline`
- Any remaining concerns

Then ask the user what they'd like to do next: run `/ship`, keep working, or stop here.
