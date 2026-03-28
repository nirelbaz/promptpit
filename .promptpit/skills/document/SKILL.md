---
name: document
description: Write useful documentation where people will find it. Use when the user asks to document code, add comments, update the README, explain a module, or write API docs.
user-invocable: true
---

# Document

Write documentation that helps someone understand and use the code.

## Process

1. Identify what needs documenting: new module, changed API, complex logic
2. Determine the audience: other developers on the team, users of the library, future you
3. Write the docs where people will find them

## Where to document

- **README.md**: what this project does, how to install it, how to use it. Written for someone who just found the repo.
- **Inline comments**: only for code that would surprise a competent reader. The "why", not the "what."
- **Function/method docs**: for public APIs. Parameters, return value, one example.
- **Architecture docs**: for non-obvious system design. How components fit together. When things are connected in ways that aren't visible from the code.

## Rules

- Don't comment obvious code. `i++ // increment i` helps nobody.
- Do comment non-obvious decisions. "We use setTimeout here instead of requestAnimationFrame because..." is useful.
- Keep docs close to the code. Docs in a separate wiki get stale. Docs in the same file get maintained.
- Write for the reader, not the writer. You know why you did it. They don't.
- Use examples. A code example is worth 100 words of explanation.
- Update docs when you change the code. Stale docs are worse than no docs.
