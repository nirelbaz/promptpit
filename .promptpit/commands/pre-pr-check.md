Pre-PR quality gate for PromptPit. Run this on your feature branch after implementation is complete, before opening a PR. Chains three checks: code review, adapter correctness verification, and code simplification.

## Steps

1. **Pre-flight.** Verify the branch has changes against main (`git diff origin/main --stat`). If no diff, stop. Run `npm test && npm run lint && npm run build` — all three must pass before proceeding. If any fail, fix them first.

2. **Code review.** Run `/review` to do a pre-landing review of the full diff against main. This catches structural issues (SQL safety, race conditions, trust boundaries, enum completeness) and runs the fix-first pipeline. Address all findings before continuing.

3. **Adapter correctness.** Dispatch the AI Stack Expert agent to verify adapter changes against real-world tool behavior. The expert should:
   - Read the diff (`git diff origin/main`)
   - For each changed adapter (claude-code, cursor, codex, copilot, standards), verify file paths, field names, and formats match how the tool actually works
   - Flag anything that contradicts real tool behavior (wrong config field names, unsupported file locations, incorrect extensions)
   - Check MCP config format correctness per-adapter (JSON vs TOML, field names)
   - Check rule/skill/agent file naming conventions per-adapter
   
   Skip this step if the diff doesn't touch any files under `src/adapters/`, `src/commands/install.ts`, or `src/commands/status.ts`.

4. **Simplify.** Run `/simplify` to review changed code for reuse opportunities, code quality issues, and efficiency problems. This catches duplicated logic, parameter sprawl, and unnecessary work.

5. **Final verification.** Run `npm test && npm run lint && npm run build` one last time to confirm nothing broke during the review fixes. Report the final test count and confirm the branch is ready for PR.
