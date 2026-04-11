# promptpit

[![npm](https://img.shields.io/npm/v/promptpit)](https://www.npmjs.com/package/promptpit)
[![license](https://img.shields.io/github/license/nirelbaz/promptpit)](LICENSE)

Every AI tool has its own config files. pit turns them into one bundle you can share and actually keep track of.

`pit collect` to bundle. `pit install` to write it out for each tool. `pit status` to see what drifted. Commit `.promptpit/` and your team stays in sync.

```sh
pit init           # scaffold a new .promptpit/ stack
pit collect        # bundle your AI config into .promptpit/
pit install        # write it out for each tool
pit status         # see what drifted
pit diff           # text diff between installed and source
pit watch          # live-sync skill changes
pit validate       # check if a stack is well-formed
pit check          # CI integration — verify config is fresh and in sync
```

## Features

- **Stack composition via `extends`.** Layer stacks on top of each other: company base stack + team overrides + personal preferences. `pit install` resolves the dependency graph recursively.
- **Five adapters:** Claude Code, Cursor, Codex CLI, GitHub Copilot, and cross-tool standards (AGENTS.md, .mcp.json). One stack, every tool configured.
- **Install from any GitHub repo,** even ones that don't use promptpit. pit auto-collects from raw configs. Use `--save` to add it to your extends list.
- **Skills follow the [Agent Skills](https://agentskills.io) spec,** symlinked or translated per tool (SKILL.md, .mdc, .instructions.md)
- **Portable rules:** conditional rules in `.promptpit/rules/*.md` with YAML frontmatter, translated per-adapter (Claude Code, Cursor, Copilot)
- **Portable agents:** custom agent definitions in `.promptpit/agents/*.md`, written natively to Claude Code and Copilot, inlined for other tools
- **Drift detection:** `pit status` shows what's synced, drifted, or deleted across all adapters, including upstream extends changes
- **Dry-run previews:** `--dry-run` on collect and install shows exactly what would change. `--verbose` adds unified diffs.
- **CI integration:** `pit check` exits non-zero on stale or drifted config. `pit validate` lints your stack before publishing.
- **MCP handled automatically:** stdio and HTTP remote servers, secrets stripped during collect, per-adapter format translation (JSON, TOML)
- **Multiple stacks coexist,** re-installs replace cleanly via idempotent markers

## Installation

```sh
npm install -g promptpit
```

Or run directly:

```sh
npx promptpit <command>
```

## Usage

### Start a new stack

```sh
pit init
```

Interactive prompts for name, version, description, and optional files (agent instructions, MCP config, .env.example). Creates a `.promptpit/` directory ready to edit.

### Collect your config

```sh
pit collect
```

Scans for Claude Code, Cursor, Codex CLI, Copilot, and Standards configs, merges them, strips secrets from MCP configs, and writes:

```
.promptpit/
├── stack.json          # Manifest (name, version, skills, compatibility)
├── agent.promptpit.md  # Agent instructions (from CLAUDE.md, .cursorrules, AGENTS.md, etc.)
├── skills/             # SKILL.md files + supporting files (references/, scripts/, assets/)
├── rules/              # Conditional rules (globs, alwaysApply)
├── agents/             # Custom agent definitions (tools, model)
├── mcp.json            # MCP server configs (secrets replaced with placeholders)
└── .env.example        # Required environment variables
```

Use `--dry-run` to preview what would be collected without writing anything. Add `--verbose` for unified diffs.

### Install a stack

```sh
pit install                              # from .promptpit/ in current dir (resolves extends automatically)
pit install ./path/to/.promptpit         # from local path
pit install github:user/repo             # from GitHub
pit install github:user/repo@v2.0       # specific tag or branch
pit install github:user/repo --save     # install + add to extends in stack.json
pit install github:user/repo --global   # install to user-level paths (~/.claude/, ~/.codex/, etc.)
```

pit detects which AI tools are in your project and writes config in each one's format. If the repo doesn't have a `.promptpit/` bundle, pit auto-collects one from the raw configs it finds. If your stack has `extends`, pit resolves the full dependency chain and merges content (last-declared wins, with conflict warnings). Use `--dry-run` to preview changes before writing.

### Stack composition

Layer stacks on top of each other with `extends` in stack.json:

```json
{
  "name": "my-team-stack",
  "version": "1.0.0",
  "extends": [
    "github:company/base-stack@1.0.0",
    "../shared-stack/.promptpit"
  ]
}
```

Base instructions merge first, your overrides layer on top. `pit install --save` adds a stack to your extends list in one command. `pit collect --include-extends` flattens the chain into a self-contained bundle.

### Validate and check

```sh
pit validate                # lint your stack before publishing
pit check                   # CI gate — exits non-zero on stale or drifted config
pit check --json            # machine-readable output for CI pipelines
```

### Team setup

Commit `.promptpit/` to your repo. Teammates run `pit install`, everyone gets the same config.

Add `.promptpit/` to your AI tool's ignore list so it doesn't scan the raw bundle files. For Claude Code, add `.promptpit` to `ignorePatterns` in `.claude/settings.json`. For Cursor, add it to `.cursorignore`.

## Supported tools

| Tool | Read | Write | Skill format |
|------|------|-------|--------------|
| Claude Code | CLAUDE.md, .claude/skills/, .claude/settings.json | Symlinked SKILL.md | skill.md |
| Cursor | .cursorrules, .cursor/rules/, .cursor/mcp.json | Auto-converted .mdc | mdc |
| Codex CLI | AGENTS.md, .codex/skills/, .codex/config.toml | Symlinked SKILL.md | skill.md |
| GitHub Copilot | .github/copilot-instructions.md, .github/instructions/, .vscode/mcp.json | Auto-converted .instructions.md | md |
| Standards | AGENTS.md, .mcp.json | AGENTS.md + .mcp.json | — |

pit writes AGENTS.md (cross-tool standard, read by 60+ tools) and .mcp.json (project-level MCP config) on every install. Copilot MCP goes to .vscode/mcp.json with the `servers` root key and auto-inferred `type` field. Codex MCP is written as TOML to .codex/config.toml.

Rules are translated per-adapter: `.claude/rules/*.md` (Claude Code), `.cursor/rules/*.mdc` (Cursor), `.github/instructions/*.instructions.md` (Copilot). Agents are written natively to Claude Code (`.claude/agents/*.md`) and Copilot (`.github/agents/*.agent.md`), and inlined into instructions for tools without native agent support.

Skills are installed to `.agents/skills/` as the canonical location (matching the [Agent Skills](https://agentskills.io) ecosystem convention), then symlinked into tool-native paths. Full skill directories are preserved, including supporting files like `references/`, `scripts/`, and `assets/`. Tools that need different formats (like Cursor's .mdc) get translated copies. Windows falls back to copies when symlinks aren't available.

Adding a new tool is one file plus one registry entry. See [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Security

- MCP config values matching known secret patterns (API keys, tokens, connection strings) are replaced with `${PLACEHOLDER}` during collect. A `.env.example` is auto-generated.
- All frontmatter is parsed with `js-yaml` JSON_SCHEMA to prevent code execution from untrusted stacks.
- Dangerous env names (`PATH`, `NODE_OPTIONS`, `LD_PRELOAD`) are blocked during install.
- Installing MCP servers shows a warning since they run as executables on your machine.
- GitHub owner/repo/ref inputs are validated against a strict character allowlist.

## Development

```sh
git clone https://github.com/nirelbaz/promptpit.git
cd promptpit
npm install
npm test          # 699 tests, vitest
npm run build     # builds dist/cli.js via tsup
npm run lint      # TypeScript strict mode check
```

## Roadmap

See [TODOS.md](TODOS.md) for the full roadmap. The big milestones:

- **v0.3 (Team Platform):** Done. Five adapters (Claude Code, Cursor, Codex, Copilot, Standards), seven commands, drift detection, dry-run previews, CI integration, portable rules and agents.
- **v0.4 (Stack Composer):** Done. Stack composition via `extends`, `pit diff`, install lifecycle scripts, full Agent Skills spec alignment (supporting files, tightened schema), `pit collect --include-extends`.
- **v0.5:** `pit update`, `pit uninstall`, selective install/collect, interactive conflict resolution.
- **v1.0 (Ecosystem Bridge):** Multi-source install (skills.sh, SkillsMP, cursor.directory), `pit publish`, `pit search`.

## Acknowledgments

`pit validate` uses [agnix](https://github.com/nichochar/agnix) for 385+ adapter-specific checks when installed. Thanks to the agnix team for building a thorough agent config linter.

## Related

- [Agent Skills](https://agentskills.io) - Open spec for portable AI agent skills
- [agnix](https://github.com/nichochar/agnix) - Agent config linter with 385+ checks
- [skills.sh](https://skills.sh) - Vercel's skill package manager
- [gstack](https://github.com/garrytan/gstack) - AI coding skill stack for Claude Code
- [promptpit-starter](https://github.com/nirelbaz/promptpit-starter) - Starter kit with 7 skills for Claude Code and Cursor
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol

## License

MIT
