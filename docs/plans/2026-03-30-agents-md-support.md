# AGENTS.md Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AGENTS.md as a PlatformAdapter that always writes during install and reads as a fallback during collect.

**Architecture:** Standard PlatformAdapter with asymmetric collect/install behavior. Collect reads AGENTS.md only when no other adapters are detected (fallback-only). Install always writes AGENTS.md with idempotent markers. A shared `writeWithMarkers()` helper is extracted first to DRY the marker-write pattern across all adapters.

**Tech Stack:** TypeScript, vitest, Node.js fs APIs

**Spec:** `docs/specs/2026-03-30-agents-md-support-design.md`

---

## Task 1: Extract writeWithMarkers helper

**Files:**
- Modify: `src/adapters/adapter-utils.ts`
- Create: `test/adapters/adapter-utils.test.ts`

This task extracts the repeated marker-write pattern from claude-code.ts and cursor.ts into a shared helper function. The helper is tested independently before any adapter is refactored to use it.

- [ ] **Step 1: Write failing tests for writeWithMarkers**

Create `test/adapters/adapter-utils.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeWithMarkers } from "../../src/adapters/adapter-utils.js";

describe("writeWithMarkers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-markers-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates file with markers when no existing file", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "New instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("New instructions");
    expect(content).toContain("promptpit:end:my-stack");
  });

  it("inserts markers when existing file has no markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(filePath, "# Existing content\n\nKeep this.\n");
    const result = await writeWithMarkers(
      filePath,
      "Stack instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Existing content");
    expect(content).toContain("Keep this.");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("Stack instructions");
  });

  it("replaces marker content when existing file has markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(
      filePath,
      "# Header\n\n<!-- promptpit:start:my-stack:0.9.0:claude-code -->\nOld content\n<!-- promptpit:end:my-stack -->\n",
    );
    const result = await writeWithMarkers(
      filePath,
      "Updated content",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Header");
    expect(content).toContain("Updated content");
    expect(content).not.toContain("Old content");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
  });

  it("skips write when dryRun is true", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "Content",
      "my-stack",
      "1.0.0",
      "claude-code",
      true,
    );
    expect(result).toBeNull();
    // File should not exist
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();
  });

  it("handles empty content string", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack");
    expect(content).toContain("promptpit:end:my-stack");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapters/adapter-utils.test.ts`
Expected: FAIL — `writeWithMarkers` is not exported from adapter-utils.

- [ ] **Step 3: Implement writeWithMarkers in adapter-utils.ts**

Add the following to the end of `src/adapters/adapter-utils.ts`:

```typescript
import {
  hasMarkers,
  insertMarkers,
  replaceMarkerContent,
} from "../shared/markers.js";
import { writeFileEnsureDir } from "../shared/utils.js";

export async function writeWithMarkers(
  filePath: string,
  content: string,
  stackName: string,
  version: string,
  adapterId: string,
  dryRun?: boolean,
): Promise<string | null> {
  const existing = (await readFileOrNull(filePath)) ?? "";

  let updated: string;
  if (hasMarkers(existing, stackName)) {
    updated = replaceMarkerContent(
      existing,
      content,
      stackName,
      version,
      adapterId,
    );
  } else {
    updated = insertMarkers(existing, content, stackName, version, adapterId);
  }

  if (dryRun) {
    return null;
  }

  await writeFileEnsureDir(filePath, updated);
  return filePath;
}
```

Note: `readFileOrNull` is already imported in adapter-utils.ts. The `markers.js` and `writeFileEnsureDir` imports are new and must be added to the existing import block at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/adapters/adapter-utils.test.ts`
Expected: ALL PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/adapter-utils.ts test/adapters/adapter-utils.test.ts
git commit -m "refactor: extract writeWithMarkers helper to adapter-utils"
```

---

## Task 2: Refactor claude-code and cursor to use writeWithMarkers

**Files:**
- Modify: `src/adapters/claude-code.ts`
- Modify: `src/adapters/cursor.ts`

Replace the inline marker-write pattern in both adapters with the shared helper. No behavior change — existing contract tests verify this.

