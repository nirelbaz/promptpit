# MCP & AGENTS.md Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate MCP servers and instructions caused by Standards adapter writing universal files that detected tools already read natively.

**Architecture:** Add `nativelyReads` capability to each adapter declaring which universal files the tool reads. The install orchestrator uses these declarations to suppress redundant Standards writes (default), suppress tool-specific writes (`--prefer-universal`), or write everything (`--force-standards`).

**Tech Stack:** TypeScript, Vitest, Commander.js, Zod

**Spec:** `docs/specs/2026-04-08-mcp-agents-dedup-design.md`

---

### Task 1: Add `nativelyReads` to AdapterCapabilities

**Files:**
- Modify: `src/adapters/types.ts:29-41`
- Modify: `src/adapters/claude-code.ts:204-216`
- Modify: `src/adapters/copilot.ts:337-349`
- Modify: `src/adapters/cursor.ts:228-240`
- Modify: `src/adapters/codex.ts:150-162`
- Test: `test/adapters/contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add a test verifying `nativelyReads` declarations for each adapter in `test/adapters/contract.test.ts`:

```typescript
// After the existing describe.each block, add a new describe block:

describe("nativelyReads declarations", () => {
  const adapters = listAdapters();

  it("claude-code declares nativelyReads.mcp", () => {
    const cc = adapters.find((a) => a.id === "claude-code")!;
    expect(cc.capabilities.nativelyReads?.mcp).toBe(true);
    expect(cc.capabilities.nativelyReads?.instructions).toBeUndefined();
  });

  it("copilot declares nativelyReads.instructions", () => {
    const cop = adapters.find((a) => a.id === "copilot")!;
    expect(cop.capabilities.nativelyReads?.instructions).toBe(true);
    expect(cop.capabilities.nativelyReads?.mcp).toBeUndefined();
  });

  it("cursor declares nativelyReads.instructions", () => {
    const cur = adapters.find((a) => a.id === "cursor")!;
    expect(cur.capabilities.nativelyReads?.instructions).toBe(true);
    expect(cur.capabilities.nativelyReads?.mcp).toBeUndefined();
  });

  it("codex declares nativelyReads.instructions", () => {
    const cdx = adapters.find((a) => a.id === "codex")!;
    expect(cdx.capabilities.nativelyReads?.instructions).toBe(true);
    expect(cdx.capabilities.nativelyReads?.mcp).toBeUndefined();
  });

  it("standards has no nativelyReads", () => {
    const std = adapters.find((a) => a.id === "standards")!;
    expect(std.capabilities.nativelyReads).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose test/adapters/contract.test.ts`
Expected: FAIL — `nativelyReads` is undefined on all adapters

- [ ] **Step 3: Add `nativelyReads` to `AdapterCapabilities` type**

In `src/adapters/types.ts`, add the optional field inside `AdapterCapabilities`:

```typescript
export interface AdapterCapabilities {
  skillLinkStrategy: "symlink" | "translate-copy" | "none";
  rules: boolean;
  commands: boolean;
  skillFormat: "skill.md" | "mdc" | "md";
  mcpStdio: boolean;
  mcpRemote: boolean;
  mcpFormat: "json" | "toml";
  mcpRootKey: string;
  agentsmd: boolean;
  hooks: boolean;
  agents: "native" | "inline" | "none";
  /** Universal files this tool reads natively (beyond what the adapter writes).
   *  Used by install orchestrator to prevent duplication. */
  nativelyReads?: {
    mcp?: boolean;
    instructions?: boolean;
  };
}
```

- [ ] **Step 4: Declare `nativelyReads` on each adapter**

In `src/adapters/claude-code.ts`, add to the capabilities object (after `commands: true`):

```typescript
    nativelyReads: { mcp: true },
```

In `src/adapters/copilot.ts`, add to the capabilities object (after `commands: true`):

```typescript
    nativelyReads: { instructions: true },
```

In `src/adapters/cursor.ts`, add to the capabilities object (after `commands: true`):

```typescript
    nativelyReads: { instructions: true },
```

In `src/adapters/codex.ts`, add to the capabilities object (after `commands: false`):

```typescript
    nativelyReads: { instructions: true },
```

Standards adapter: no change (no `nativelyReads` field).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --reporter verbose test/adapters/contract.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/adapters/claude-code.ts src/adapters/copilot.ts src/adapters/cursor.ts src/adapters/codex.ts test/adapters/contract.test.ts
git commit -m "feat: add nativelyReads capability to adapter types

Declares which universal files each tool reads natively:
- Claude Code: .mcp.json
- Copilot, Cursor, Codex: AGENTS.md

Foundation for install dedup logic."
```

---

### Task 2: Add `skipMcp`, `skipInstructions`, `preferUniversal` to WriteOptions

**Files:**
- Modify: `src/adapters/types.ts:57-63`

- [ ] **Step 1: Add new fields to `WriteOptions`**

In `src/adapters/types.ts`, add to the `WriteOptions` interface:

```typescript
export interface WriteOptions {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  global?: boolean;
  canonicalSkillPaths?: Map<string, string>;
  /** Standards adapter: skip writing .mcp.json (a detected tool reads it natively) */
  skipMcp?: boolean;
  /** Standards adapter: skip writing AGENTS.md (a detected tool reads it natively) */
  skipInstructions?: boolean;
  /** Tool adapters: skip writing tool-specific MCP/instructions when tool reads universal */
  preferUniversal?: boolean;
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `npm test`
Expected: ALL PASS (new fields are optional, no behavior change yet)

- [ ] **Step 3: Commit**

```bash
git add src/adapters/types.ts
git commit -m "feat: add skip/preferUniversal fields to WriteOptions"
```

---

### Task 3: Standards adapter respects skip flags

**Files:**
- Modify: `src/adapters/standards.ts:61-103`
- Test: `test/adapters/standards-dedup.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `test/adapters/standards-dedup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { standardsAdapter } from "../../src/adapters/standards.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("Standards adapter dedup", () => {
  let tmpDir: string;
  let bundle: Awaited<ReturnType<typeof readStack>>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-std-dedup-"));
    bundle = await readStack(VALID_STACK);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("skips .mcp.json when skipMcp is true", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, { skipMcp: true });
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(result.filesWritten.every((f) => !f.endsWith(".mcp.json"))).toBe(true);
    // AGENTS.md should still be written
    const agents = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agents).toContain("promptpit:start:test-stack");
  });

  it("skips AGENTS.md when skipInstructions is true", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, { skipInstructions: true });
    expect(existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
    // .mcp.json should still be written
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
  });

  it("writes 0 files when both skips are true", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipMcp: true,
      skipInstructions: true,
    });
    expect(result.filesWritten).toHaveLength(0);
  });

  it("writes both files when no skip flags set", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {});
    expect(existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
  });

  it("dry-run respects skipMcp", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipMcp: true,
      dryRun: true,
    });
    const mcpEntry = result.dryRunEntries?.find((e) => e.file.endsWith(".mcp.json"));
    expect(mcpEntry).toBeUndefined();
  });

  it("dry-run respects skipInstructions", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipInstructions: true,
      dryRun: true,
    });
    const agentsEntry = result.dryRunEntries?.find((e) => e.file.endsWith("AGENTS.md"));
    expect(agentsEntry).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose test/adapters/standards-dedup.test.ts`
Expected: FAIL — Standards writes both files regardless of skip flags

- [ ] **Step 3: Implement skip logic in Standards `write()`**

In `src/adapters/standards.ts`, modify the `write` function. Wrap the instructions block with `!opts.skipInstructions` and the MCP block with `!opts.skipMcp`:

```typescript
async function write(
  root: string,
  stack: StackBundle,
  opts: WriteOptions,
): Promise<WriteResult> {
  const p = opts.global ? userPaths() : projectPaths(root);
  const filesWritten: string[] = [];
  const warnings: string[] = [];
  const dryRunEntries: DryRunEntry[] = [];
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    if (!opts.skipInstructions) {
      const content = buildInlineContent(stack.agentInstructions, stack.agents);
      if (content) {
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
    }

    if (!opts.skipMcp && !opts.global) {
      const mcpResult = await mergeMcpIntoJson(p.mcp, stack.mcpServers, warnings, opts.dryRun);
      if (mcpResult.written) filesWritten.push(mcpResult.written);
      const mcpCount = Object.keys(stack.mcpServers).length;
      if (opts.dryRun && mcpCount > 0) {
        dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, mcpResult, opts.verbose));
      }
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "standards config");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --reporter verbose test/adapters/standards-dedup.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/standards.ts test/adapters/standards-dedup.test.ts
git commit -m "feat: Standards adapter respects skipMcp/skipInstructions flags

When skipMcp is true, Standards skips writing .mcp.json.
When skipInstructions is true, Standards skips writing AGENTS.md.
Both flags respected in write and dry-run modes."
```

---

### Task 4: Tool adapters respect `preferUniversal`

**Files:**
- Modify: `src/adapters/claude-code.ts:99-198`
- Modify: `src/adapters/copilot.ts:215-331`
- Modify: `src/adapters/cursor.ts:143-222`
- Modify: `src/adapters/codex.ts:85-144`
- Test: `test/adapters/prefer-universal.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `test/adapters/prefer-universal.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { copilotAdapter } from "../../src/adapters/copilot.js";
import { cursorAdapter } from "../../src/adapters/cursor.js";
import { codexAdapter } from "../../src/adapters/codex.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("preferUniversal mode", () => {
  let tmpDir: string;
  let bundle: Awaited<ReturnType<typeof readStack>>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-prefer-universal-"));
    bundle = await readStack(VALID_STACK);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Claude Code", () => {
    beforeEach(async () => {
      await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Existing");
    });

    it("skips MCP write to .claude/settings.json when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const settingsPath = path.join(tmpDir, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        expect(settings.mcpServers).toBeUndefined();
      }
    });

    it("still writes instructions to CLAUDE.md when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const claude = await readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
      expect(claude).toContain("promptpit:start:test-stack");
    });

    it("still writes skills, agents, rules, commands when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".claude", "rules"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".claude", "agents"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".claude", "commands"))).toBe(true);
    });
  });

  describe("Copilot", () => {
    beforeEach(async () => {
      await mkdir(path.join(tmpDir, ".github"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".github", "copilot-instructions.md"),
        "# Existing",
      );
    });

    it("skips instructions write when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const instructions = await readFile(
        path.join(tmpDir, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      // Should remain unchanged — no marker injection
      expect(instructions).toBe("# Existing");
    });

    it("still writes MCP to .vscode/mcp.json when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".vscode", "mcp.json"))).toBe(true);
    });

    it("still writes skills, agents, rules, commands when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".github", "instructions"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".github", "agents"))).toBe(true);
    });
  });

  describe("Cursor", () => {
    beforeEach(async () => {
      await writeFile(path.join(tmpDir, ".cursorrules"), "Existing rules");
    });

    it("skips instructions write to .cursorrules when preferUniversal", async () => {
      await cursorAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const rules = await readFile(path.join(tmpDir, ".cursorrules"), "utf-8");
      expect(rules).toBe("Existing rules");
    });

    it("still writes MCP to .cursor/mcp.json when preferUniversal", async () => {
      await cursorAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".cursor", "mcp.json"))).toBe(true);
    });
  });

  describe("Codex", () => {
    beforeEach(async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(path.join(tmpDir, "AGENTS.md"), "# Existing");
    });

    it("skips AGENTS.md write when preferUniversal", async () => {
      await codexAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const agents = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(agents).toBe("# Existing");
    });

    it("still writes MCP to .codex/config.toml when preferUniversal", async () => {
      await codexAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose test/adapters/prefer-universal.test.ts`
Expected: FAIL — adapters write everything regardless of `preferUniversal`

- [ ] **Step 3: Implement `preferUniversal` in Claude Code adapter**

In `src/adapters/claude-code.ts`, wrap the MCP write block (around line 186-192) with a check:

```typescript
    // Write MCP config (skip when preferUniversal — tool reads .mcp.json natively)
    if (!opts.preferUniversal || !claudeCodeAdapter.capabilities.nativelyReads?.mcp) {
      const mcpResult = await mergeMcpIntoJson(p.mcp, stack.mcpServers, warnings, opts.dryRun);
      if (mcpResult.written) filesWritten.push(mcpResult.written);
      const mcpCount = Object.keys(stack.mcpServers).length;
      if (opts.dryRun && mcpCount > 0) {
        dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, mcpResult, opts.verbose));
      }
    }
```

- [ ] **Step 4: Implement `preferUniversal` in Copilot adapter**

In `src/adapters/copilot.ts`, wrap the instructions write block (around lines 228-242) with a check:

```typescript
    // Write instructions (skip when preferUniversal — tool reads AGENTS.md natively)
    if (!opts.preferUniversal || !copilotAdapter.capabilities.nativelyReads?.instructions) {
      if (stack.agentInstructions) {
        const result = await writeWithMarkers(
          p.config,
          stack.agentInstructions,
          stackName,
          version,
          "copilot",
          opts.dryRun,
        );
        if (result.written) filesWritten.push(result.written);
        if (opts.dryRun) {
          dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
        }
      }
    }
```

- [ ] **Step 5: Implement `preferUniversal` in Cursor adapter**

In `src/adapters/cursor.ts`, wrap the instructions write block (around lines 156-170) with a check:

```typescript
    // Write instructions (skip when preferUniversal — tool reads AGENTS.md natively)
    if (!opts.preferUniversal || !cursorAdapter.capabilities.nativelyReads?.instructions) {
      const content = buildInlineContent(stack.agentInstructions, stack.agents);
      if (content) {
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
    }
```

- [ ] **Step 6: Implement `preferUniversal` in Codex adapter**

In `src/adapters/codex.ts`, wrap the instructions write block (around lines 98-112) with a check:

```typescript
    // Write instructions (skip when preferUniversal — Standards writes AGENTS.md)
    if (!opts.preferUniversal || !codexAdapter.capabilities.nativelyReads?.instructions) {
      const content = buildInlineContent(stack.agentInstructions, stack.agents);
      if (content) {
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
    }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- --reporter verbose test/adapters/prefer-universal.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/adapters/claude-code.ts src/adapters/copilot.ts src/adapters/cursor.ts src/adapters/codex.ts test/adapters/prefer-universal.test.ts
git commit -m "feat: tool adapters respect preferUniversal flag

Claude Code skips MCP write to .claude/settings.json.
Copilot skips instructions write to .github/copilot-instructions.md.
Cursor skips instructions write to .cursorrules.
Codex skips instructions write to AGENTS.md.
All other artifacts (rules, skills, agents, commands) unaffected."
```

---

### Task 5: Install orchestrator dedup logic + CLI flags

**Files:**
- Modify: `src/commands/install.ts:18-23,91-178`
- Modify: `src/cli.ts:78-115`
- Test: `test/commands/install-dedup.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `test/commands/install-dedup.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("install dedup", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe("default mode (Standards dedup)", () => {
    it("skips .mcp.json when Claude Code is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-cc-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, {});

      // .mcp.json should NOT exist — Claude Code reads it natively
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);
      // MCP should be in .claude/settings.json
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
    });

    it("skips AGENTS.md when Codex is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-codex-"));
      tmpDirs.push(target);
      await mkdir(path.join(target, ".codex"), { recursive: true });

      await installStack(VALID_STACK, target, {});

      // AGENTS.md should exist (Codex writes it) but only one set of markers
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      const startCount = (agents.match(/promptpit:start:test-stack/g) || []).length;
      expect(startCount).toBe(1);
    });

    it("skips .mcp.json even when no tools detected (Claude Code added as default)", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-none-"));
      tmpDirs.push(target);
      // No tool config files — but install.ts adds Claude Code as default
      // Claude Code has nativelyReads.mcp, so .mcp.json is still skipped

      await installStack(VALID_STACK, target, {});

      // Claude Code reads .mcp.json natively, so Standards skips it
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);
      // MCP goes to .claude/settings.json instead
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
      // But AGENTS.md should exist — Claude Code doesn't read it natively
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(true);
    });
  });

  describe("--force-standards", () => {
    it("writes .mcp.json even when Claude Code is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-force-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { forceStandards: true });

      // Both should exist
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
    });
  });

  describe("--prefer-universal", () => {
    it("writes .mcp.json and skips .claude/settings.json MCP", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-universal-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { preferUniversal: true });

      // .mcp.json should exist (Standards writes it)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      // .claude/settings.json should have no MCP
      const settingsPath = path.join(target, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        expect(settings.mcpServers).toBeUndefined();
      }
      // CLAUDE.md should still have instructions
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(claude).toContain("promptpit:start:test-stack");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose test/commands/install-dedup.test.ts`
Expected: FAIL — `forceStandards` and `preferUniversal` are not recognized options

- [ ] **Step 3: Add `forceStandards` and `preferUniversal` to `InstallOptions`**

In `src/commands/install.ts`, update the `InstallOptions` interface:

```typescript
export interface InstallOptions {
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  forceStandards?: boolean;
  preferUniversal?: boolean;
}
```

- [ ] **Step 4: Add orchestrator dedup logic to `installStack()`**

In `src/commands/install.ts`, after the `// Always include standards` block (around line 118) and before the `// Write skills to canonical` block (line 120), add:

```typescript
    // Compute dedup flags for Standards adapter
    if (opts.forceStandards && opts.preferUniversal) {
      throw new Error("--force-standards and --prefer-universal are mutually exclusive");
    }

    const writeOpts: WriteOptions = {
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      force: opts.force,
      global: opts.global,
    };

    if (opts.preferUniversal) {
      // Prefer universal: Standards writes everything, tool adapters skip where possible
      writeOpts.preferUniversal = true;
    } else if (!opts.forceStandards) {
      // Default: suppress Standards when detected tools read universal files natively
      const toolAdapters = detected.filter((d) => d.adapter.id !== "standards");
      const skipMcp = toolAdapters.some(
        (d) => d.adapter.capabilities.nativelyReads?.mcp,
      );
      const skipInstructions = toolAdapters.some(
        (d) => d.adapter.capabilities.nativelyReads?.instructions,
      );

      if (skipMcp) {
        writeOpts.skipMcp = true;
        const readers = toolAdapters
          .filter((d) => d.adapter.capabilities.nativelyReads?.mcp)
          .map((d) => d.adapter.displayName);
        log.info(
          `Standards: skipped .mcp.json (${readers.join(", ")} read${readers.length === 1 ? "s" : ""} it natively, causing duplicate MCP servers)`,
        );
      }
      if (skipInstructions) {
        writeOpts.skipInstructions = true;
        const readers = toolAdapters
          .filter((d) => d.adapter.capabilities.nativelyReads?.instructions)
          .map((d) => d.adapter.displayName);
        log.info(
          `Standards: skipped AGENTS.md (${readers.join(", ")} read${readers.length === 1 ? "s" : ""} it natively, causing duplicate instructions)`,
        );
      }
      if (skipMcp || skipInstructions) {
        log.info(
          "Tip: use --force-standards to write universal files even when detected tools read them natively",
        );
      }
    }
```

Then remove the existing `writeOpts` construction (around lines 146-152) and update the `canonicalSkillPaths` assignment to set it on the existing `writeOpts`:

```typescript
    // (after canonical skill install completes)
    writeOpts.canonicalSkillPaths = canonicalSkillPaths;
```

- [ ] **Step 5: Add Copilot warning in prefer-universal mode**

In the `preferUniversal` branch of the orchestrator, after setting `writeOpts.preferUniversal = true`, add:

```typescript
      // Warn about Copilot's opt-in AGENTS.md reading
      const hasCopilot = detected.some((d) => d.adapter.id === "copilot");
      if (hasCopilot) {
        log.warn(
          "Copilot: skipped .github/copilot-instructions.md — ensure chat.useAgentsMdFile is enabled in VS Code settings",
        );
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --reporter verbose test/commands/install-dedup.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Wire CLI flags in `src/cli.ts`**

In `src/cli.ts`, add the two new options to the install command (after the `--force` option, around line 89):

```typescript
  .option(
    "--force-standards",
    "Write .mcp.json and AGENTS.md even when detected tools read them natively",
  )
  .option(
    "--prefer-universal",
    "Use universal files (.mcp.json, AGENTS.md) instead of tool-specific equivalents",
  )
```

Update the action handler's opts type:

```typescript
    async (
      source: string | undefined,
      target: string,
      opts: {
        global?: boolean;
        dryRun?: boolean;
        force?: boolean;
        verbose?: boolean;
        forceStandards?: boolean;
        preferUniversal?: boolean;
      },
    ) => {
```

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/commands/install.ts src/cli.ts test/commands/install-dedup.test.ts
git commit -m "feat: install dedup orchestrator + --force-standards/--prefer-universal flags

Default: Standards skips .mcp.json/AGENTS.md when detected tools read them.
--force-standards: override dedup, write all universal files.
--prefer-universal: tool adapters skip their MCP/instructions, use universal.
Flags are mutually exclusive."
```

---

### Task 6: Manifest records `installMode`

**Files:**
- Modify: `src/shared/schema.ts:192-200`
- Modify: `src/commands/install.ts:304-310`
- Test: `test/commands/install-dedup.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Add to `test/commands/install-dedup.test.ts`, inside the `describe("--force-standards")` block:

```typescript
    it("records installMode in manifest", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-manifest-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { forceStandards: true });

      const manifest = JSON.parse(
        await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
      );
      expect(manifest.installs[0].installMode).toBe("force-standards");
    });
```

Add a similar test in the `describe("--prefer-universal")` block:

```typescript
    it("records installMode in manifest", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-manifest2-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { preferUniversal: true });

      const manifest = JSON.parse(
        await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
      );
      expect(manifest.installs[0].installMode).toBe("prefer-universal");
    });
