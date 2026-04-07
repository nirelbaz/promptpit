---
tool: amazon-q
display-name: Amazon Q Developer
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html
  - https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html
---

## Configuration

### Instructions
- No dedicated instructions file (uses rules system)

### Skills
- No skill system documented

### MCP Servers
- Current: `~/.aws/amazonq/default.json` (global) or `.amazonq/default.json` (workspace)
- Legacy: `~/.aws/amazonq/mcp.json` or `.amazonq/mcp.json` (controlled by `useLegacyMcpJson` flag)
- Format: JSON, root key `servers` — uses an ARRAY (not object like other tools)
- Fields: `name` (required), `transport` (explicit: "stdio" or "http"), `command`, `arguments` (not `args`!), `env`, `timeout`
- Workspace config overrides global
- Enterprise: MCP governance for admin allowlist/denylist

### Agents
- No per-file agent system documented

### Rules
- Location: `.amazonq/rules/*.md` (supports subdirectories, e.g. `.amazonq/rules/frontend/react.rule.md`)
- Frontmatter: `description`, `globs`, `alwaysApply` — similar to Cursor's schema
- Rules toggled on/off via Rules button in chat UI

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: NO
- Reads .mcp.json: no
- Reads CLAUDE.md: no
- Reads .cursorrules: no

### Overlap Matrix
| Config source | Read by Amazon Q? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | no | — | None |
| .mcp.json | no | — | None |

### Deduplication Notes
- Amazon Q uses its own `.amazonq/` directory exclusively — no cross-tool reading
- Lowest duplication risk of any tool researched

## Behavior
- Continuous AWS service updates (no versioned releases)
- Available in VS Code, JetBrains, CLI, AWS Console, Slack
- Free tier + Pro tier (with IAM Identity Center)

## Ecosystem
- AWS-native — deeply integrated with AWS services
- MCP support added April 2025 (CLI), mid-2025 (IDE plugins)
- Agentic coding capacity: 1,000 interactions/month (August 2025)

## Edge Cases
- MCP uses ARRAY format (`servers: [...]`) not object — completely different from all other tools
- Uses `arguments` field instead of `args`
- Uses `transport` field instead of `type`
- `useLegacyMcpJson` flag controls which config file is used
- No AGENTS.md support — isolated ecosystem

## Promptpit Gaps
- No adapter exists yet — lower priority due to non-standard MCP format and isolated ecosystem
- MCP translation would be complex: array format, different field names (arguments vs args, transport vs type)
- Rules system (globs, alwaysApply, description) aligns well with portable format
- No AGENTS.md support means Standards adapter duplication is not a concern
