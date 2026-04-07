---
tool: codex-cli
display-name: Codex CLI
status: adapter-exists
last-verified: 2026-04-07
doc-urls:
  - https://developers.openai.com/codex/config-basic
  - https://developers.openai.com/codex/config-reference
  - https://developers.openai.com/codex/config-advanced
  - https://developers.openai.com/codex/guides/agents-md
  - https://developers.openai.com/codex/mcp
  - https://developers.openai.com/codex/skills
  - https://developers.openai.com/codex/subagents
  - https://developers.openai.com/codex/changelog
  - https://github.com/openai/codex
adapter-file: src/adapters/codex.ts
---

## Configuration

### Instructions
- File: `AGENTS.md` (project root) — primary instruction file
- Also: `AGENTS.override.md` (takes precedence over AGENTS.md at any directory level)
- User-level: `~/.codex/AGENTS.md` (or `AGENTS.override.md`)
- Loading: walks from repo root down to CWD, checking each directory for AGENTS.override.md → AGENTS.md → fallback filenames
- At most one file per directory level loaded
- Combined size truncated at `project_doc_max_bytes` (default 32 KiB, configurable in config.toml)
- `project_doc_fallback_filenames` can add alternatives like `["CLAUDE.md", "COPILOT.md"]`
- Agents inlined as `## Custom Agents` section via marker blocks (by promptpit)

### Skills
- Project: `.codex/skills/<name>/SKILL.md`
- User: `~/.codex/skills/<name>/SKILL.md`
- Also reads: `.agents/skills/` (cross-tool standard, walks from CWD up to repo root)
- Format: SKILL.md with YAML frontmatter (Agent Skills open standard)
- Optional: `agents/openai.yaml` for UI metadata, invocation policy, tool dependencies
- Optional: `scripts/`, `references/`, `assets/` subdirectories
- Progressive disclosure: name+description (~100 tokens) → full SKILL.md (<5000 tokens) → resources on demand
- Skills can be disabled via `[[skills.config]]` entries in config.toml
- Custom prompts deprecated in favor of skills

### MCP Servers
- File: `.codex/config.toml` (project) or `~/.codex/config.toml` (user)
- System-level: `/etc/codex/config.toml`
- Format: TOML, sections `[mcp_servers.<name>]`
- Fields: `command` (required), `args` (optional), `env` (optional)
- CLI management: `codex mcp add/list/login`
- OAuth support: `mcp_oauth_callback_port` and `mcp_oauth_callback_url` top-level keys
- Project-scoped MCP requires project to be "trusted"
- Does NOT read `.mcp.json`

### Agents (Subagents)
- Project: `.codex/agents/*.toml` (one TOML file per agent)
- User: `~/.codex/agents/*.toml`
- TOML fields: name (required), description, developer_instructions (multiline string), model, model_reasoning_effort, sandbox_mode, mcp_servers, skills.config, nickname_candidates
- Subagent control in `[agents]` section: max_threads (default 6), max_depth (default 1)
- Written by promptpit as: inline `## Custom Agents` section in AGENTS.md (not as TOML files)

### Rules
- Not supported

### Hooks
- Not supported

## Cross-Tool Reading

### Standards & Conventions Read
- Reads AGENTS.md: YES — this is its primary config file
- Reads AGENTS.override.md: YES — takes precedence over AGENTS.md
- Reads .agents/skills/: YES — scans walking from CWD up to repo root
- Reads .mcp.json: NO — only reads MCP from config.toml
- Reads CLAUDE.md: only if added to `project_doc_fallback_filenames` (not native)
- Reads .cursorrules: no
- Reads .github/copilot-instructions.md: no

### Overlap Matrix
| Config source | Read by Codex? | How it's used | Conflict risk |
|---|---|---|---|
| AGENTS.md | YES | Primary instructions | HIGH — shared with Standards adapter |
| .agents/skills/ | YES | Skill discovery | Skills here picked up alongside .codex/skills/ |
| .mcp.json | no | — | None |
| CLAUDE.md | only via fallback config | — | Low |

### Deduplication Notes
- Codex and Standards both use AGENTS.md — promptpit differentiates by checking for `.codex/` directory
- Marker blocks are adapter-scoped, so same-stack content appears once per adapter
- Skills at `.agents/skills/` (canonical) are discovered by Codex alongside `.codex/skills/` — writing to either works

## Behavior
- Config loading: system → user → project (walking from root to CWD), each layer merges/overrides
- AGENTS.md combined size truncated at 32 KiB default
- Project-scoped MCP requires trust confirmation

## Ecosystem
- Config system rewritten with real TOML parsing and trust-aware project layers
- Custom prompts deprecated in favor of skills
- `on-failure` approval policy deprecated; use `on-request` or `never`
- `remote_models` feature flag removed
- Subagent orchestration system added
- Agent Skills standard adopted

## Edge Cases
- Detection requires `.codex/` directory to exist — without it, AGENTS.md-only projects classified as Standards
- TOML-based agent reading via `readAgentsFromToml()` is unique to this adapter
- `project_doc_max_bytes` (32 KiB) can truncate large AGENTS.md files
- AGENTS.override.md takes precedence silently — can hide standard AGENTS.md content

## Promptpit Gaps
- **Agent write format mismatch**: Adapter uses `buildInlineContent` to embed agents inline in AGENTS.md, but Codex natively reads agents from `.codex/agents/*.toml` files. The read path (`readAgentsFromToml`) handles TOML correctly, but the write path produces Markdown inline, not TOML files.
- **Skill discovery overlap**: Codex reads from BOTH `.agents/skills/` AND `.codex/skills/`. The adapter writes to `.codex/skills/` (correct), but canonical skills at `.agents/skills/` are also picked up — potential for double-loading if both paths have the same skill.
- **MCP remote support**: `mcpRemote: false` — unverified whether Codex now supports SSE/remote MCP (OAuth support suggests it might).
- **AGENTS.override.md**: Not handled during collect — could miss overriding content.
- **project_doc_fallback_filenames**: If Codex is configured to read CLAUDE.md as fallback, it creates an unexpected cross-tool reading scenario.