```

Add a test in `describe("default mode")`:

```typescript
    it("records no installMode in manifest for default mode", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-manifest3-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, {});

      const manifest = JSON.parse(
        await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
      );
      expect(manifest.installs[0].installMode).toBeUndefined();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose test/commands/install-dedup.test.ts`
Expected: FAIL — `installMode` is undefined in all cases

- [ ] **Step 3: Add `installMode` to schema**

In `src/shared/schema.ts`, add to `installEntrySchema` (around line 192):

```typescript
const installEntrySchema = z.object({
  stack: z.string().min(1),
  stackVersion: z.string(),
  source: z.string().optional(),
  installedAt: z.string(),
  installMode: z.enum(["default", "force-standards", "prefer-universal"]).optional(),
  adapters: z.record(adapterInstallSchema),
});
```

- [ ] **Step 4: Record `installMode` in install.ts**

In `src/commands/install.ts`, where the `entry` object is constructed (around line 304), add the `installMode` field:

```typescript
      const entry: InstallEntry = {
        stack: bundle.manifest.name,
        stackVersion: bundle.manifest.version,
        source: gh ? source : undefined,
        installedAt: new Date().toISOString(),
        ...(opts.forceStandards && { installMode: "force-standards" as const }),
        ...(opts.preferUniversal && { installMode: "prefer-universal" as const }),
        adapters: adapterRecords,
      };
