# Add `agents/` to Bundle Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portable custom agent definitions (`.promptpit/agents/*.md`) to the PromptPit bundle format, with native write support for Claude Code and Copilot, and inline fallback for all other adapters.

**Architecture:** Agents follow the same pattern as skills — a Zod schema for frontmatter validation, an `AgentEntry` interface threaded through the pipeline (read → merge → collect/install → adapter write). Native adapters write agent files directly; inline adapters append a `## Custom Agents` section inside the existing marker block.

**Tech Stack:** TypeScript, Zod, gray-matter, fast-glob, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shared/schema.ts` | Modify | Add `agentFrontmatterSchema`, `AgentEntry`, update `StackManifest`, `StackBundle`, `adapterInstallSchema` |
| `src/adapters/types.ts` | Modify | Add `agents` to `PlatformConfig`, `AdapterCapabilities`, `PathSet` |
| `src/adapters/adapter-utils.ts` | Modify | Add `readAgentsFromDir()`, `formatAgentsInlineSection()` |
| `src/core/stack.ts` | Modify | Read/write agents in `readStack`/`writeStack` |
| `src/core/merger.ts` | Modify | Add agents to `MergedStack`, dedup in `mergeConfigs` |
| `src/core/validate.ts` | Modify | Validate agent frontmatter |
| `src/commands/collect.ts` | Modify | Include agents in bundle + dry-run report |
| `src/commands/install.ts` | Modify | Hash agents in manifest |
| `src/adapters/claude-code.ts` | Modify | Native agent read/write |
| `src/adapters/copilot.ts` | Modify | Native agent read/write with frontmatter translation |
| `src/adapters/codex.ts` | Modify | Inline agents in marker block |
| `src/adapters/cursor.ts` | Modify | Inline agents in marker block |
| `src/adapters/standards.ts` | Modify | Inline agents in marker block |
| `test/__fixtures__/stacks/valid-stack/` | Modify | Add agent fixture |
| `test/shared/schema.test.ts` | Modify | Agent schema tests |
| `test/core/stack.test.ts` | Modify | Agent read/write tests |
| `test/core/merger.test.ts` | Modify | Agent merge tests |
| `test/core/validate.test.ts` | Modify | Agent validation tests |
| `test/adapters/contract.test.ts` | Modify | Agent contract checks |
| `test/adapters/claude-code.test.ts` | Modify | Native agent read/write |
| `test/adapters/copilot.test.ts` | Modify | Native agent read/write |

---

### Task 1: Schema — `agentFrontmatterSchema` and types

**Files:**
- Modify: `src/shared/schema.ts`
- Modify: `test/shared/schema.test.ts`

- [ ] **Step 1: Write failing tests for `agentFrontmatterSchema`**

Add to `test/shared/schema.test.ts`:

```ts
import { agentFrontmatterSchema } from "../../src/shared/schema.js";

