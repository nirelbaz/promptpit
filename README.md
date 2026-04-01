# promptpit

[![npm](https://img.shields.io/npm/v/promptpit)](https://www.npmjs.com/package/promptpit)
[![license](https://img.shields.io/github/license/nirelbaz/promptpit)](LICENSE)

Every AI tool has its own config files. pit turns them into one bundle you can share and actually keep track of.

`pit collect` to bundle. `pit install` to write it out for each tool. `pit status` to see what drifted. Commit `.promptpit/` and your team stays in sync.

```sh
pit collect        # bundle your AI config into .promptpit/
pit install        # write it out for each tool
pit status         # see what drifted
```

## Features

- Install from any GitHub repo, even ones that don't use promptpit
- Skills follow the [Agent Skills](https://agentskills.io) spec, symlinked or translated per tool
- `pit status` shows what's synced and what's drifted
- `.mcp.json` and MCP configs handled automatically, secrets stripped during collect
- Multiple stacks coexist, re-installs replace cleanly
- Supports Claude Code and Cursor today, more adapters coming (see [TODOS.md](TODOS.md))

## Installation

```sh
npm install -g promptpit
```

Or run directly:

```sh
npx promptpit <command>
```

## Usage

### Collect your config

```sh
pit collect
```

Scans for Claude Code and Cursor configs, merges them, strips secrets from MCP configs, and writes:

```
.promptpit/
├── stack.json          # Manifest (name, version, skills, compatibility)
├── agent.promptpit.md  # Agent instructions (from CLAUDE.md, .cursorrules)
├── skills/             # SKILL.md files
├── mcp.json            # MCP server configs (secrets replaced with placeholders)
└── .env.example        # Required environment variables
```

### Install a stack

```sh
pit install                              # from .promptpit/ in current dir
pit install ./path/to/.promptpit         # from local path
pit install github:user/repo             # from GitHub
pit install github:user/repo@v2.0       # specific tag or branch
pit install github:user/repo --global   # install to ~/.claude/ and ~/.cursor/
```

pit detects which AI tools are in your project and writes config in each one's format. If the repo doesn't have a `.promptpit/` bundle, pit auto-collects one from the raw configs it finds.

### Team setup

Commit `.promptpit/` to your repo. Teammates run `pit install`, everyone gets the same config.

Add `.promptpit/` to your AI tool's ignore list so it doesn't scan the raw bundle files. For Claude Code, add `.promptpit` to `ignorePatterns` in `.claude/settings.json`. For Cursor, add it to `.cursorignore`.

## Supported tools

| Tool | Read | Write | Skill format |
|------|------|-------|--------------|
| Claude Code | CLAUDE.md, .claude/skills/, .claude/settings.json | Symlinked SKILL.md | skill.md |
| Cursor | .cursorrules, .cursor/rules/, .cursor/mcp.json | Auto-converted .mdc | mdc |

pit also writes AGENTS.md (cross-tool standard, read by 60+ tools) and .mcp.json (project-level MCP config) on every install.

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
npm test          # 163 tests, vitest
npm run build     # builds dist/cli.js via tsup
npm run lint      # TypeScript strict mode check
```

## Roadmap

See [TODOS.md](TODOS.md) for the full roadmap. The big milestones:

- **v0.3 (Team Platform):** Codex and Copilot adapters, `pit check` for CI, polished drift detection
- **v0.5 (Stack Composer):** Stack composition via `extends` in stack.json, `pit diff`, `pit update`
- **v1.0 (Ecosystem Bridge):** Multi-source install (skills.sh, SkillsMP, cursor.directory), `pit publish`, `pit search`

## Related

- [Agent Skills](https://agentskills.io) - Open spec for portable AI agent skills
- [skills.sh](https://skills.sh) - Vercel's skill package manager
- [gstack](https://github.com/garrytan/gstack) - AI coding skill stack for Claude Code
- [promptpit-starter](https://github.com/nirelbaz/promptpit-starter) - Starter kit with 7 skills for Claude Code and Cursor
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol

## License

MIT
