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
pit watch          # live-sync skill changes
pit validate       # check if a stack is well-formed
pit check          # CI integration — verify config is fresh and in sync
```

## Features

- **Five adapters:** Claude Code, Cursor, Codex CLI, GitHub Copilot, and cross-tool standards (AGENTS.md, .mcp.json). One stack, every tool configured.
- **Install from any GitHub repo,** even ones that don't use promptpit. pit auto-collects from raw configs.
- **Skills follow the [Agent Skills](https://agentskills.io) spec,** symlinked or translated per tool (SKILL.md, .mdc, .instructions.md)
- **Drift detection:** `pit status` shows what's synced, drifted, or deleted across all adapters
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
├── skills/             # SKILL.md files
├── mcp.json            # MCP server configs (secrets replaced with placeholders)
└── .env.example        # Required environment variables
```

Use `--dry-run` to preview what would be collected without writing anything. Add `--verbose` for unified diffs.

### Install a stack

```sh
pit install                              # from .promptpit/ in current dir
pit install ./path/to/.promptpit         # from local path
pit install github:user/repo             # from GitHub
pit install github:user/repo@v2.0       # specific tag or branch
pit install github:user/repo --global   # install to user-level paths (~/.claude/, ~/.codex/, etc.)
```

pit detects which AI tools are in your project and writes config in each one's format. If the repo doesn't have a `.promptpit/` bundle, pit auto-collects one from the raw configs it finds. Use `--dry-run` to preview changes before writing.

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

Skills are installed to `.agents/skills/` as the canonical location (matching the [Agent Skills](https://agentskills.io) ecosystem convention), then symlinked into tool-native paths. Tools that need different formats (like Cursor's .mdc) get translated copies. Windows falls back to copies when symlinks aren't available.

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
npm test          # 286 tests, vitest
npm run build     # builds dist/cli.js via tsup
npm run lint      # TypeScript strict mode check
```

## Roadmap

See [TODOS.md](TODOS.md) for the full roadmap. The big milestones:

- **v0.3 (Team Platform):** Done. Five adapters (Claude Code, Cursor, Codex, Copilot, Standards), seven commands, drift detection, dry-run previews, CI integration.
- **v0.5 (Stack Composer):** Stack composition via `extends` in stack.json, `pit diff`, `pit update`, rules and agents in the bundle schema.
- **v1.0 (Ecosystem Bridge):** Multi-source install (skills.sh, SkillsMP, cursor.directory), `pit publish`, `pit search`.

## Related

- [Agent Skills](https://agentskills.io) - Open spec for portable AI agent skills
- [skills.sh](https://skills.sh) - Vercel's skill package manager
- [gstack](https://github.com/garrytan/gstack) - AI coding skill stack for Claude Code
- [promptpit-starter](https://github.com/nirelbaz/promptpit-starter) - Starter kit with 7 skills for Claude Code and Cursor
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol

## License

MIT
