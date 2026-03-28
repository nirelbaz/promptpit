---
name: review
description: Self-review code before pushing. Use when the user wants to check their changes, asks 'anything I missed', says 'ready to push', or wants a pre-PR sanity check.
user-invocable: true
---

# Review

Review your own changes before pushing. Catch the things you'd be embarrassed about in a PR review.

## Process

1. Run `git diff` (unstaged) and `git diff --cached` (staged) to see all changes
2. Check each file against the checklist below
3. Report findings grouped by severity: must-fix, should-fix, nit

## Checklist

### Must-fix (block the push)
- Leftover debug code: console.log, debugger, print statements, TODO comments related to the current change
- Hardcoded secrets, API keys, passwords, or connection strings
- Obvious bugs: wrong variable name, inverted condition, missing return
- Broken imports or references to deleted code

### Should-fix (fix before PR review)
- Missing error handling on I/O operations (file reads, API calls, database queries)
- New code without tests
- Functions longer than 40 lines
- Duplicated logic that should be extracted
- Unclear variable or function names

### Nit (note but don't block)
- Inconsistent formatting with surrounding code
- Comments that state the obvious
- Unused imports or variables

## Output

For each finding, show: file, line, severity, what's wrong, and a suggested fix. If everything looks clean, say so.
