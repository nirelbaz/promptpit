---
tool: github-copilot
display-name: GitHub Copilot
status: adapter-exists
last-verified: 2026-04-07
doc-urls:
  - https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
  - https://code.visualstudio.com/docs/copilot/customization/custom-instructions
  - https://docs.github.com/en/copilot/reference/custom-agents-configuration
  - https://code.visualstudio.com/docs/copilot/customization/mcp-servers
  - https://code.visualstudio.com/docs/copilot/customization/agent-skills
  - https://github.blog/changelog/label/copilot/
adapter-file: src/adapters/copilot.ts
---

## Configuration

### Instructions
- Repository: `.github/copilot-instructions.md` — plain Markdown, no frontmatter
- User-level varies by tool:
  - Copilot CLI: `~/.copilot/copilot-instructions.md`
  - JetBrains: `~/.config/github-copilot/intellij/global-copilot-instructions.md`
  - VS Code: no standard global path yet (open issue microsoft/vscode#272199)
- Organization-level: GA as of April 2, 2026 (configured in GitHub org settings)
- Precedence: Personal > Repository > Organization (all combined, not overriding)
- Only applies to chat/agent mode, NOT inline/ghost-text suggestions

### Scoped Instructions
- Directory: `.github/instructions/*.instructions.md` (subdirectories allowed)
- Format: Markdown with YAML frontmatter
- Frontmatter fields: `applyTo` (required — files without it are ignored), `excludeAgent` (optional: "code-review" or "coding-agent")
- VS Code additional fields: `name` (display), `description` (tooltip)
- `applyTo`: glob patterns, comma-separated string or YAML array, relative to workspace root
- When matched, BOTH scoped instructions AND copilot-instructions.md are used
- PR reviews use instructions from the base branch

### Skills (Agent Skills, December 2025)
- Discovery directories (project): `.github/skills/`, `.claude/skills/`, `.agents/skills/`
- Discovery directories (personal): `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`
- Custom directories via `chat.skillsLocations` VS Code setting
- Format: SKILL.md with YAML frontmatter (Agent Skills open standard)
- Frontmatter: name (required, max 64 chars), description (required, max 1024 chars), argument-hint, user-invocable, disable-model-invocation
- Supported by 30+ tools per agentskills.io

### MCP Servers
- VS Code: `.vscode/mcp.json` — root key `"servers"` (NOT `"mcpServers"`)
  - Also: root-level `.mcp.json` discovered alongside `.vscode/mcp.json`
  - DevContainers: `devcontainer.json` under `customizations.vscode.mcp.servers`
  - Monorepo: configs discovered at every directory level from cwd to git root
  - `type` field required: `"stdio"`, `"http"`, or `"sse"`
  - Supports: `envFile`, `sandboxEnabled`, `sandbox` (filesystem/network restrictions)
  - `inputs` array for secret prompting (`promptString` type)
  - Env var expansion: `${input:id}` for secrets
- Copilot CLI: `~/.copilot/mcp-config.json` — root key `"mcpServers"` (different from VS Code!)
  - Repo-level: `.copilot/mcp-config.json`
  - Types: `"local"` (not `"stdio"`!), `"http"`, `"sse"`
  - Extra field: `tools` — `"*"` or array of tool names to whitelist

### Agents
- Strategy: native (per-file)
- Repository: `.github/agents/*.agent.md` (both `.agent.md` and `.md` accepted)
- Organization: `.github-private/agents/` (enterprise)
- Filename rules: only `.`, `-`, `_`, `a-z`, `A-Z`, `0-9`
- Frontmatter: name, description (required), tools (list or `"*"`), model (supported in VS Code/JetBrains/Eclipse/Xcode), target ("vscode" or "github-copilot"), disable-model-invocation, user-invocable, mcp-servers (agent-specific MCP), metadata
- `model` field: YES supported (string, autocomplete dropdown in VS Code). Coding agent (cloud) strips it.
- `infer` field: RETIRED — use `disable-model-invocation` + `user-invocable`
- Tools format: `["*"]` = all, `[]` = none, `["read", "edit"]` = specific, `"mcp-server/tool"` = namespaced
- Max prompt body: 30,000 characters

### Rules
- Shares directory with scoped instructions: `.github/instructions/*.instructions.md`
- Uses `applyTo` frontmatter for glob scoping (mapped from portable `globs`)
- Naming: `rule-` prefix added by promptpit

### Hooks
- Not supported (in the promptpit sense — Copilot has its own event system)

### Prompt Files
- `.github/prompts/*.prompt.md` — reusable prompt templates
- Can reference files with `#file:path/to/file.ts`
- Available in VS Code, Visual Studio, JetBrains

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: YES (since August 2025, requires `chat.useAgentsMdFile: true` in VS Code)
- Reads CLAUDE.md: YES (requires `chat.useClaudeMdFile: true`, checks `.claude/CLAUDE.md` and `~/.claude/CLAUDE.md`)
- Reads .mcp.json: YES (at project root, alongside `.vscode/mcp.json`)
- Reads .cursorrules: no
- Reads .agents/skills/: YES (Agent Skills discovery)
- Reads .claude/skills/: YES (Agent Skills discovery)
- Reads .github/skills/: YES (native)

### Overlap Matrix
| Config source | Read by Copilot? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | YES (with setting) | Instructions | HIGH — if also writing copilot-instructions.md with same content |
| CLAUDE.md | YES (with setting) | Instructions | HIGH — if enabled, instructions appear twice |
| .mcp.json | YES | MCP servers | Duplication if also writing .vscode/mcp.json |
| .cursorrules | no | — | None |
| .agents/skills/ | YES | Skill discovery | Skills found here + .github/skills/ could duplicate |

### Deduplication Notes
- Copilot reads AGENTS.md, CLAUDE.md, .mcp.json, AND its own config files — HIGH duplication risk
- If promptpit writes instructions to BOTH Standards (AGENTS.md) AND Copilot (.github/copilot-instructions.md), content appears twice when `chat.useAgentsMdFile` is enabled
- MCP: if Standards writes to `.mcp.json` AND Copilot adapter writes to `.vscode/mcp.json`, servers may appear twice
- Skills at `.agents/skills/` (canonical) are discovered alongside `.github/skills/` — no need to install to both

## Behavior
- Instructions automatically added on file save (no restart needed)
- Multiple instruction types combined (no guaranteed order)
- For PR reviews, instructions from base branch used
- Workspace MCP servers only loaded after folder trust confirmation
- Coding agent runs in GitHub Actions environment, customized via `copilot-setup-steps.yml`
- Default firewall limits network access; org admins can configure

## Ecosystem
- Two execution contexts: Agent Mode (VS Code, local) and Coding Agent (cloud, GitHub Actions)
- Agent Skills adopted December 2025 — cross-tool standard
- Copilot Extensions (GitHub Apps) sunsetted November 10, 2025 → MCP is the replacement
- Organization instructions GA April 2, 2026
- Org firewall settings for coding agent April 2026
- Multiple model deprecations throughout 2025-2026

## Edge Cases
- Skills and rules share `.github/instructions/` directory — naming convention (`rule-` prefix) prevents collisions
- Agent reading uses broad `*.md` glob to catch both `.agent.md` and plain `.md`
- VS Code MCP uses root key `"servers"`, Copilot CLI uses `"mcpServers"` — different schemas!
- Copilot CLI uses `"local"` type instead of `"stdio"` for subprocess servers
- `type` field is added during translation but ignored during hash comparison (`computeMcpServerHash`)
- `model` field supported in IDE agents but stripped by coding agent (cloud)
- `infer` frontmatter property retired — replaced by `disable-model-invocation` + `user-invocable`

## Promptpit Gaps
- **AGENTS.md cross-reading**: Copilot reads AGENTS.md (with VS Code setting). If promptpit writes to BOTH AGENTS.md (Standards) AND `.github/copilot-instructions.md` (Copilot adapter), instructions appear twice. Need deduplication or conditional write.
- **CLAUDE.md cross-reading**: Copilot can read CLAUDE.md — same duplication concern if both Claude Code and Copilot adapters are active.
- **.mcp.json cross-reading**: Copilot reads `.mcp.json` at project root. If Standards writes there AND Copilot adapter writes to `.vscode/mcp.json`, MCP servers duplicated.
- **Model field supported**: Copilot now supports `model` in agent frontmatter (in IDE context). Adapter currently strips it during translation — may want to preserve for IDE agents.
- **Agent frontmatter fields**: `target`, `mcp-servers`, `metadata`, `disable-model-invocation`, `user-invocable` not handled in translation.
- **Prompt files**: `.github/prompts/*.prompt.md` is a potential install target not currently handled.
- **Copilot CLI MCP**: Different schema (root key `mcpServers`, type `local`) — adapter only handles VS Code format.
- **Skill discovery**: Copilot discovers skills from `.agents/skills/`, `.claude/skills/`, `.github/skills/` — canonical install to `.agents/skills/` may be sufficient.
