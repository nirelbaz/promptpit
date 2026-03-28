---
name: debug
description: Systematic debugging - reproduce, isolate, understand, fix. Use when the user reports a bug, error, crash, unexpected behavior, or says something 'doesn't work' or 'is broken'.
user-invocable: true
---

# Debug

Debug a problem systematically. No shotgun fixes.

## Process

1. **Reproduce** the bug. If you can't reproduce it, you can't verify the fix. Get the exact steps, input, and environment.
2. **Isolate** the cause. Binary search through the code path. Add logging at key points. Narrow down: which function, which line, which condition?
3. **Understand** why it happens. Don't just find the broken line. Understand the root cause. "It crashes here" is not a root cause. "This value is null because the API returns an empty body on 204 responses and we don't check for that" is a root cause.
4. **Fix** the root cause, not the symptom. If you add a null check without understanding why it's null, you've hidden the bug, not fixed it.
5. **Verify** the fix resolves the original reproduction steps.
6. **Write a regression test** that would have caught this bug.

## Rules

- Never fix something you can't reproduce. You're guessing.
- One fix per commit. If you found two bugs, that's two commits.
- Read the error message carefully. The answer is often right there.
- Check recent changes first: `git log --oneline -10` and `git diff HEAD~5`.
- If the same approach fails twice, reassess your assumptions. Explain the problem from scratch. What are you taking for granted?