- [ ] **Step 1: Run existing contract tests as baseline**

Run: `npx vitest run test/adapters/contract.test.ts`
Expected: ALL PASS (14 tests — 7 per adapter)

- [ ] **Step 2: Refactor claude-code.ts write function**

In `src/adapters/claude-code.ts`, replace the marker-write block inside `write()`. Remove unused marker imports and add `writeWithMarkers` import.

Replace the imports:
```typescript
// REMOVE these imports (no longer used directly):
import {
  hasMarkers,
  insertMarkers,
  replaceMarkerContent,
} from "../shared/markers.js";

// ADD this import:
import { writeWithMarkers } from "./adapter-utils.js";
```

Replace lines 86-113 (the `if (stack.agentInstructions)` block) with:

```typescript
    // Write agent instructions to CLAUDE.md
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "claude-code",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }
```

- [ ] **Step 3: Refactor cursor.ts write function**

In `src/adapters/cursor.ts`, replace the marker-write block inside `write()`. Remove unused marker imports and add `writeWithMarkers` import.

Replace the imports:
```typescript
// REMOVE these imports (no longer used directly):
import {
  hasMarkers,
  insertMarkers,
  replaceMarkerContent,
} from "../shared/markers.js";

// ADD this import:
import { writeWithMarkers } from "./adapter-utils.js";
```

Replace lines 107-126 (the `if (stack.agentInstructions)` block) with:

```typescript
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "cursor",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }
```

- [ ] **Step 4: Run contract tests to verify no regression**

Run: `npx vitest run test/adapters/contract.test.ts`
Expected: ALL PASS (14 tests — same as baseline)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claude-code.ts src/adapters/cursor.ts
git commit -m "refactor: use writeWithMarkers in claude-code and cursor adapters"
```

---

## Task 3: Create agents-md adapter

**Files:**
- Create: `src/adapters/agents-md.ts`
- Modify: `src/adapters/registry.ts`
- Modify: `test/adapters/contract.test.ts`
- Create: `test/__fixtures__/agents-md-project/AGENTS.md`

- [ ] **Step 1: Create test fixture**

Create `test/__fixtures__/agents-md-project/AGENTS.md`:

```markdown
# Project Instructions

Use TypeScript strict mode.
Follow the adapter pattern for new integrations.
```

- [ ] **Step 2: Add ADAPTER_FIXTURES entry for agents-md**

In `test/adapters/contract.test.ts`, add to the `ADAPTER_FIXTURES` object:

```typescript
const ADAPTER_FIXTURES: Record<string, (dir: string) => Promise<void>> = {
  "claude-code": async (dir) => {
    await writeFile(path.join(dir, "CLAUDE.md"), "# Test");
  },
  cursor: async (dir) => {
    await writeFile(path.join(dir, ".cursorrules"), "Test rules");
  },
  "agents-md": async (dir) => {
    await writeFile(path.join(dir, "AGENTS.md"), "# Test agents");
  },
};
```

- [ ] **Step 3: Run contract tests to see them fail for agents-md**

Run: `npx vitest run test/adapters/contract.test.ts`
Expected: FAIL — adapter "agents-md" not found in registry (7 new test cases fail)

- [ ] **Step 4: Create agents-md adapter**

Create `src/adapters/agents-md.ts`:

```typescript
import path from "node:path";
import { homedir } from "node:os";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, exists } from "../shared/utils.js";
import { writeWithMarkers } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".agents", "skills"),
    mcp: path.join(root, ".agents", "mcp.json"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".agents", "AGENTS.md"),
    skills: path.join(home, ".agents", "skills"),
    mcp: path.join(home, ".agents", "mcp.json"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";

  return {
    adapterId: "agents-md",
    agentInstructions,
    skills: [],
    mcpServers: {},
    rules: [],
  };
}

