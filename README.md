# promptpit

Portable AI agent stacks. Collect, install, and share across Claude Code, Cursor, and more.

## Install

```bash
npm install -g promptpit
```

## Usage

### Collect your project's AI config into a portable stack

```bash
pit collect
```

This reads your Claude Code and Cursor configs and bundles them into `.promptpit/`:

```
.promptpit/
├── stack.json          # Manifest
├── agent.promptpit.md  # Agent instructions
├── skills/             # SKILL.md files
├── mcp.json            # MCP server configs (secrets stripped)
└── .env.example        # Required environment variables
```

### Install a stack into your project

```bash
# From a local bundle
pit install .promptpit

# From GitHub
pit install github:garrytan/gstack

# Install globally (available to all projects)
pit install github:garrytan/gstack --global
```

## How it works

pit uses an adapter pattern to read and write configs for different AI tools. Each tool gets its own adapter that knows the file formats:

- **Claude Code**: CLAUDE.md, .claude/skills/SKILL.md, .claude/settings.json
- **Cursor**: .cursorrules, .cursor/rules/*.mdc, .cursor/mcp.json

Skills are automatically converted between formats (SKILL.md to .mdc for Cursor).

Secrets in MCP configs are detected and replaced with `${PLACEHOLDER}` variables. A `.env.example` is generated so you know what to fill in.

## Security

- Secrets in MCP configs are automatically stripped during `pit collect`
- YAML frontmatter is parsed with a safe schema (no code execution)
- Dangerous env var names (PATH, NODE_OPTIONS, LD_PRELOAD) are blocked during `pit install`
- MCP server installations show a warning since they run as executables

## License

MIT
