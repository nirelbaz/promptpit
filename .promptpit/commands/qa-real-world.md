Run free-form agent-based QA against real-world public repos. Each agent acts as a developer who just discovered pit and wants to try it on a project. The agent learns what pit is only from the README and CLI help, then explores organically.

## Steps

1. **Build the CLI** so agents use the latest code:
   ```bash
   npm run build
   ```

2. **Launch 3 parallel agents** (3 repos each). Give each agent these instructions:

   > You are a developer who just found a CLI tool called `pit`. You've never used it before.
   > Your goal: figure out what it does and try it on a real project.
   >
   > **Phase 1 — Learn**
   > 1. Read the README.md of the pit project at `<project-root>/README.md`. This is your ONLY source of knowledge about what pit is and how it works. Do not use any prior knowledge.
   > 2. Run `node <project-root>/dist/cli.js -h` to see all available commands.
   > 3. Run `node <project-root>/dist/cli.js <command> --help` for each command to understand usage and options.
   >
   > **Phase 2 — Explore the target repo**
   > 4. Clone the target repo to `/tmp/pit-qa-{repo}` with `--depth 1`.
   > 5. Explore the repo structure briefly: what AI tool configs exist? (.claude/, .cursor/, .github/, CLAUDE.md, AGENTS.md, .mcp.json, etc.)
   >
   > **Phase 3 — Play**
   > 6. Based on what you learned from the README and help output, try every pit command that makes sense for this repo. Run them in whatever order feels natural to you as a first-time user.
   > 7. For each command you run, capture the full stdout and stderr output. If something errors, try to understand why from the error message alone (don't look at pit source code).
   > 8. After running commands, inspect what pit created or modified. Look at the .promptpit/ bundle, installed files, status output, etc.
   > 9. Try edge cases if you're curious: dry-run flags, verbose output, running commands twice, etc.
   >
   > **Phase 4 — Report**
   > 10. Report your findings for this repo:
   >     - What worked smoothly
   >     - What was confusing (unclear help text, unexpected behavior, missing guidance)
   >     - What failed (with the actual error output)
   >     - What was dropped or missing compared to what the repo actually contains
   >     - UX issues: was the output helpful? Did error messages tell you what to do next?
   > 11. Clean up: `rm -rf /tmp/pit-qa-{repo}`

   **Batch 1:** posit-dev/positron, specklesystems/speckle-server, Azure/azure-sdk-for-js
   **Batch 2:** microsoft/apm, ModelEngine-Group/fit-framework, affaan-m/everything-claude-code
   **Batch 3:** kurrent-io/KurrentDB, getsentry/spotlight, snyk/snyk-intellij-plugin

3. **Aggregate results** into a summary table:

   | Repo | Commands Tried | Worked | Failed | Confusing | Key Findings |
   |------|---------------|--------|--------|-----------|-------------|

4. **List any new findings** not already documented in `docs/REAL_WORLD_REPORT.md`. Compare against the existing bugs (BUGs 1-26) and gaps to avoid duplicates. Categorize new findings as:
   - **Bugs** — commands that crash or produce wrong output
   - **UX gaps** — confusing messages, missing help text, unclear next steps
   - **Data loss** — artifacts from the repo that pit should have captured but didn't
   - **Discoverability** — things the README doesn't explain well enough for a first-time user
