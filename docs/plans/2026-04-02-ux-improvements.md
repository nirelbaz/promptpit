# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add next-step suggestions, help examples, actionable error messages, and fix dim suggestions across all pit CLI commands.

**Architecture:** Surface-level string changes to 7 existing files. No new files, no behavioral changes, no new dependencies. Each task is one file.

**Tech Stack:** TypeScript, Commander.js (.addHelpText), chalk (for status fix)

---

## File Structure

All modifications to existing files:

| File | Responsibility | Changes |
|------|---------------|---------|
| `src/cli.ts` | CLI command definitions | Add `.addHelpText('after', ...)` to all 7 commands |
| `src/commands/init.ts` | Stack scaffold | Revise next-steps block (lines 128-138) |
| `src/commands/collect.ts` | Bundle configs | Add next-step hint (after line 158) + improve error (lines 44-49) |
| `src/commands/install.ts` | Install stack | Add next-step hint (after line 304) + improve error (lines 34-40) |
| `src/commands/validate.ts` | Validate stack | Add next-step hints (after lines 95 and 100) |
| `src/commands/check.ts` | CI check | Add fix suggestion (after line 187) |
| `src/commands/status.ts` | Show sync state | Change `chalk.dim` to `log.info`/`log.warn` (lines 330-332) |

---

### Task 1: Add Help Examples to All Commands

**Files:**
- Modify: `src/cli.ts:21-165`

- [ ] **Step 1: Add help examples to `init` command**

In `src/cli.ts`, add `.addHelpText('after', ...)` before the `.action(` call on the `init` command. Insert after line 26 (the `--force` option):

```typescript
  .addHelpText("after", `
Examples:
  pit init                    # scaffold in current directory
  pit init ./my-project       # scaffold in a specific directory
`)
```

- [ ] **Step 2: Add help examples to `collect` command**

Insert after line 47 (the `--verbose` option):

```typescript
  .addHelpText("after", `
Examples:
  pit collect                 # bundle from current directory
  pit collect --dry-run       # preview what would be bundled
  pit collect --dry-run -v    # preview with full diffs
`)
```

- [ ] **Step 3: Add help examples to `install` command**

Insert after line 72 (the `--force` option):

```typescript
  .addHelpText("after", `
Examples:
  pit install                          # from .promptpit/ in current dir
  pit install ./path/to/.promptpit     # from a local stack
  pit install github:org/stack@v1.0    # from GitHub
  pit install --dry-run                # preview without writing
  pit install --global                 # install to user-level paths
`)
```

- [ ] **Step 4: Add help examples to `status` command**

Insert after line 98 (the `--verbose` option):

```typescript
  .addHelpText("after", `
Examples:
  pit status                  # show sync state
  pit status --json           # machine-readable output
  pit status --short          # one-line summary
`)
```

- [ ] **Step 5: Add help examples to `watch` command**

Insert after line 114 (the `[dir]` argument):

```typescript
  .addHelpText("after", `
Examples:
  pit watch                   # watch and re-translate on change
`)
```

- [ ] **Step 6: Add help examples to `validate` command**

Insert after line 131 (the `--json` option):

```typescript
  .addHelpText("after", `
Examples:
  pit validate                # validate .promptpit/ in current dir
  pit validate ./my-stack     # validate a specific stack
  pit validate --json         # machine-readable output
`)
```

- [ ] **Step 7: Add help examples to `check` command**

Insert after line 151 (the `--json` option):

```typescript
  .addHelpText("after", `
Examples:
  pit check                   # verify freshness + drift
  pit check --json            # machine-readable for CI
`)
```

- [ ] **Step 8: Verify help output**

Run: `cd "/Users/nirelbaz/.superset/worktrees/pit CLI/nirelbaz/user-stories-research" && npm run build && node dist/cli.js install --help`

Expected: Help output ends with an "Examples:" section showing the install examples.

- [ ] **Step 9: Run tests**

Run: `npm test`

Expected: All tests pass (no behavioral changes).

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts
git commit -m "feat(ux): add help examples to all CLI commands"
```

---

### Task 2: Revise Init Next-Steps

**Files:**
- Modify: `src/commands/init.ts:128-138`

- [ ] **Step 1: Replace the next-steps block**

Replace lines 130-138 in `src/commands/init.ts`:

```typescript
    const steps = ["Edit .promptpit/stack.json to add skills and tags"];
    if (includeInstructions) {
      steps.push("Write your agent instructions in .promptpit/agent.promptpit.md");
    }
    steps.push("Add skills to .promptpit/skills/<name>/SKILL.md");

    log.info("Next steps:");
    steps.forEach((s, i) => log.info(`  ${i + 1}. ${s}`));
    log.info("  Run 'pit install' to install the stack into your project");
```

With:

```typescript
    const steps: string[] = [];
    if (includeInstructions) {
      steps.push("Write your agent instructions in .promptpit/agent.promptpit.md");
    }
    steps.push("Add skills to .promptpit/skills/<name>/SKILL.md");
    steps.push("Run 'pit validate' to check for issues");
    steps.push("Run 'pit install' to install the stack into your project");

    log.info("Next steps:");
    steps.forEach((s, i) => log.info(`  ${i + 1}. ${s}`));
    log.info("");
    log.info("Already have AI tool configs? Run 'pit collect' instead to bundle them automatically.");
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: All tests pass. The init.test.ts tests may check output — if they assert on the old "Edit .promptpit/stack.json" text, update those assertions.