describe("agentFrontmatterSchema", () => {
  it("validates minimal agent frontmatter", () => {
    const valid = { name: "reviewer", description: "Code review agent" };
    const result = agentFrontmatterSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires name and description", () => {
    const missing = { name: "no-desc" };
    const result = agentFrontmatterSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it("accepts optional tools as array", () => {
    const input = { name: "r", description: "d", tools: ["Read", "Grep"] };
    const result = agentFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data!.tools).toEqual(["Read", "Grep"]);
  });

  it("coerces tools string to array", () => {
    const input = { name: "r", description: "d", tools: "Read" };
    const result = agentFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data!.tools).toEqual(["Read"]);
  });

  it("accepts optional model field", () => {
    const input = { name: "r", description: "d", model: "claude-sonnet-4-5-20250514" };
    const result = agentFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data!.model).toBe("claude-sonnet-4-5-20250514");
  });

  it("rejects empty name", () => {
    const input = { name: "", description: "d" };
    const result = agentFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
```

Also add a test for the updated `stackManifestSchema`:

```ts
it("accepts optional agents field", () => {
  const valid = {
    name: "my-stack",
    version: "1.0.0",
    agents: ["agents/reviewer"],
  };
  const result = stackManifestSchema.safeParse(valid);
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/shared/schema.test.ts`
Expected: FAIL — `agentFrontmatterSchema` not found

- [ ] **Step 3: Implement the schema changes**

In `src/shared/schema.ts`, add after `skillFrontmatterSchema`:

```ts
// --- Agent Frontmatter ---

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

Add `agents` to `stackManifestSchema`:

```ts
agents: z.array(z.string()).optional(),
```

Add `agents` to `StackBundle`:

```ts
export interface StackBundle {
  manifest: StackManifest;
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcpServers: McpConfig;
  envExample: Record<string, string>;
}
```

Add `agents` to `adapterInstallSchema`:

```ts
const adapterInstallSchema = z.object({
  instructions: artifactHashSchema.optional(),
  skills: z.record(artifactHashSchema).optional(),
  agents: z.record(artifactHashSchema).optional(),
  mcp: z.record(artifactHashSchema).optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run test/shared/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/schema.ts test/shared/schema.test.ts
git commit -m "feat: add agentFrontmatterSchema and AgentEntry to schema"
```

---

### Task 2: Adapter types — add agents to `PlatformConfig`, `AdapterCapabilities`, `PathSet`

**Files:**
- Modify: `src/adapters/types.ts`

- [ ] **Step 1: Update types**

In `src/adapters/types.ts`:

Add to imports:

```ts
import type { StackBundle, McpConfig, SkillEntry, AgentEntry } from "../shared/schema.js";
```

Add `agents` to `PathSet`:

```ts
export interface PathSet {
  config: string;
  skills: string;
  mcp: string;
  rules?: string;
  agents?: string;
}
```

Add `agents` to `AdapterCapabilities`:

```ts
export interface AdapterCapabilities {
  skillLinkStrategy: "symlink" | "translate-copy" | "none";
  rules: boolean;
  skillFormat: "skill.md" | "mdc" | "md";
  mcpStdio: boolean;
  mcpRemote: boolean;
  mcpFormat: "json" | "toml";
  mcpRootKey: string;
  agentsmd: boolean;
  hooks: boolean;
  agents: "native" | "inline" | "none";
}
```

Add `agents` to `PlatformConfig`:

```ts
export interface PlatformConfig {
  adapterId: string;
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcpServers: McpConfig;
  rules: string[];
}
```

- [ ] **Step 2: Fix all TypeScript errors**

This change breaks every adapter's `read()` (missing `agents` in returned config) and every adapter's `capabilities` (missing `agents`). Do NOT fix them yet — they will be fixed adapter-by-adapter in Tasks 5-9. For now, just verify the types compile:

Run: `npm run lint`
Expected: Type errors in adapter files (expected — will fix in later tasks)

- [ ] **Step 3: Commit**

```bash
git add src/adapters/types.ts
git commit -m "feat: add agents to PlatformConfig, AdapterCapabilities, PathSet"
```

---

### Task 3: Adapter utils — `readAgentsFromDir` and `formatAgentsInlineSection`

**Files:**
- Modify: `src/adapters/adapter-utils.ts`
- Modify: `test/adapters/adapter-utils.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/adapters/adapter-utils.test.ts`:

```ts
import { readAgentsFromDir, formatAgentsInlineSection } from "../../src/adapters/adapter-utils.js";
import type { AgentEntry } from "../../src/shared/schema.js";

describe("readAgentsFromDir", () => {
  it("reads agent files from a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(
      path.join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
    );
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("reviewer");
    expect(agents[0]!.path).toBe("agents/reviewer");
    expect(agents[0]!.frontmatter.description).toBe("Code review agent");
    expect(agents[0]!.frontmatter.tools).toEqual(["Read", "Grep"]);
    expect(agents[0]!.content).toContain("Review code carefully.");
    await rm(dir, { recursive: true });
  });

  it("returns empty array for missing directory", async () => {
    const agents = await readAgentsFromDir("/tmp/nonexistent-agents-dir");
    expect(agents).toEqual([]);
  });

  it("skips files with invalid frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(path.join(dir, "bad.md"), "---\nname: bad\n---\n\nNo description.\n");
    const agents = await readAgentsFromDir(dir);
    expect(agents).toEqual([]);
    await rm(dir, { recursive: true });
  });
});

describe("formatAgentsInlineSection", () => {
  it("formats agents as markdown section", () => {
    const agents: AgentEntry[] = [
      {
        name: "reviewer",
        path: "agents/reviewer",
        frontmatter: { name: "reviewer", description: "Code review agent", tools: ["Read", "Grep"] },
        content: "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("## Custom Agents");
    expect(result).toContain("### reviewer");
    expect(result).toContain("Code review agent");
    expect(result).toContain("Tools: Read, Grep");
    expect(result).toContain("Review code carefully.");
  });

  it("formats agent without tools", () => {
    const agents: AgentEntry[] = [
      {
        name: "helper",
        path: "agents/helper",
        frontmatter: { name: "helper", description: "General helper" },
        content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("### helper");
    expect(result).toContain("General helper");
    expect(result).not.toContain("Tools:");
    expect(result).toContain("Help with tasks.");
  });

  it("returns empty string for empty array", () => {
    const result = formatAgentsInlineSection([]);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/adapters/adapter-utils.test.ts`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement `readAgentsFromDir`**

Add to `src/adapters/adapter-utils.ts`:

```ts
import type { SkillEntry, McpConfig, AgentEntry } from "../shared/schema.js";
import { skillFrontmatterSchema, agentFrontmatterSchema } from "../shared/schema.js";
```

```ts
export async function readAgentsFromDir(
  agentsDir: string,
): Promise<AgentEntry[]> {
  const agentFiles = await fg("*.md", {
    cwd: agentsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const agents: AgentEntry[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const validation = agentFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => e.message).join(", ");
      log.warn(`Skipping ${file}: invalid agent frontmatter (${reasons})`);
      continue;
    }

    const agentName = path.basename(file, ".md");
    agents.push({
      name: agentName,
      path: `agents/${agentName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return agents;
}
```

- [ ] **Step 4: Implement `formatAgentsInlineSection`**

Add to `src/adapters/adapter-utils.ts`:

```ts
export function formatAgentsInlineSection(agents: AgentEntry[]): string {
  if (agents.length === 0) return "";

  const sections = agents.map((agent) => {
    const fm = agent.frontmatter;
    const parsed = matter(agent.content, SAFE_MATTER_OPTIONS as never);
    const body = parsed.content.trim();

    let header = `### ${fm.name}\n> ${fm.description}`;
    if (fm.tools && fm.tools.length > 0) {
      header += `\n> Tools: ${fm.tools.join(", ")}`;
    }

    return `${header}\n\n${body}`;
  });

  return `## Custom Agents\n\n${sections.join("\n\n")}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run test/adapters/adapter-utils.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/adapter-utils.ts test/adapters/adapter-utils.test.ts
git commit -m "feat: add readAgentsFromDir and formatAgentsInlineSection helpers"
```

---

### Task 4: Core pipeline — stack read/write, merger, validate

**Files:**
- Modify: `src/core/stack.ts`
- Modify: `src/core/merger.ts`
- Modify: `src/core/validate.ts`
- Modify: `test/core/stack.test.ts`
- Modify: `test/core/merger.test.ts`
- Modify: `test/core/validate.test.ts`
- Modify: `test/__fixtures__/stacks/valid-stack/stack.json`
- Create: `test/__fixtures__/stacks/valid-stack/agents/reviewer.md`

- [ ] **Step 1: Add agent fixture**

Create `test/__fixtures__/stacks/valid-stack/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Code review agent focused on security
tools:
  - Read
  - Grep
  - Glob
---

You are a security-focused code reviewer. Focus on OWASP top 10 vulnerabilities.
```

Update `test/__fixtures__/stacks/valid-stack/stack.json`:

```json
{
  "name": "test-stack",
  "version": "1.0.0",
  "description": "A test stack for fixtures",
  "skills": ["skills/browse"],
  "agents": ["agents/reviewer"],
  "compatibility": ["claude-code"]
}
```

- [ ] **Step 2: Write failing tests for stack read/write**

Add to `test/core/stack.test.ts`:

```ts
describe("readStack", () => {
  // ... existing tests ...

  it("reads agents from agents/ directory", async () => {
    const bundle = await readStack(VALID_STACK);
    expect(bundle.agents).toHaveLength(1);
    expect(bundle.agents[0]!.name).toBe("reviewer");
    expect(bundle.agents[0]!.frontmatter.tools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("returns empty agents array when no agents directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-test-"));
    await writeFile(
      path.join(dir, "stack.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }),
    );
    const bundle = await readStack(dir);
    expect(bundle.agents).toEqual([]);
    await rm(dir, { recursive: true });
  });
});

describe("writeStack", () => {
  it("writes agents to agents/ directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-write-"));
    const outputDir = path.join(dir, ".promptpit");
    const bundle = await readStack(VALID_STACK);
    await writeStack(outputDir, bundle);

    const agentContent = await readFile(
      path.join(outputDir, "agents", "reviewer.md"),
      "utf-8",
    );
    expect(agentContent).toContain("security-focused code reviewer");
    await rm(dir, { recursive: true });
  });
});
```

- [ ] **Step 3: Write failing tests for merger**

Add to `test/core/merger.test.ts`:

```ts
import type { AgentEntry } from "../../src/shared/schema.js";

// Helper to build a minimal AgentEntry
function makeAgent(name: string): AgentEntry {
  return {
    name,
    path: `agents/${name}`,
    frontmatter: { name, description: `${name} agent` },
    content: `---\nname: ${name}\ndescription: ${name} agent\n---\n\nDo ${name} things.\n`,
  };
}

describe("mergeConfigs agents", () => {
  it("passes through agents from a single config", () => {
    const config: PlatformConfig = {
      adapterId: "claude-code",
      agentInstructions: "",
      skills: [],
      agents: [makeAgent("reviewer")],
      mcpServers: {},
      rules: [],
    };
    const result = mergeConfigs([config]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.name).toBe("reviewer");
  });

  it("deduplicates agents by name across configs", () => {
    const config1: PlatformConfig = {
      adapterId: "claude-code",
      agentInstructions: "",
      skills: [],
      agents: [makeAgent("reviewer")],
      mcpServers: {},
      rules: [],
    };
    const config2: PlatformConfig = {
      adapterId: "copilot",
      agentInstructions: "",
      skills: [],
      agents: [makeAgent("reviewer"), makeAgent("deployer")],
      mcpServers: {},
      rules: [],
    };
    const result = mergeConfigs([config1, config2]);
    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.name)).toEqual(["reviewer", "deployer"]);
  });

  it("handles empty agents", () => {
    const config: PlatformConfig = {
      adapterId: "test",
      agentInstructions: "",
      skills: [],
      agents: [],
      mcpServers: {},
      rules: [],
    };
    const result = mergeConfigs([config]);
    expect(result.agents).toEqual([]);
  });
});
```

- [ ] **Step 4: Write failing test for validate**

Add to `test/core/validate.test.ts`:

```ts
it("reports error for agent with invalid frontmatter", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
  await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
  await mkdir(path.join(dir, "agents"), { recursive: true });
  await writeFile(
    path.join(dir, "agents", "bad.md"),
    "---\nname: bad\n---\n\nMissing description.\n",
  );
  const result = await validateStack(dir);
  const agentDiags = result.diagnostics.filter((d) => d.file.includes("agents/"));
  expect(agentDiags.length).toBeGreaterThan(0);
  expect(agentDiags[0]!.level).toBe("error");
  await rm(dir, { recursive: true });
});

it("passes validation for valid agents", async () => {
  const result = await validateStack(VALID_STACK);
  const agentDiags = result.diagnostics.filter((d) => d.file.includes("agents/"));
  expect(agentDiags).toHaveLength(0);
});
```

- [ ] **Step 5: Run all tests to verify they fail**

Run: `npm test -- --run test/core/stack.test.ts test/core/merger.test.ts test/core/validate.test.ts`
Expected: FAIL

- [ ] **Step 6: Implement `readStack` agents support**

In `src/core/stack.ts`, add import:

```ts
import { readSkillsFromDir, readAgentsFromDir } from "../adapters/adapter-utils.js";
```

In `readStack()`, after the skills read block, add:

```ts
const agentsDir = path.join(stackDir, "agents");
const agents = await readAgentsFromDir(agentsDir);
```

Update the return to include `agents`:

```ts
return {
  manifest: manifestResult.data,
  agentInstructions,
  skills,
  agents,
  mcpServers,
  envExample,
};
```

- [ ] **Step 7: Implement `writeStack` agents support**

In `writeStack()`, after the skills write loop, add:

```ts
for (const agent of bundle.agents) {
  await writeFileEnsureDir(
    path.join(outputDir, "agents", `${agent.name}.md`),
    agent.content,
  );
}
```

- [ ] **Step 8: Implement merger agents support**

In `src/core/merger.ts`, update `MergedStack`:

```ts
import type { SkillEntry, McpConfig, AgentEntry } from "../shared/schema.js";

export interface MergedStack {
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcpServers: McpConfig;
  rules: string[];
}
```

In `mergeConfigs`, handle empty case:

```ts
if (configs.length === 0) {
  return { agentInstructions: "", skills: [], agents: [], mcpServers: {}, rules: [], warnings: [] };
}
```

Handle single config:

```ts
if (configs.length === 1) {
  const c = configs[0]!;
  return {
    agentInstructions: c.agentInstructions,
    skills: c.skills,
    agents: c.agents,
    mcpServers: c.mcpServers,
    rules: c.rules,
    warnings: [],
  };
}
```

Add agent dedup after skill dedup (same pattern):

```ts
const seenAgents = new Map<string, AgentEntry>();
for (const config of configs) {
  for (const agent of config.agents) {
    if (!seenAgents.has(agent.name)) {
      seenAgents.set(agent.name, agent);
    }
  }
}
```

Update multi-config return:

```ts
return {
  agentInstructions: instructions,
  skills: [...seenSkills.values()],
  agents: [...seenAgents.values()],
  mcpServers: seenMcp,
  rules,
  warnings,
};
```

- [ ] **Step 9: Implement validate agents support**

In `src/core/validate.ts`, add import:

```ts
import {
  stackManifestSchema,
  mcpConfigSchema,
  skillFrontmatterSchema,
  agentFrontmatterSchema,
} from "../shared/schema.js";
```

In `validateStack`, add to the parallel file reads:

```ts
const agentsDir = path.join(stackDir, "agents");
const [manifestRaw, agentRaw, skillFiles, agentFiles, mcpRaw, envRaw] = await Promise.all([
  readFileOrNull(path.join(stackDir, "stack.json")),
  readFileOrNull(path.join(stackDir, "agent.promptpit.md")),
  fg("*/SKILL.md", { cwd: skillsDir, absolute: true }).catch(() => [] as string[]),
  fg("*.md", { cwd: agentsDir, absolute: true }).catch(() => [] as string[]),
  readFileOrNull(path.join(stackDir, "mcp.json")),
  readFileOrNull(path.join(stackDir, ".env.example")),
]);
```

After the skills validation block, add:

```ts
// --- agents/*.md (optional) ---
const agentContents = await Promise.all(
  agentFiles.map(async (file) => ({
    file,
    agentName: path.basename(file, ".md"),
    raw: await readFileOrNull(file),
  })),
);
for (const { agentName, raw } of agentContents) {
  const relPath = `agents/${agentName}.md`;
  if (!raw) continue;
  try {
    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const result = agentFrontmatterSchema.safeParse(parsed.data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        addDiag(diagnostics, relPath, "error", `${issue.path.join(".")}: ${issue.message}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    addDiag(diagnostics, relPath, "error", `Invalid frontmatter: ${msg}`);
  }
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test -- --run test/core/stack.test.ts test/core/merger.test.ts test/core/validate.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/core/stack.ts src/core/merger.ts src/core/validate.ts \
  test/core/stack.test.ts test/core/merger.test.ts test/core/validate.test.ts \
  test/__fixtures__/stacks/valid-stack/agents/reviewer.md \
  test/__fixtures__/stacks/valid-stack/stack.json
git commit -m "feat: add agents to stack read/write, merger, and validate"
```

---

### Task 5: Claude Code adapter — native agent read/write

**Files:**
- Modify: `src/adapters/claude-code.ts`
- Modify: `test/adapters/claude-code.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/adapters/claude-code.test.ts`:

```ts
describe("agent read/write", () => {
  it("reads agents from .claude/agents/", async () => {
    const agentsDir = path.join(tmpDir, ".claude", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );
    const config = await claudeCodeAdapter.read(tmpDir);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.name).toBe("reviewer");
  });

  it("writes agents to .claude/agents/", async () => {
    const bundle = await readStack(VALID_STACK);
    await claudeCodeAdapter.write(tmpDir, bundle, {});
    const content = await readFile(
      path.join(tmpDir, ".claude", "agents", "reviewer.md"),
      "utf-8",
    );
    expect(content).toContain("security-focused code reviewer");
  });

  it("returns empty agents when no .claude/agents/ exists", async () => {
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Test");
    const config = await claudeCodeAdapter.read(tmpDir);
    expect(config.agents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/adapters/claude-code.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement native agent support in Claude Code adapter**

In `src/adapters/claude-code.ts`:

Add imports:

```ts
import { readSkillsFromDir, readAgentsFromDir, readMcpFromSettings, writeWithMarkers, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, skillDryRunEntry } from "./adapter-utils.js";
```

Update `projectPaths` to add `agents`:

```ts
function projectPaths(root: string) {
  return {
    config: path.join(root, "CLAUDE.md"),
    skills: path.join(root, ".claude", "skills"),
    mcp: path.join(root, ".claude", "settings.json"),
    agents: path.join(root, ".claude", "agents"),
  };
}
```

Update `userPaths` similarly:

```ts
function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".claude", "CLAUDE.md"),
    skills: path.join(home, ".claude", "skills"),
    mcp: path.join(home, ".claude", "settings.json"),
    agents: path.join(home, ".claude", "agents"),
  };
}
```

Update `detect` to also check for agents dir:

```ts
if (await exists(p.agents)) found.push(p.agents);
```

Update `read` to include agents:

```ts
const agents = await readAgentsFromDir(path.join(root, ".claude", "agents"));

return {
  adapterId: "claude-code",
  agentInstructions,
  skills,
  agents,
  mcpServers,
  rules: [],
};
```

Update `write` to write agents natively, after the skills block:

```ts
// Write agents to .claude/agents/
for (const agent of stack.agents) {
  const dest = path.join(p.agents!, agent.name + ".md");
  if (opts.dryRun) {
    dryRunEntries.push({
      file: dest,
      action: (await exists(dest)) ? "modify" : "create",
    });
  } else {
    await writeFileEnsureDir(dest, agent.content);
    filesWritten.push(dest);
  }
}
```

Update `capabilities`:

```ts
capabilities: {
  // ... existing ...
  agents: "native",
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run test/adapters/claude-code.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude-code.ts test/adapters/claude-code.test.ts
git commit -m "feat: add native agent read/write to Claude Code adapter"
```

---

### Task 6: Copilot adapter — native agent read/write with frontmatter translation

**Files:**
- Modify: `src/adapters/copilot.ts`
- Modify: `test/adapters/copilot.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/adapters/copilot.test.ts`:

```ts
import { agentToGitHubAgent, gitHubAgentToPortable } from "../../src/adapters/copilot.js";

describe("agent translation", () => {
  it("translates portable agent to GitHub .agent.md format", () => {
    const content = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n  - Grep\n---\n\nReview code.\n";
    const result = agentToGitHubAgent(content);
    expect(result).toContain("name: reviewer");
    expect(result).toContain("description: Security reviewer");
    expect(result).toContain("tools:");
    expect(result).toContain("- Read");
    expect(result).not.toContain("model:");
    expect(result).toContain("Review code.");
  });
});

describe("agent read/write", () => {
  it("reads agents from .github/agents/", async () => {
    const agentsDir = path.join(tmpDir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "reviewer.agent.md"),
      "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );
    const config = await copilotAdapter.read(tmpDir);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.name).toBe("reviewer");
  });

  it("writes agents to .github/agents/ with .agent.md extension", async () => {
    const bundle = await readStack(VALID_STACK);
    await mkdir(path.join(tmpDir, ".github"), { recursive: true });
    await writeFile(path.join(tmpDir, ".github", "copilot-instructions.md"), "# Test");
    await copilotAdapter.write(tmpDir, bundle, {});
    const content = await readFile(
      path.join(tmpDir, ".github", "agents", "reviewer.agent.md"),
      "utf-8",
    );
    expect(content).toContain("reviewer");
    expect(content).toContain("security-focused code reviewer");
  });

  it("returns empty agents when no .github/agents/ exists", async () => {
    await mkdir(path.join(tmpDir, ".github"), { recursive: true });
    await writeFile(path.join(tmpDir, ".github", "copilot-instructions.md"), "# Test");
    const config = await copilotAdapter.read(tmpDir);
    expect(config.agents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/adapters/copilot.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agent translation functions**

Add to `src/adapters/copilot.ts`:

```ts
import { readAgentsFromDir } from "./adapter-utils.js";
import type { AgentEntry } from "../shared/schema.js";
```

```ts
// Translate portable agent to Copilot .agent.md format
// Copilot agents use: name, description, tools (no model field)
export function agentToGitHubAgent(agentContent: string): string {
  const parsed = matter(agentContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  const copilotFm: Record<string, unknown> = {};
  if (fm.name) copilotFm.name = fm.name;
  if (fm.description) copilotFm.description = fm.description;
  if (fm.tools) copilotFm.tools = fm.tools;
  // model is dropped — Copilot doesn't support per-agent model selection

  const yamlStr = Object.entries(copilotFm)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}`;
      }
      return `${k}: ${v}`;
    })
    .join("\n");

  return `---\n${yamlStr}\n---\n\n${parsed.content.trim()}\n`;
}

// Read Copilot .agent.md files — frontmatter is compatible with portable format
async function readCopilotAgents(agentsDir: string): Promise<AgentEntry[]> {
  const agentFiles = await fg("*.agent.md", {
    cwd: agentsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const agents: AgentEntry[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const data = parsed.data as Record<string, unknown>;

    // Copilot uses same fields (name, description, tools) — direct parse
    const validation = agentFrontmatterSchema.safeParse(data);
    if (!validation.success) {
      log.warn(`Skipping ${file}: invalid agent frontmatter`);
      continue;
    }

    // Strip .agent.md suffix for name
    const agentName = path.basename(file, ".agent.md");
    agents.push({
      name: agentName,
      path: `agents/${agentName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return agents;
}
```

Add the import for `agentFrontmatterSchema`:

```ts
import { agentFrontmatterSchema } from "../shared/schema.js";
```

- [ ] **Step 4: Update Copilot adapter paths, read, write, capabilities**

Update `projectPaths`:

```ts
function projectPaths(root: string) {
  return {
    config: path.join(root, ".github", "copilot-instructions.md"),
    skills: path.join(root, ".github", "instructions"),
    mcp: path.join(root, ".vscode", "mcp.json"),
    rules: path.join(root, ".github", "instructions"),
    agents: path.join(root, ".github", "agents"),
  };
}
```

Update `userPaths` similarly (add `agents`).

Update `read`:

```ts
const agents = await readCopilotAgents(path.join(root, ".github", "agents"));

return {
  adapterId: "copilot",
  agentInstructions,
  skills: [],
  agents,
  mcpServers,
  rules,
};
```

Update `write`, after the skills block:

```ts
// Write agents to .github/agents/*.agent.md
for (const agent of stack.agents) {
  const translated = agentToGitHubAgent(agent.content);
  const dest = path.join(p.agents!, `${agent.name}.agent.md`);
  if (opts.dryRun) {
    dryRunEntries.push({
      file: dest,
      action: (await exists(dest)) ? "modify" : "create",
      detail: "translate to .agent.md",
    });
  } else {
    await writeFileEnsureDir(dest, translated);
    filesWritten.push(dest);
  }
}
```

Update `capabilities`:

```ts
capabilities: {
  // ... existing ...
  agents: "native",
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run test/adapters/copilot.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/copilot.ts test/adapters/copilot.test.ts
git commit -m "feat: add native agent read/write to Copilot adapter"
```

---

### Task 7: Inline adapters — Codex, Cursor, Standards

**Files:**
- Modify: `src/adapters/codex.ts`
- Modify: `src/adapters/cursor.ts`
- Modify: `src/adapters/standards.ts`
- Modify: `test/adapters/codex.test.ts`

- [ ] **Step 1: Write failing test for inline agent writing**

Add to `test/adapters/codex.test.ts` (or create a new focused test):

```ts
describe("inline agent writing", () => {
  it("includes agents in marker block when writing instructions", async () => {
    const bundle = await readStack(VALID_STACK);
    await writeFile(path.join(tmpDir, "AGENTS.md"), "");
    await codexAdapter.write(tmpDir, bundle, {});
    const content = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("## Custom Agents");
    expect(content).toContain("### reviewer");
    expect(content).toContain("security-focused code reviewer");
  });

  it("does not include agents section when bundle has no agents", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-codex-"));
    // Create a stack without agents
    await writeFile(
      path.join(dir, "stack.json"),
      JSON.stringify({ name: "no-agents", version: "1.0.0" }),
    );
    await writeFile(
      path.join(dir, "agent.promptpit.md"),
      "---\nname: no-agents\n---\n\nTest instructions.\n",
    );
    const bundle = await readStack(dir);
    const target = await mkdtemp(path.join(tmpdir(), "pit-codex-target-"));
    await writeFile(path.join(target, "AGENTS.md"), "");
    await codexAdapter.write(target, bundle, {});
    const content = await readFile(path.join(target, "AGENTS.md"), "utf-8");
    expect(content).not.toContain("## Custom Agents");
    await rm(dir, { recursive: true });
    await rm(target, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/adapters/codex.test.ts`
Expected: FAIL

- [ ] **Step 3: Update Codex adapter**

In `src/adapters/codex.ts`:

Add import:

```ts
import { readSkillsFromDir, writeWithMarkers, rethrowPermissionError, markersDryRunEntry, skillDryRunEntry, formatAgentsInlineSection } from "./adapter-utils.js";
```

Update `read` return to include `agents: []`:

```ts
return {
  adapterId: "codex",
  agentInstructions,
  skills,
  agents: [],
  mcpServers,
  rules: [],
};
```

Update `write` — modify the instruction writing block to append agents inline:

```ts
if (stack.agentInstructions || stack.agents.length > 0) {
  let content = stack.agentInstructions || "";
  const agentSection = formatAgentsInlineSection(stack.agents);
  if (agentSection) {
    content = content ? `${content}\n\n${agentSection}` : agentSection;
  }
  const result = await writeWithMarkers(
    p.config,
    content,
    stackName,
    version,
    "codex",
    opts.dryRun,
  );
  if (result.written) filesWritten.push(result.written);
  if (opts.dryRun) {
    dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
  }
}
```

Update `capabilities`:

```ts
capabilities: {
  // ... existing ...
  agents: "inline",
},
```

- [ ] **Step 4: Update Cursor adapter**

In `src/adapters/cursor.ts`:

Add import:

```ts
import { readMcpFromSettings, writeWithMarkers, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, skillDryRunEntry, formatAgentsInlineSection } from "./adapter-utils.js";
```

Update `read` return to include `agents: []`:

```ts
return {
  adapterId: "cursor",
  agentInstructions,
  skills: [],
  agents: [],
  mcpServers,
  rules,
};
```

Update `write` — same pattern as Codex, append agents inline to instruction content:

```ts
if (stack.agentInstructions || stack.agents.length > 0) {
  let content = stack.agentInstructions || "";
  const agentSection = formatAgentsInlineSection(stack.agents);
  if (agentSection) {
    content = content ? `${content}\n\n${agentSection}` : agentSection;
  }
  const result = await writeWithMarkers(
    p.config,
    content,
    stackName,
    version,
    "cursor",
    opts.dryRun,
  );
  if (result.written) filesWritten.push(result.written);
  if (opts.dryRun) {
    dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
  }
}
```

Update `capabilities`:

```ts
capabilities: {
  // ... existing ...
  agents: "inline",
},
```

- [ ] **Step 5: Update Standards adapter**

In `src/adapters/standards.ts`:

Add import:

```ts
import { writeWithMarkers, readMcpFromSettings, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, formatAgentsInlineSection } from "./adapter-utils.js";
```

Update `read` return to include `agents: []`:

```ts
return {
  adapterId: "standards",
  agentInstructions,
  skills: [],
  agents: [],
  mcpServers,
  rules: [],
};
```

Update `write` — same pattern:

```ts
if (stack.agentInstructions || stack.agents.length > 0) {
  let content = stack.agentInstructions || "";
  const agentSection = formatAgentsInlineSection(stack.agents);
  if (agentSection) {
    content = content ? `${content}\n\n${agentSection}` : agentSection;
  }
  const result = await writeWithMarkers(
    p.config,
    content,
    stackName,
    version,
    "standards",
    opts.dryRun,
  );
  if (result.written) filesWritten.push(result.written);
  if (opts.dryRun) {
    dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
  }
}
```

Update `capabilities`:

```ts
capabilities: {
  // ... existing ...
  agents: "inline",
},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run test/adapters/codex.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/codex.ts src/adapters/cursor.ts src/adapters/standards.ts \
  test/adapters/codex.test.ts
git commit -m "feat: add inline agent writing to Codex, Cursor, and Standards adapters"
```

---

### Task 8: Commands — collect and install

**Files:**
- Modify: `src/commands/collect.ts`
- Modify: `src/commands/install.ts`

- [ ] **Step 1: Update collect.ts**

In `src/commands/collect.ts`, update the bundle construction:

```ts
const bundle: StackBundle = {
  manifest: {
    name: projectInfo.name,
    version: "0.1.0",
    description: projectInfo.description,
    skills: mergeResult.skills.map((s) => s.path),
    agents: mergeResult.agents.map((a) => a.path),
    compatibility: detected.map((d) => d.adapter.id),
  },
  agentInstructions: mergeResult.agentInstructions,
  skills: mergeResult.skills,
  agents: mergeResult.agents,
  mcpServers: stripped,
  envExample,
};
```

Update the dry-run file path list to include agents:

```ts
for (const agent of bundle.agents) {
  filePaths.push(path.join(outputDir, "agents", `${agent.name}.md`));
}
```

Update the summary line:

```ts
const agentCount = bundle.agents.length;
log.info(
  `Summary: ${bundle.agentInstructions ? "1 instruction file" : "no instructions"}, ` +
    `${skillCount} skill${skillCount !== 1 ? "s" : ""}, ` +
    `${agentCount} agent${agentCount !== 1 ? "s" : ""}, ` +
    `${mcpCount} MCP server${mcpCount !== 1 ? "s" : ""}, ` +
    `${secretCount} secret${secretCount !== 1 ? "s" : ""} stripped`,
);
```

Update the success log:

```ts
log.success(
  `Collected: ${mergeResult.skills.length} skills, ${mergeResult.agents.length} agents, ${Object.keys(stripped).length} MCP servers, ${Object.keys(envExample).length} secrets stripped`,
);
```

- [ ] **Step 2: Update install.ts**

In `src/commands/install.ts`, update the manifest agent hashing block (inside the adapter records loop, after the skills hash block):

```ts
// Hash agents from in-memory content
if (bundle.agents.length > 0) {
  const agents: Record<string, { hash: string }> = {};
  for (const agent of bundle.agents) {
    agents[agent.name] = { hash: computeHash(agent.content) };
  }
  if (Object.keys(agents).length > 0) {
    record.agents = agents;
  }
}
```

Update the record check:

```ts
if (record.instructions || record.skills || record.agents || record.mcp) {
  adapterRecords[adapter.id] = record;
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add src/commands/collect.ts src/commands/install.ts
git commit -m "feat: add agents to collect and install commands"
```

---

### Task 9: Contract tests and full validation

**Files:**
- Modify: `test/adapters/contract.test.ts`

- [ ] **Step 1: Update contract tests**

Add a new contract check for agents in `test/adapters/contract.test.ts`:

```ts
// 8. read() returns agents array
it("read() returns agents array in PlatformConfig", async () => {
  const setup = ADAPTER_FIXTURES[id];
  if (setup) await setup(tmpDir);
  const config = await adapter.read(tmpDir);
  expect(Array.isArray(config.agents)).toBe(true);
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run lint and build**

Run: `npm run lint && npm run build`
Expected: PASS — no type errors, clean build

- [ ] **Step 4: Commit**

```bash
git add test/adapters/contract.test.ts
git commit -m "test: add agent contract test for all adapters"
```

---

### Task 10: Final validation — lint, build, full test suite

- [ ] **Step 1: Run the complete verification**

```bash
npm test && npm run lint && npm run build
```

Expected: All pass with zero errors.

- [ ] **Step 2: Verify the fixture round-trip**

Run a quick manual check:

```bash
# Read the valid-stack fixture and verify agents are present
node -e "
const { readStack } = await import('./dist/cli.js');
// Or test via CLI:
"
```

Or just confirm the test suite covers this (it does via `test/core/stack.test.ts`).

- [ ] **Step 3: Review all changes**

```bash
git diff main --stat
git log --oneline main..HEAD
```

Verify each commit is a single logical change and the full diff looks correct.