```

- [ ] **Step 5: Skip manifest recording for skipped adapters**

In the manifest recording loop in `install.ts` (around line 226-302), the adapter records should exclude artifacts that were skipped. Add checks:

For Standards adapter, skip recording instructions/mcp when they were skipped:

```typescript
      for (const { adapter } of detected) {
        const record: AdapterInstallRecord = {};

        // Skip recording instructions for Standards when skipInstructions is set
        const skipAdapterInstructions =
          (adapter.id === "standards" && writeOpts.skipInstructions) ||
          (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.instructions);

        // Skip recording MCP for Standards when skipMcp is set, or for tool adapter when preferUniversal
        const skipAdapterMcp =
          (adapter.id === "standards" && writeOpts.skipMcp) ||
          (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.mcp);

        // Hash instructions (skip if adapter's write was suppressed)
        if (!skipAdapterInstructions) {
          if (bundle.agentInstructions || (bundle.agents.length > 0 && adapter.capabilities.agents === "inline")) {
            // ... existing hash logic ...
          }
        }

        // ... existing skills/agents/rules/commands hash logic (unchanged) ...

        // Hash MCP (skip if adapter's write was suppressed)
        if (!skipAdapterMcp) {
          if (adapter.capabilities.mcpStdio && Object.keys(bundle.mcpServers).length > 0) {
            // ... existing hash logic ...
          }
        }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --reporter verbose test/commands/install-dedup.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/schema.ts src/commands/install.ts test/commands/install-dedup.test.ts
git commit -m "feat: record installMode in manifest, skip hashing for suppressed artifacts

Manifest tracks which dedup mode was used (force-standards, prefer-universal,
or default/omitted). Skipped adapter artifacts are not recorded in the manifest
so pit status won't flag them as missing."
```

---

### Task 7: Status and check handle installMode

**Files:**
- Modify: `src/commands/status.ts`
- Modify: `src/commands/check.ts`

- [ ] **Step 1: Review current status/check logic**

Read `src/commands/status.ts` and `src/commands/check.ts` to understand where they iterate over adapter records and check for drift. The key point: if an adapter has no `instructions` or `mcp` entry in the manifest (because it was skipped), status/check already won't flag those artifacts as drifted — they simply aren't in the record.

Verify this by reading the status and check code paths that iterate `entry.adapters`.

- [ ] **Step 2: Add informational message in status for skipped files**

In `src/commands/status.ts`, after computing per-adapter status, check `installMode` and log explanatory messages. Find where the status output is assembled (the section that displays per-adapter results) and add:

```typescript
    // Explain skipped files based on installMode
    if (entry.installMode === "prefer-universal" || !entry.installMode) {
      const stdRecord = entry.adapters["standards"];
      if (!stdRecord?.mcp && Object.keys(bundle.mcpServers).length > 0) {
        log.dim("  Standards: .mcp.json not installed (skipped — a detected tool reads it natively)");
      }
      if (!stdRecord?.instructions && bundle.agentInstructions) {
        log.dim("  Standards: AGENTS.md not installed (skipped — a detected tool reads it natively)");
      }
    }
```

- [ ] **Step 3: Verify check.ts already handles this correctly**

`check.ts` uses `checkFreshness()` which compares installed manifest entries against the current stack. Since skipped artifacts have no manifest entry, `checkFreshness()` won't flag them. Verify this by reading the function and confirming it only checks artifacts that exist in `entry.adapters[adapterId]`.

If `checkFreshness()` does flag missing adapters (e.g., it expects Standards to always have MCP), add a skip condition similar to status.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/status.ts src/commands/check.ts
git commit -m "feat: status/check handle installMode for skipped artifacts

Status shows explanatory message for skipped Standards files.
Check does not flag skipped artifacts as missing."
```

---

### Task 8: Final integration validation

**Files:**
- No new files — validation only

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Builds successfully

- [ ] **Step 4: Manual smoke test — default mode**

Create a temp directory with `CLAUDE.md`, run `pit install` with the valid-stack fixture:

```bash
tmp=$(mktemp -d)
echo "# Test" > "$tmp/CLAUDE.md"
node dist/cli.js install test/__fixtures__/stacks/valid-stack "$tmp"
```

Verify:
- `.mcp.json` does NOT exist in `$tmp`
- `.claude/settings.json` has MCP servers
- `AGENTS.md` does NOT exist (Cursor/Copilot not detected, but Claude Code's nativelyReads.instructions is unset — so AGENTS.md SHOULD exist via Standards. If only Claude Code detected, skipInstructions is false.)
- Log shows "Standards: skipped .mcp.json" message

- [ ] **Step 5: Manual smoke test — --prefer-universal**

```bash
tmp=$(mktemp -d)
echo "# Test" > "$tmp/CLAUDE.md"
node dist/cli.js install --prefer-universal test/__fixtures__/stacks/valid-stack "$tmp"
```

Verify:
- `.mcp.json` EXISTS
- `.claude/settings.json` has NO mcpServers key
- `CLAUDE.md` still has instructions (Claude Code doesn't read AGENTS.md)

- [ ] **Step 6: Manual smoke test — --force-standards**

```bash
tmp=$(mktemp -d)
echo "# Test" > "$tmp/CLAUDE.md"
node dist/cli.js install --force-standards test/__fixtures__/stacks/valid-stack "$tmp"
```

Verify:
- `.mcp.json` EXISTS
- `.claude/settings.json` ALSO has mcpServers (deliberate duplication)

- [ ] **Step 7: Clean up temp directories**

```bash
rm -rf "$tmp"
```