async function write(
  root: string,
  stack: StackBundle,
  opts: WriteOptions,
): Promise<WriteResult> {
  const p = opts.global ? userPaths() : projectPaths(root);
  const filesWritten: string[] = [];
  const warnings: string[] = [];
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "agents-md",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        const target = opts.global ? "user-level" : "project-level";
        throw new Error(
          `Cannot write to ${target} AGENTS.md. Check file permissions.`,
        );
      }
    }
    throw err;
  }

  return { filesWritten, filesSkipped: [], warnings };
}

export const agentsMdAdapter: PlatformAdapter = {
  id: "agents-md",
  displayName: "AGENTS.md",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skills: false,
    rules: false,
    skillFormat: "md",
    mcpStdio: false,
    mcpRemote: false,
    agentsmd: true,
    hooks: false,
  },
  detect,
  read,
  write,
};
```

- [ ] **Step 5: Register adapter in registry.ts**

In `src/adapters/registry.ts`, add the import and register the adapter:

```typescript
import { agentsMdAdapter } from "./agents-md.js";
```

Update `defaultAdapters`:

```typescript
const defaultAdapters: PlatformAdapter[] = [claudeCodeAdapter, cursorAdapter, agentsMdAdapter];
```

- [ ] **Step 6: Run contract tests to verify all pass**

Run: `npx vitest run test/adapters/contract.test.ts`
Expected: ALL PASS (21 tests — 7 per adapter x 3 adapters)

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/adapters/agents-md.ts src/adapters/registry.ts test/adapters/contract.test.ts test/__fixtures__/agents-md-project/AGENTS.md
git commit -m "feat: add agents-md adapter"
```

---

## Task 4: Add fallback-only read logic to collect

**Files:**
- Modify: `src/commands/collect.ts`
- Create: `test/commands/collect-agents-md.test.ts`

During collect, agents-md should only be included in the read set when it's the only detected adapter.

- [ ] **Step 1: Write failing tests for collect fallback logic**

Create `test/commands/collect-agents-md.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectStack } from "../../src/commands/collect.js";

describe("collect: agents-md fallback logic", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-collect-agents-"));
    outputDir = path.join(tmpDir, ".promptpit");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads AGENTS.md when it is the only adapter detected", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Instructions\n\nUse strict mode.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("Use strict mode.");
  });

  it("excludes AGENTS.md when claude-code is also detected", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# AGENTS instructions\n\nFrom AGENTS.md.\n",
    );
    await writeFile(
      path.join(tmpDir, "CLAUDE.md"),
      "# CLAUDE instructions\n\nFrom CLAUDE.md.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("From CLAUDE.md.");
    expect(agentMd).not.toContain("From AGENTS.md.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/commands/collect-agents-md.test.ts`
Expected: FAIL — the second test fails because AGENTS.md content is included alongside CLAUDE.md content (no fallback filtering exists yet).

- [ ] **Step 3: Add fallback-only filter to collect.ts**

In `src/commands/collect.ts`, after the `detectAdapters` call and the "No AI tool" error check (around line 47), add the filter before reading:

```typescript
  // Fallback-only: exclude agents-md from read when other adapters are detected.
  // This avoids content duplication when CLAUDE.md/cursorrules have similar content.
  // Full deduplication is deferred — see TODOS.md "Recursive duplication."
  const hasNonAgentsMd = detected.some((d) => d.adapter.id !== "agents-md");
  const readSet = hasNonAgentsMd
    ? detected.filter((d) => d.adapter.id !== "agents-md")
    : detected;
```

Then change the `configs` line (around line 53) from:

```typescript
  const configs = await Promise.all(
    detected.map((d) => d.adapter.read(root)),
  );
```

to:

```typescript
  const configs = await Promise.all(
    readSet.map((d) => d.adapter.read(root)),
  );
```

Also update the spinner success message to use `readSet` count:

```typescript
  spin.succeed(
    `Found ${detected.length} tool(s): ${detected.map((d) => d.adapter.displayName).join(", ")}` +
      (readSet.length < detected.length
        ? ` (reading from ${readSet.length})`
        : ""),
  );
```

And update the compatibility line in the bundle to use `detected` (all detected, not just read):

```typescript
    compatibility: detected.map((d) => d.adapter.id),
```

