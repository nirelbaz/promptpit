---
name: test
description: Write tests for new or changed code. Use when the user asks for tests, says 'cover this', 'make sure this works', wants regression tests, or has just finished implementing a feature or fix.
user-invocable: true
---

# Test

Write tests for the code you just wrote or changed.

## Process

1. Identify what changed: `git diff --name-only` or look at recent files
2. For each changed file, determine what's testable
3. Write tests that cover the behavior, not the implementation

## Principles

- Test what the code DOES, not how it does it. If you refactor the internals, the test should still pass.
- One test, one assertion (when practical). A test called "works correctly" with 6 assertions is hiding 6 different behaviors.
- Name tests by the behavior they verify: "returns empty array when no results found" not "test getResults"
- Test the edges: empty input, null, zero, negative numbers, very long strings, special characters
- If you fixed a bug, write a test that would have caught it. That's a regression test.

## What to test

- Public functions and methods (the contract other code depends on)
- Error paths (what happens when things go wrong)
- Boundary conditions (first item, last item, empty list, one item)
- State transitions (before and after an action)

## What NOT to test

- Private implementation details
- Third-party library behavior
- Simple getters/setters with no logic
- Configuration constants

## Match existing patterns

Before writing tests, read 2-3 existing test files in the project. Match:
- File naming convention
- Import style
- Assertion library and syntax
- Setup and teardown patterns
- Directory structure
