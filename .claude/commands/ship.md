Push the current branch and create a Pull Request. Run this after implementation is complete and tests pass.

## Steps

1. **Verify clean.** Run `npm test && npm run lint && npm run build`. All three must pass. If any fail, stop and fix them first.

2. **Check working tree.** Run `git status`. If there are uncommitted changes, ask the user whether to commit them (with a suggested message) or stash them.

3. **Push.** Run `git push -u origin [branch-name]`. If the branch already tracks a remote, just `git push`.

4. **Create PR.** Use `gh pr create`:
   - **Title:** Under 70 chars, conventional commit prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Extract from the primary commit message or the branch purpose.
   - **Summary:** 2-3 bullets extracted from `git log origin/main..HEAD --oneline`. Describe what the user can now do, not implementation details.
   - **Test plan:** Extract test names from `git diff origin/main -- test/` to build a checklist of what's covered.

   Format:
   ```bash
   gh pr create --title "[title]" --body "$(cat <<'EOF'
   ## Summary
   - [bullet from commits]
   - [bullet from commits]

   ## Test plan
   - [x] [test name from diff]
   - [x] [test name from diff]

   Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

5. **TODOS.md.** Read TODOS.md. If this branch addresses any open items, suggest marking them complete using the project's existing format (strikethrough + completion note). Only modify TODOS.md if the user confirms.

6. **Report.** Print the PR URL.