- [ ] **Step 3: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat(ux): revise init next-steps with validate and collect hints"
```

---

### Task 3: Add Next-Step Suggestions to Collect and Improve Error

**Files:**
- Modify: `src/commands/collect.ts:44-49,156-158`

- [ ] **Step 1: Add next-step hint after collect success**

After line 158 in `src/commands/collect.ts` (the `log.success(...)` line), add:

```typescript
  log.info(
    "Next: Run 'pit validate' to check for issues, then 'git add .promptpit && git commit'.",
  );
```

- [ ] **Step 2: Improve the "no AI tools" error message**

Replace lines 44-49:

```typescript
  if (detected.length === 0) {
    spin.fail("No AI tool configuration found");
    throw new Error(
      "No AI tool configuration found in this project. " +
        "Looked for: CLAUDE.md, .claude/, .cursorrules, .cursor/, AGENTS.md, .mcp.json, .github/copilot-instructions.md, .vscode/mcp.json",
    );
  }
```

With:

```typescript
  if (detected.length === 0) {
    spin.fail("No AI tool configs found");
    throw new Error(
      "No AI tool configs found in this project.\n\n" +
        "Run 'pit init' to create a stack from scratch, or add a config file for one of:\n" +
        "  Claude Code    CLAUDE.md or .claude/\n" +
        "  Cursor         .cursorrules or .cursor/\n" +
        "  Codex CLI      AGENTS.md or .codex/\n" +
        "  Copilot        .github/copilot-instructions.md\n" +
        "  Standards      AGENTS.md or .mcp.json",
    );
  }
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: Tests pass. If `test/commands/collect.test.ts` asserts on the old error message text ("No AI tool configuration found"), update the assertion to match the new message ("No AI tool configs found").

- [ ] **Step 4: Commit**

```bash
git add src/commands/collect.ts
git commit -m "feat(ux): add next-step hint to collect and improve error message"
```

---

### Task 4: Add Next-Step Suggestion to Install and Improve Error

**Files:**
- Modify: `src/commands/install.ts:33-41,304`

- [ ] **Step 1: Add next-step hint after install success**

After line 304 in `src/commands/install.ts` (`log.success("Stack installed successfully!");`), add:

```typescript
    log.info("Next: Run 'pit status' to verify.");
```

Note: The `.env` messages at lines 287-301 already tell users to fill in values, so no additional env hint is needed.

- [ ] **Step 2: Improve the "no .promptpit/" error message**

Replace lines 34-40:

```typescript
      throw new Error(
        "No .promptpit/ found in this directory.\n" +
          "Usage:\n" +
          "  pit install                              # install from .promptpit/ in current dir\n" +
          "  pit install ./path/to/.promptpit          # install from local path\n" +
          "  pit install github:user/repo              # install from GitHub",
      );
```

With:

```typescript
      throw new Error(
        "No .promptpit/ found in this directory.\n\n" +
          "To create one:\n" +
          "  pit init       scaffold a new stack from scratch\n" +
          "  pit collect    bundle existing AI tool configs\n\n" +
          "Or install from another source:\n" +
          "  pit install ./path/to/.promptpit\n" +
          "  pit install github:user/repo",
      );
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: Tests pass. If `test/commands/install.test.ts` asserts on the old error text, update assertions.

- [ ] **Step 4: Commit**

```bash
git add src/commands/install.ts
git commit -m "feat(ux): add next-step hint to install and improve error message"
```

---

### Task 5: Add Next-Step Suggestions to Validate

**Files:**
- Modify: `src/commands/validate.ts:94-101`

- [ ] **Step 1: Add hints after validation pass and fail**

After line 95 in `src/commands/validate.ts` (`log.success(\`${stackDir} is valid\`);`), add:

```typescript
    log.info("Next: Run 'pit install' to install the stack.");
```

After line 100 (`log.error(parts.join(", "));`), add:

```typescript
    log.info("Fix the issues above, then re-run 'pit validate'.");
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/validate.ts
git commit -m "feat(ux): add next-step hints to validate command"
```

---

### Task 6: Add Fix Suggestion to Check Failure

**Files:**
- Modify: `src/commands/check.ts:185-188`

- [ ] **Step 1: Add fix suggestion after check failure**

After line 187 in `src/commands/check.ts` (the `log.error(...)` line inside the `else` block), add:

```typescript
    log.info(
      "To fix: Run 'pit install' to sync, or 'pit collect' to adopt current changes.",
    );
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/check.ts
git commit -m "feat(ux): add fix suggestion when check fails"
```

---

### Task 7: Fix Dim Suggestions in Status

**Files:**
- Modify: `src/commands/status.ts:329-332`

- [ ] **Step 1: Replace chalk.dim with visible output**

Replace lines 330-332 in `src/commands/status.ts`:

```typescript
    console.log(chalk.dim("Suggestions:"));
    console.log(chalk.dim("  Run `pit install` to restore drifted files."));
    console.log(chalk.dim("  Run `pit collect` to capture current state."));
```

With:

```typescript
    log.warn("Suggestions:");
    log.info("  Run 'pit install' to restore drifted files.");
    log.info("  Run 'pit collect' to capture current state.");
```

- [ ] **Step 2: Check if `log` is already imported**

`src/commands/status.ts` should already import `log` from `../shared/io.js`. If not, add the import.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat(ux): make status drift suggestions visible (replace chalk.dim)"
```

---

### Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: All 298+ tests pass.

- [ ] **Step 2: Run lint and build**

Run: `npm run lint && npm run build`

Expected: Clean pass.

- [ ] **Step 3: Spot-check help output**

Run: `node dist/cli.js --help` and `node dist/cli.js install --help`

Expected: Examples shown at the bottom of help output.

- [ ] **Step 4: Spot-check error messages**

Run: `node dist/cli.js install` in a directory with no `.promptpit/`

Expected: New error message with "To create one:" section.
