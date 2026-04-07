---
tool: roo-code
display-name: Roo Code
status: tracked
last-verified: 2026-04-07
doc-urls:
  - https://docs.roocode.com/features/custom-instructions
  - https://docs.roocode.com/features/mcp/using-mcp-in-roo
  - https://github.com/RooCodeInc/Roo-Code
---

## Configuration

### Instructions
- AGENTS.md: supported at workspace root (also AGENT.md as fallback)
- AGENTS.local.md: personal override (v3.47.0+, auto-gitignored)
- Can disable via `"roo-cline.useAgentRules": false`

### Skills
- No dedicated skill system documented

### MCP Servers
- Project: `.roo/mcp.json` (version-controllable)
- Global: via VS Code settings
- Format: JSON, root key `mcpServers`
- Extra fields: `alwaysAllow` (array of auto-approved tools), `disabled` (boolean)
- Env var interpolation: `${env:VARIABLE_NAME}`
- Project config overrides global for same server name

### Agents
- Custom Modes system: mode-specific rules and behaviors

### Rules
- Workspace (preferred): `.roo/rules/*.md` or `.roo/rules/*.txt`
- Workspace (fallback): `.roorules` file at project root
- Mode-specific: `.roo/rules-{modeSlug}/` (e.g., `.roo/rules-code/`)
- Mode-specific fallback: `.roorules-{modeSlug}` at project root
- Global: `~/.roo/rules/` and `~/.roo/rules-{modeSlug}/`
- Legacy: `.clinerules` (still loaded as fallback)
- Format: plain markdown/text, NO frontmatter schema
- Loading: recursive, alphabetical by basename (case-insensitive)
- Symlink support with max 5 resolution depth

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads .roo/rules/: yes (native)
- Reads .roorules: yes (native legacy)
- Reads .clinerules: yes (legacy compatibility fallback)
- Reads AGENTS.md / AGENT.md: yes (loads after mode-specific rules)
- Reads AGENTS.local.md: yes (v3.47.0+, personal override)
- Reads CLAUDE.md: no
- Reads .cursorrules: no
- Reads .windsurfrules: no
- Reads .mcp.json: no

### Overlap Matrix
| Config source | Read by Roo Code? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | yes | Instructions (after mode rules) | Duplication if also writing .roo/ configs |
| .clinerules | yes (fallback) | Legacy rules | Content from Cline adapter would be picked up |

### Deduplication Notes
- Reads AGENTS.md + .clinerules as fallbacks — content from other tools' adapters visible
- .roo/mcp.json is version-controllable (unlike Cline's extension storage)

## Behavior
- Forked from Cline, now independent
- VS Code extension
- Custom Modes for different coding behaviors

## Ecosystem
- Very active open-source project
- Frequent releases
- Custom Modes is a differentiating feature

## Edge Cases
- Mode-specific rules via `.roo/rules-{modeSlug}/` — unique feature
- No frontmatter in rules — plain markdown only
- Symlink support with max 5 resolution depth
- .clinerules loaded as fallback — inherited from Cline fork heritage
- AGENTS.local.md for personal overrides (auto-gitignored)

## Promptpit Gaps
- No adapter exists yet — moderate candidate
- .roo/mcp.json is project-level and version-controllable — good MCP integration point
- No rules frontmatter means limited translation from portable format
- Mode-specific rules would need special handling
- AGENTS.md support means Standards adapter content would be visible
- `.clinerules` fallback means Cline adapter content would also be visible
