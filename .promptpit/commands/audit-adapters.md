Read the AI Stack Expert agent definition at `.claude/agents/ai-stack-expert.md` to understand your role, expertise, and methodology. Then execute the following audit workflow.

**IMPORTANT: This is a read-only audit. Do NOT modify any files — no code changes, no knowledge base updates. Read, compare, and report only.**

## Scope

$ARGUMENTS

If a specific adapter name was provided above (e.g., "cursor"), audit only that adapter. Otherwise, audit all adapters.

## Phase 1: Read Current State

Read the following files to build your understanding:

**Knowledge base:**
- All files in `docs/knowledge/` (or just the specified tool's file)

**Adapter code:**
- `src/adapters/types.ts` — the `PlatformAdapter` and `AdapterCapabilities` interfaces
- `src/adapters/registry.ts` — which adapters are registered
- `src/adapters/adapter-utils.ts` — shared translation and I/O utilities
- Each adapter file: `src/adapters/claude-code.ts`, `src/adapters/cursor.ts`, `src/adapters/codex.ts`, `src/adapters/copilot.ts`, `src/adapters/standards.ts`

**Schema:**
- `src/shared/schema.ts` — Zod schemas and TypeScript types

## Phase 2: Per-Adapter Analysis

For each adapter (tools where knowledge file has `status: adapter-exists`):

Compare what the knowledge base says the tool supports vs what the adapter code actually implements.

Check each dimension:
1. **Config paths** — Is the adapter reading/writing to all correct file locations? Are there paths the tool supports that we miss?
2. **File formats** — Are our translation functions producing valid output for the tool's current format?
3. **Feature coverage** — For each feature (instructions, skills, agents, rules, MCP, hooks): does the tool support it? Does our adapter handle it? What's missing?
4. **Cross-tool reading** — Does the knowledge base indicate this tool reads config from other tools? If so, is promptpit causing duplication by writing to both the tool's native config AND the shared config?
5. **Edge cases** — Are known quirks from the knowledge base handled in the adapter code?
6. **Schema accuracy** — Do our Zod schemas match the tool's real frontmatter/config format?
7. **Capabilities declaration** — Does the `AdapterCapabilities` object accurately reflect the tool's real capabilities?

## Phase 3: Cross-Adapter Analysis

Look across all adapters for systemic issues:

1. **Conflicts** — Do two adapters produce incompatible output for the same feature? (e.g., different MCP root keys, conflicting agent formats)
2. **Deduplication** — Is the same content written to multiple locations that a single tool reads? (e.g., Standards writes AGENTS.md + Codex also reads AGENTS.md)
3. **Standards alignment** — Is the Standards adapter consistent with what tools actually read from convention files?
4. **Missing translations** — Are there features where one adapter handles translation but another doesn't?

## Phase 4: Landscape Gaps

Review tracked tools (knowledge files with `status: tracked`):

1. Which tracked tools now have mature enough configuration systems to warrant an adapter?
2. Are there new AI coding tools not yet in the knowledge base that should be tracked?

## Output

Print the full audit report to the terminal:

```
## Adapter Audit Report — YYYY-MM-DD

### Critical Issues
Issues that are currently broken or producing incorrect output.
(If none found, say "No critical issues found.")

### Gaps
Features that tools support but our adapters don't handle.
Per adapter, list specific missing features with evidence from the knowledge base.

### Duplication Risks
Places where promptpit writes content that a tool would see twice.
Include the specific config paths and which tools are affected.

### Cross-Adapter Conflicts
Incompatible behaviors between adapters for the same feature.

### Stale Knowledge
Tools with `last-verified` older than 30 days — audit findings for these tools may be based on outdated information.

### Landscape Opportunities
Tracked tools that are ready for an adapter, and new tools worth tracking.

### Recommendations
Prioritized list of what to fix or add next, ordered by impact.
```