This is already correct — the existing code uses `detected` for compatibility.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/commands/collect-agents-md.test.ts`
Expected: ALL PASS (2 tests)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/collect.ts test/commands/collect-agents-md.test.ts
git commit -m "feat: fallback-only read for agents-md during collect"
```

---

## Task 5: Add always-write logic to install

**Files:**
- Modify: `src/commands/install.ts`
- Create: `test/commands/install-agents-md.test.ts`

During install, agents-md should always be in the write set, even when no AGENTS.md exists in the target.

- [ ] **Step 1: Write failing tests for install always-write logic**

Create `test/commands/install-agents-md.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installStack } from "../../src/commands/install.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("install: agents-md always-write logic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-install-agents-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates AGENTS.md even when no AGENTS.md exists in target", async () => {
    // Target has CLAUDE.md but no AGENTS.md
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Existing");

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("promptpit:start:test-stack");
    expect(agentsMd).toContain("promptpit:end:test-stack");
  });

  it("writes to AGENTS.md when it already exists", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Pre-existing content\n",
    );

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("# Pre-existing content");
    expect(agentsMd).toContain("promptpit:start:test-stack");
  });

  it("does not duplicate agents-md when AGENTS.md already detected", async () => {
    // Both CLAUDE.md and AGENTS.md exist — agents-md is detected AND injected
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Claude");
    await writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents");

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    const startCount = (
      agentsMd.match(/promptpit:start:test-stack/g) || []
    ).length;
    expect(startCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/commands/install-agents-md.test.ts`
Expected: FAIL — first test fails because AGENTS.md is not created (agents-md adapter not injected when not detected).

- [ ] **Step 3: Add always-write inject to install.ts**

In `src/commands/install.ts`, after the existing claude-code fallback block (around line 93), add the agents-md inject:

```typescript
    // Always include agents-md for writing — AGENTS.md is the universal cross-tool output
    if (!detected.some((d) => d.adapter.id === "agents-md")) {
      const { agentsMdAdapter } = await import("../adapters/agents-md.js");
      detected.push({
        adapter: agentsMdAdapter,
        detection: { detected: true, configPaths: [] },
      });
    }
```

This goes right after the existing `if (detected.length === 0)` block (the claude-code fallback) and before the `detectSpin.succeed` line. The full sequence is:

1. `detectAdapters(target)` (existing)
2. If nothing detected, add claude-code (existing fallback)
3. If agents-md not in set, add it (new)
4. Continue to write loop (existing)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/commands/install-agents-md.test.ts`
Expected: ALL PASS (3 tests)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Run lint and build**

Run: `npm run lint && npm run build`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/commands/install.ts test/commands/install-agents-md.test.ts
git commit -m "feat: always write AGENTS.md during install"
```

---

## Task 6: Update TODOS.md

**Files:**
- Modify: `TODOS.md`

- [ ] **Step 1: Update the recursive duplication TODO**

In `TODOS.md`, find the "Recursive duplication on collect + install" section and append the following paragraph to the end of it (before `## v0.2.x`):

```markdown
**Current mitigation:** The agents-md adapter uses fallback-only read during collect — AGENTS.md is only read when no other adapters (claude-code, cursor) are detected. This prevents the most common duplication case (CLAUDE.md + AGENTS.md with similar content) but doesn't solve the general problem. A full deduplication solution (content hashing, similarity detection across adapter outputs) is still needed.
```

- [ ] **Step 2: Commit**

```bash
git add TODOS.md
git commit -m "docs: update duplication TODO with agents-md fallback-only design note"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS (should be 76 + ~17 new = ~93 tests)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build, `dist/cli.js` produced

- [ ] **Step 4: Verify git log shows bisected commits**

Run: `git log --oneline -7`

Expected commits (newest first):
```
docs: update duplication TODO with agents-md fallback-only design note
feat: always write AGENTS.md during install
feat: fallback-only read for agents-md during collect
feat: add agents-md adapter
refactor: use writeWithMarkers in claude-code and cursor adapters
refactor: extract writeWithMarkers helper to adapter-utils
docs: add AGENTS.md support design spec
```
