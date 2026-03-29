# TODOS

## v0.2

### AGENTS.md support
Add AGENTS.md read/write to collect and install. AGENTS.md is a cross-tool standard (Cursor, Copilot, Codex, Windsurf) — tool-agnostic, so no adapter logic needed. During collect, read and include in bundle. During install, copy to project root. Decision needed: merge with agent.promptpit.md or keep separate.

### More adapters
Windsurf, Copilot, Codex. Each one makes the "portable" claim real for more users. Mostly adapter boilerplate — the pattern is established.

### Status command
`pit status` — show what's installed, what's in `.promptpit/`, what's drifted since install. The "git status" for AI agent stacks. Answers the first question teams will ask: "what's even installed right now?"

### Recursive duplication on collect + install
When `pit collect` reads CLAUDE.md, it captures everything including content previously installed by `pit install` (marked blocks). This causes two problems:

1. **Installed stacks get re-collected** — marked blocks from other stacks get baked into the bundle as plain text, causing recursive nesting on re-install.
2. **Project content duplicates on re-install** — the project's native CLAUDE.md content gets collected into the bundle. When the bundle is installed back (e.g. team re-sync from shared `.promptpit/`), that content appears twice: once as the file's native content, once inside markers.

**Core challenge:** The file has no concept of "what's project-native vs what was installed" beyond the marker blocks. Stripping markers on collect fixes problem 1 but not problem 2. Need a design that cleanly separates project content from stack content in both collect and install flows.

## v0.2.x

### Init command
`pit init` — scaffold a `.promptpit/` from scratch with prompts. For new projects or people who want to build a stack from zero without collecting from an existing setup first.

### Dry-run output
`--dry-run` flags exist but output is half-baked. Collect only shows secret stripping, install skips writes but doesn't report what would change. Need proper preview output: list files that would be created/modified, show diffs for config merges, summarize skills/MCP that would be added.

### Validate command
`pit validate` — check if a stack.json is valid, skills parse correctly, MCP configs are well-formed. Useful before publishing, and as a CI check for teams maintaining shared stacks.

## v0.3

### Update command
`pit update` — diff what changed in a stack since last install, apply only the delta. The marker system already tracks what was installed. Needs version comparison and conflict resolution for user-modified content.

### Uninstall command
`pit uninstall <stack>` — clean reverse of install. Markers make CLAUDE.md/.cursorrules removal straightforward. Skills/MCP/env is messier (what if the user modified them after install?). Basic version: remove marked blocks + delete unmodified skill files.

### Selective install/collect
`pit install --select` / `pit collect --select` — interactive picker (checkboxes for skills, MCP servers, env vars). Power-user feature for teams where you want the coding conventions but not the MCP servers. Pairs well with `pit status`.

### Diff command
`pit diff` — show what changed between installed config and `.promptpit/` source. "Has someone updated the team stack since I last installed?" Pairs with `pit status` (what's installed) and `pit update` (apply changes).

### Stack composition
Stack A extends stack B. Company base stack + team-specific overrides. `"extends": "github:company/base-stack"` in stack.json. Everyone gets the security skills, frontend team adds React skills on top. Like Dockerfile `FROM` for AI stacks.

## v1.0

### Publish to registry
`pit publish` — push a stack to a central registry. Makes promptpit a real ecosystem with discoverability (`pit search`). Needs: hosting, auth, moderation, versioning. The network effects feature.

### Clean/reset command
`pit clean` — remove all AI agent config from a project (not just one stack). Broader than uninstall. Useful for starting fresh or switching stacks entirely.

## Done

### ~~Resolve auto-collect default behavior~~
Auto-collect runs by default when GitHub repo has no .promptpit/. MCP trust prompt handles consent.

### ~~Measure npx cold-start time~~
Measured: 0.36s. No action needed.
