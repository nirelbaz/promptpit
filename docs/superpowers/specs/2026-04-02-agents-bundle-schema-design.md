# Add `agents/` to Bundle Schema

**Date**: 2026-04-02
**Status**: Approved
**Scope**: Schema, core pipeline, all existing adapters, tests

## Summary

Add portable custom agent definitions to the PromptPit bundle format. Agents are stored as `.promptpit/agents/<name>.md` with YAML frontmatter. During install, agents are written natively to tools that support them (Claude Code, Copilot) and inlined as instruction sections for tools that don't (Codex, Cursor, Standards/AGENTS.md).

## Motivation

AI coding tools are converging on custom agent definitions — specialized personas with constrained tool access. Claude Code has `.claude/agents/*.md`, Copilot has `.github/agents/*.agent.md`, Gemini CLI has `.gemini/agents/*.md`. PromptPit should collect and distribute these alongside instructions, skills, and MCP servers.

## Portable Agent Format

Each agent is a single markdown file in `.promptpit/agents/`:

```
.promptpit/
├── agents/
│   ├── reviewer.md
│   └── deploy-bot.md
```

File format — YAML frontmatter + markdown body:

```yaml
---
name: reviewer
description: Code review agent focused on security
tools:
  - Read
  - Grep
  - Glob
model: claude-sonnet-4-5-20250514
---

You are a security-focused code reviewer. Focus on...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent identifier (1+ chars) |
| `description` | string | Yes | Human-readable description (1+ chars) |
| `tools` | string[] | No | Allowed tools (coerced from single string) |
| `model` | string | No | Preferred model identifier |

The filename (minus `.md`) determines the agent name in the bundle. The `name` field in frontmatter is authoritative for display purposes.

## Schema Changes

### `src/shared/schema.ts`

New Zod schema and types:

```ts
export const agentFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: stringOrArray.optional(),
  model: z.string().optional(),
});

export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

