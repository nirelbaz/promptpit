---
name: commit
description: Write clear commit messages in conventional commits format. Use when the user is done with changes and wants to commit, says 'commit this', asks for a commit message, or has staged changes ready to go.
user-invocable: true
---

# Commit

Write a commit message for the staged changes.

## Process

1. Run `git diff --cached` to see what's staged
2. If nothing is staged, run `git status` and tell the user what's available to stage
3. Analyze the changes and write a commit message

## Commit message format

Use conventional commits:

```
type(scope): short description

Longer explanation of why this change was made,
if the why isn't obvious from the description.
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`

Scope: the area of code affected (optional, use when it adds clarity)

## Rules

- The short description should be under 72 characters
- Write in imperative mood: "add feature" not "added feature"
- The description says WHAT changed. The body says WHY.
- If the change is trivial (typo fix, formatting), skip the body
- If the change touches multiple areas, consider whether it should be multiple commits
- Never include file lists in the message. The diff already shows exactly what changed, and manual lists go stale if the commit is amended.
