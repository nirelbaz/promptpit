# UX Improvements — Design Spec

**Date:** 2026-04-02
**Goal:** Improve pit CLI user experience by adding command flow guidance, help examples, actionable error messages, and fixing visibility issues. Quick wins now, larger items backlogged.

## Approach

Fix now (low-risk, high-impact surface-level changes):
1. Add next-step suggestions after command completion
2. Add help examples to all 7 commands
3. Improve two key error messages
4. Fix dim suggestions in status

Backlog (needs more design or lower priority):
- Status icon legend / `--explain` mode
- `--quiet` flag for CI
- JSON output for collect/install
- Auto-default to Claude Code confirmation
- Spinner message consistency
- Watch clarity improvements

---

## Fix Now: Detailed Design

### 1. Next-Step Suggestions

After each command completes, show a brief "Next steps" block (1-3 lines). Use `log.info()` for the hints.

**`pit collect` (after success):**
```
Next: Run 'pit validate' to check for issues, then 'git add .promptpit && git commit'.
```

**`pit install` (after success):**
```
Next: Run 'pit status' to verify.
```
Additionally, if `.env` placeholders were written, append:
```
Fill in .env values before using MCP servers.
```

**`pit validate` (after pass):**
```
Next: Run 'pit install' to install the stack.
```

**`pit validate` (after fail):**
```
Fix the issues above, then re-run 'pit validate'.
```

**`pit check` (after fail):**
```
To fix: Run 'pit install' to sync, or 'pit collect' to adopt current changes.
```

**`pit init` (revised):**

Replace the current next-steps block with:
```
Next steps:
  1. Write your agent instructions in .promptpit/agent.promptpit.md
  2. Add skills to .promptpit/skills/<name>/SKILL.md
  3. Run 'pit validate' to check for issues
  4. Run 'pit install' to install the stack into your project

Already have AI tool configs? Run 'pit collect' instead to bundle them automatically.
```

Rules:
- Step 1 only shown if `includeInstructions` was true (user said "y" to instructions prompt)
- Step 2 always shown (skills are always available)
- Steps 3-4 always shown
- Drop the old "Edit stack.json to add skills and tags" step — stack.json is populated from prompts
- The `pit collect` hint always shown as a separate line after the numbered steps

**`pit status` (drift detected):**
No text change — just fix visibility (see section 4 below).

### 2. Help Examples

Add `.addHelpText('after', ...)` to every command in `src/cli.ts`:

**`pit init`:**
```
Examples:
  pit init                    # scaffold in current directory
  pit init ./my-project       # scaffold in a specific directory
```

**`pit collect`:**
```
Examples:
  pit collect                 # bundle from current directory
  pit collect --dry-run       # preview what would be bundled
  pit collect --dry-run -v    # preview with full diffs
```

**`pit install`:**
```
Examples:
  pit install                          # from .promptpit/ in current dir
  pit install ./path/to/.promptpit     # from a local stack
  pit install github:org/stack@v1.0    # from GitHub
  pit install --dry-run                # preview without writing
  pit install --global                 # install to user-level paths
```

**`pit status`:**
```
Examples:
  pit status                  # show sync state
  pit status --json           # machine-readable output
  pit status --short          # one-line summary
```

**`pit watch`:**
```
Examples:
  pit watch                   # watch and re-translate on change
```

**`pit validate`:**
```
Examples:
  pit validate                # validate .promptpit/ in current dir
  pit validate ./my-stack     # validate a specific stack
  pit validate --json         # machine-readable output
```

**`pit check`:**
```
Examples:
  pit check                   # verify freshness + drift
  pit check --json            # machine-readable for CI
```

### 3. Improved Error Messages

**Install — "No .promptpit/ found"** (`src/commands/install.ts`):

Replace the current error with:
```
No .promptpit/ found in this directory.

To create one:
  pit init       scaffold a new stack from scratch
  pit collect    bundle existing AI tool configs

Or install from another source:
  pit install ./path/to/.promptpit
  pit install github:user/repo
```

**Collect — "No AI tool configuration found"** (`src/commands/collect.ts`):

Replace the current error with:
```
No AI tool configs found in this project.

Run 'pit init' to create a stack from scratch, or add a config file for one of:
  Claude Code    CLAUDE.md or .claude/
  Cursor         .cursorrules or .cursor/
  Codex CLI      AGENTS.md or .codex/
  Copilot        .github/copilot-instructions.md
  Standards      AGENTS.md or .mcp.json
```

### 4. Fix Dim Suggestions in Status

In `src/commands/status.ts`, the drift suggestions use `chalk.dim()` which is hard to read on many terminals. Change to `log.info()` or use `chalk.yellow()` for the "Suggestions:" header and normal text for the suggestion lines.

---

## Backlog

Items identified but not in scope for this change:

| Item | Rationale for deferral |
|------|----------------------|
| Status icon legend (`--explain` mode) | Needs new flag + output format design |
| `--quiet` flag for CI | Needs plumbing through all commands |
| JSON output for collect/install | Behavior change, needs schema design |
| Claude Code auto-default confirmation | Behavior change, needs interactive prompt |
| Spinner message consistency | Cosmetic, low impact |
| Watch clarity improvements | Low usage command |
| `--force` flag documentation | Needs behavioral audit first |
| Rollback on partial install failure | Transactional install — significant feature |

---

## Files Changed

| File | Change |
|------|--------|
| `src/cli.ts` | Add `.addHelpText('after', ...)` to all 7 commands |
| `src/commands/init.ts` | Revise next-steps block |
| `src/commands/collect.ts` | Add next-step hint after success + improve "no tools" error |
| `src/commands/install.ts` | Add next-step hint after success + improve "no .promptpit/" error |
| `src/commands/validate.ts` | Add next-step hint after pass and fail |
| `src/commands/check.ts` | Add fix suggestion after failure |
| `src/commands/status.ts` | Change `chalk.dim()` to visible color for suggestions |

No new files. No test changes needed (these are output strings, not behavioral changes).
