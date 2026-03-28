---
name: refactor
description: Clean up code without changing behavior. Use when the user says code is messy, hard to read, too complex, wants to simplify, reduce duplication, or prepare code for a new feature.
user-invocable: true
---

# Refactor

Clean up code. Make it simpler, clearer, or more maintainable without changing what it does.

## When to refactor

- You're about to add a feature and the existing code makes it hard
- You see the same logic in three or more places
- A function is longer than 40 lines
- You need to read a function twice to understand it
- Nesting is deeper than 3 levels

## When NOT to refactor

- Code you're not otherwise touching. Stay focused on the task at hand.
- Code that works and nobody needs to change. Leave it alone.
- Right before a deadline. Refactoring is for when you have room to verify.

## Techniques

- **Extract function**: repeated code becomes a named function
- **Early return**: replace nested if/else with guard clauses
- **Rename**: if the name doesn't explain the purpose, change it
- **Inline**: if a function is called once and adds no clarity, inline it
- **Split file**: if a file has two unrelated responsibilities, split it

## Process

1. Make sure tests pass before you start
2. Make one small change at a time
3. Run tests after each change
4. Commit when tests pass
5. Repeat

## Rules

- Never refactor and change behavior in the same commit. Refactoring means the tests still pass with no changes to the tests.
- Don't abstract prematurely. Three concrete examples before you extract a pattern.
- Simpler is better. If your refactor adds more code than it removes, reconsider.
