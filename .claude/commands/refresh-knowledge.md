Read the AI Stack Expert agent definition at `.claude/agents/ai-stack-expert.md` to understand your role, expertise, and methodology. Then execute the following refresh workflow.

## Scope

$ARGUMENTS

If a specific tool name was provided above (e.g., "cursor"), refresh only that tool's knowledge file. Otherwise, refresh all tools in `docs/knowledge/`.

## Workflow

### Step 0: Inventory
Read all files in `docs/knowledge/` and sort by `last-verified` date (oldest first). This is your refresh priority order.

### Step 1: Per-Tool Refresh

For each tool (or the specified tool):

1. **Read current knowledge file** from `docs/knowledge/<tool>.md`
2. **Check freshness** — if `last-verified` is less than 7 days old and no specific tool was requested, skip it
3. **Research current state** using WebSearch and WebFetch:
   - Search the tool's official documentation (URLs in the `doc-urls` frontmatter)
   - Check for recent changelog entries, blog posts, or release notes
   - Search for configuration documentation: file paths, formats, supported features
   - Search for MCP server support, agent support, rules/instructions support
   - Search for any cross-tool reading behavior (does it read AGENTS.md, .mcp.json, etc.?)
4. **Update the knowledge file** with verified findings:
   - Fill in or update all sections: Configuration, Cross-Tool Reading, Behavior, Ecosystem, Edge Cases
   - For tools with `status: adapter-exists`, update the Promptpit Gaps section by comparing what the tool supports vs what the adapter implements
   - Update `last-verified` to today's date
   - Add or update `doc-urls` with any new documentation sources discovered
5. **Do NOT modify any source code** — this command only updates knowledge files

### Step 2: Summary

After refreshing, print a summary:

```
## Knowledge Refresh Summary — YYYY-MM-DD

### Refreshed
- <tool>: <what changed or was verified>

### Skipped (recently verified)
- <tool>: last verified YYYY-MM-DD

### Breaking Changes Detected
- <any changes that affect promptpit adapters>

### New Tools Discovered
- <any new AI coding tools worth tracking>
```
