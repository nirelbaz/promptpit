# promptpit

[![npm](https://img.shields.io/npm/v/promptpit)](https://www.npmjs.com/package/promptpit)
[![license](https://img.shields.io/github/license/nirelbaz/promptpit)](LICENSE)

Every AI coding tool stores config differently. Claude Code uses CLAUDE.md, Cursor uses .cursorrules. Sharing your setup means copy-pasting into formats that only work for one tool.

pit fixes that. Two commands: `pit collect` bundles your configs, `pit install` writes them into each tool's native format. Point it at any GitHub repo - even ones that don't use promptpit - and it auto-detects what's there.

```sh
npx promptpit install github:nirelbaz/promptpit-starter
```

## Features

- Install directly from any GitHub repo, even ones that don't use promptpit
- SKILL.md files auto-convert to .mdc for Cursor
- Commit `.promptpit/` to your repo, teammates run `pit install`, everyone gets the same setup
- Secrets are auto-stripped from MCP configs during collect
- Supports Claude Code and Cursor today, new tools are one adapter file to add

## Installation

```sh
npm install -g promptpit
```

Or run directly:

```sh
npx promptpit <command>
```

## Usage

Install someone's AI stack from GitHub:

```sh
npx promptpit install github:nirelbaz/promptpit-starter
```

This clones the repo, reads its AI tool configs, detects which tools you have locally (Claude Code, Cursor), and writes everything in each tool's format. Skills, agent instructions, MCP server configs, and env vars are all handled.

If the repo doesn't have a `.promptpit/` bundle, pit auto-collects one from the raw configs it finds.

## Collecting a stack

Bundle your project's AI tool configs into a `.promptpit/` directory:

```sh
pit collect
```

This scans for Claude Code and Cursor configs, merges them, strips secrets from MCP configs, and writes:

```
.promptpit/
├── stack.json          # Manifest (name, version, skills, compatibility)
├── agent.promptpit.md  # Agent instructions (from CLAUDE.md, .cursorrules)
├── skills/             # SKILL.md files
├── mcp.json            # MCP server configs (secrets replaced with placeholders)
└── .env.example        # Required environment variables
```

## Installing a stack

Install from a local bundle, a GitHub repo, or a specific tag:

```sh
pit install                              # from .promptpit/ in current dir
pit install ./path/to/.promptpit         # from local path
pit install github:user/repo             # from GitHub
pit install github:user/repo@v2.0       # specific tag or branch
pit install github:user/repo --global   # install to ~/.claude/ and ~/.cursor/
```

pit detects which AI tools are in your project and writes config in each one's format. Content is wrapped in idempotent markers, so multiple stacks coexist and re-installs replace cleanly.

## Team setup

Commit `.promptpit/` to your repo. Teammates install with:

```sh
pit install
```

Everyone gets the same config in their tool's format.

Add `.promptpit/` to your AI tool's ignore list so it doesn't scan the raw bundle files. For Claude Code, add `.promptpit` to `ignorePatterns` in `.claude/settings.json`. For Cursor, add it to `.cursorignore`.

## Supported tools

| Tool | Read | Write | Skill format |
|------|------|-------|--------------|
| Claude Code | CLAUDE.md, .claude/skills/, .claude/settings.json | Native SKILL.md | skill.md |
| Cursor | .cursorrules, .cursor/rules/, .cursor/mcp.json | Auto-converted .mdc | mdc |

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
npm test          # 76 tests, vitest
npm run build     # builds dist/cli.js via tsup
npm run lint      # TypeScript strict mode check
```

## Roadmap

See [TODOS.md](TODOS.md) for planned features: more adapters, AGENTS.md support, update/uninstall commands, stack composition, and a registry.

## Related

- [gstack](https://github.com/garrytan/gstack) - AI coding skill stack for Claude Code (works as a promptpit source)
- [promptpit-starter](https://github.com/nirelbaz/promptpit-starter) - starter kit with 7 skills for Claude Code and Cursor
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol, the server config format pit reads and writes

## License

MIT