export interface AgentEntry {
  name: string;
  path: string;
  frontmatter: AgentFrontmatter;
  content: string;
}
```

Update `StackManifest`:

```ts
export const stackManifestSchema = z.object({
  // ... existing fields ...
  agents: z.array(z.string()).optional(),  // NEW
});
```

Update `StackBundle`:

```ts
export interface StackBundle {
  manifest: StackManifest;
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];  // NEW
  mcpServers: McpConfig;
  envExample: Record<string, string>;
}
```

### `src/adapters/types.ts`

Update `PlatformConfig`:

```ts
export interface PlatformConfig {
  adapterId: string;
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];  // NEW
  mcpServers: McpConfig;
  rules: string[];
}
```

Update `AdapterCapabilities`:

```ts
export interface AdapterCapabilities {
  // ... existing fields ...
  agents: "native" | "inline" | "none";  // NEW
}
```

Update `PathSet`:

```ts
export interface PathSet {
  config: string;
  skills: string;
  mcp: string;
  rules?: string;
  agents?: string;  // NEW
}
```

### `src/shared/schema.ts` (install manifest)

Update `adapterInstallSchema`:

```ts
const adapterInstallSchema = z.object({
  instructions: artifactHashSchema.optional(),
  skills: z.record(artifactHashSchema).optional(),
  agents: z.record(artifactHashSchema).optional(),  // NEW
  mcp: z.record(artifactHashSchema).optional(),
});
```

## Core Pipeline Changes

### `src/core/stack.ts`

**`readStack`**: Glob `agents/*.md` in the stack directory, parse each with gray-matter, validate frontmatter with `agentFrontmatterSchema`. Agent name derived from filename.

**`writeStack`**: Write each agent to `agents/<name>.md` preserving raw content.

### `src/core/merger.ts`

**`MergedStack`**: Add `agents: AgentEntry[]`.

**`mergeConfigs`**: Dedup agents by name (first wins), matching the existing skill dedup pattern.

### `src/core/validate.ts`

**`validateStack`**: Glob `agents/*.md`, parse frontmatter, validate against `agentFrontmatterSchema`. Report errors for invalid frontmatter.

### `src/core/manifest.ts`

No schema changes beyond `adapterInstallSchema` above. Agent hashing uses existing `computeHash` on `agent.content`.

## Adapter Utils

### `src/adapters/adapter-utils.ts`

New helper `readAgentsFromDir(dir: string): Promise<AgentEntry[]>` — mirrors `readSkillsFromDir` pattern. Globs `*.md`, parses frontmatter, validates, returns entries.

New helper `formatAgentsInlineSection(agents: AgentEntry[]): string` — generates the markdown section used by inline adapters:

```markdown
## Custom Agents

### reviewer
> Code review agent focused on security
> Tools: Read, Grep, Glob

You are a security-focused code reviewer...
```

## Adapter Behaviors

### Claude Code (`agents: "native"`)

**Paths**: `agents: path.join(root, ".claude", "agents")`

**Read**: Glob `.claude/agents/*.md`, parse with `readAgentsFromDir`. Claude Code agent frontmatter matches our portable format (name, description, tools, model), so no translation needed.

**Write**: Write `.claude/agents/<name>.md` with original content. Files written directly (no symlink strategy — agents are lightweight single files, not directory-based packages).

### Copilot (`agents: "native"`)

**Paths**: `agents: path.join(root, ".github", "agents")`

**Read**: Glob `.github/agents/*.agent.md`, parse frontmatter. Translate Copilot-specific fields to portable format:
- Copilot `tools` → portable `tools`
- Copilot `mcp-servers` → dropped (not in portable format, MCP is handled separately)

**Write**: Write `.github/agents/<name>.agent.md` with translated frontmatter:
- Portable `tools` → Copilot `tools`
- Portable `name`/`description` → Copilot `name`/`description`
- Portable `model` → dropped (Copilot doesn't support per-agent model selection)

### Codex (`agents: "inline"`)

**Read**: Return empty array (no native agent system).

**Write**: Generate inline section with `formatAgentsInlineSection`, wrap in promptpit markers, append to the adapter's instruction write. Uses existing marker-based write flow.

### Cursor (`agents: "inline"`)

**Read**: Return empty array (no native agent system).

**Write**: Generate inline section with `formatAgentsInlineSection`, wrap in promptpit markers, append to the adapter's instruction write.

### Standards (`agents: "inline"`)

**Read**: Return empty array (no agent files in `.agents/` convention).

**Write**: Generate inline section with `formatAgentsInlineSection`, wrap in promptpit markers, append to AGENTS.md. This provides free-ride coverage for Windsurf, Zed, Cline, Aider (all read AGENTS.md).

## Command Changes

### `collect.ts`

- Include `agents` in bundle from merged result
- Add `agents` paths to manifest's `agents` field
- Dry-run: list agent files that would be written
- Summary: include agent count

### `install.ts`

- Pass agents to adapter writes (already happens via `StackBundle`)
- Hash agents in install manifest (parallel to skills hashing)
- Dry-run: adapters report agent files in their entries

## Inline Marker Strategy

The existing marker system uses one block per stack per file:

```
<!-- promptpit:start:stack-name:1.0.0:adapterId -->
...instructions...
<!-- promptpit:end:stack-name -->
```

Since markers key on `stackName` only, we cannot have separate marker blocks for instructions and agents in the same file. Instead, agents are appended to the instruction content **inside** the same marker block:

```
<!-- promptpit:start:stack-name:1.0.0:codex -->
...instructions...

## Custom Agents

### reviewer
> Code review agent focused on security
> Tools: Read, Grep, Glob

You are a security-focused code reviewer...
<!-- promptpit:end:stack-name -->
```

This means the inline adapters (Codex, Cursor, Standards) build the full marker content by concatenating instructions + agent section, then wrap once in markers. The `formatAgentsInlineSection` helper returns the raw markdown section (no markers), and the adapter's existing instruction write flow handles marker wrapping.

## AGENTS.md Overlap Strategy

Several tools read AGENTS.md in addition to their native config:

| Tool | Native agents? | Reads AGENTS.md? | Strategy |
|------|---------------|-------------------|----------|
| Claude Code | Yes | No | Native write only |
| Copilot | Yes | Yes | Native write; AGENTS.md inline is complementary (instruction context vs selectable agent profile) |
| Codex | No | Yes (primary) | Via Standards → AGENTS.md |
| Cursor | No | No | Inline in own instructions |
| Windsurf* | No | Yes | Via Standards → AGENTS.md (free ride) |
| Zed* | No | Yes | Via Standards → AGENTS.md (free ride) |
| Cline* | No | Yes | Via Standards → AGENTS.md (free ride) |

*No adapter yet.

For Copilot: native agents (`.github/agents/`) create selectable agent profiles with tool grants. The AGENTS.md inline is just instruction context for the default agent. These serve different purposes and are not duplicative.

## Tests

### Schema tests (`test/shared/schema.test.ts`)
- Valid agent frontmatter parses correctly
- Missing required fields rejected
- `tools` string coerced to array
- `model` optional field works

### Stack tests (`test/core/stack.test.ts`)
- `readStack` reads agents from `agents/*.md`
- `readStack` returns empty array when no agents directory
- `writeStack` writes agent files to `agents/`
- Round-trip: write then read preserves content

### Merger tests (`test/core/merger.test.ts`)
- Agents from single config pass through
- Agents deduped by name across configs
- Empty agents handled

### Validate tests (`test/core/validate.test.ts`)
- Valid agents produce no diagnostics
- Invalid frontmatter produces error diagnostics
- Missing required fields caught

### Contract tests (`test/adapters/contract.test.ts`)
- All adapters declare `agents` capability
- `PlatformConfig` includes `agents` array
- Read returns `AgentEntry[]`

### Adapter tests
- **Claude Code**: read/write `.claude/agents/*.md` round-trip
- **Copilot**: read `.github/agents/*.agent.md` with frontmatter translation; write with `.agent.md` suffix
- **Codex**: write produces inline section in instructions
- **Cursor**: write produces inline section in instructions
- **Standards**: write produces inline section in AGENTS.md

### Integration tests
- Collect picks up agents from Claude Code fixture
- Install writes agents to detected adapters
- Install manifest includes agent hashes
- Dry-run reports agent files

## Non-Goals

- Agent directories with assets (unlike skills, agents are single files)
- Reading agents from Gemini CLI, Amazon Q, Roo Code (no adapters for these yet)
- Bidirectional sync of agents
- Agent-to-agent MCP grants in portable format (Copilot-specific, handle in adapter)
