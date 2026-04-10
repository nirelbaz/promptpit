# Install Lifecycle Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `scripts.preinstall` and `scripts.postinstall` to `stack.json` that run shell commands before/after `pit install` writes files.

**Architecture:** New `src/core/scripts.ts` module handles script execution, consent prompting, and extends-chain script collection. Schema gets a `scripts` field. Install command calls into scripts module at two hook points. Three new CLI flags: `--trust`, `--ignore-scripts`, `--ignore-script-errors`.

**Tech Stack:** Node.js `child_process.execFile`, Zod schemas, readline for interactive consent, vitest for testing.

**Spec:** `docs/specs/2026-04-10-install-lifecycle-scripts-design.md`

---

### Task 1: Schema — Add `scripts` field to `stackManifestSchema`

**Files:**
- Modify: `src/shared/schema.ts:7-27`
- Test: `test/core/scripts.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/core/scripts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stackManifestSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema scripts field", () => {
  const base = { name: "test", version: "1.0.0" };

  it("accepts manifest without scripts", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts manifest with preinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with postinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with both scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo prep", postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scripts?.preinstall).toBe("echo prep");
      expect(result.data.scripts?.postinstall).toBe("./setup.sh");
    }
  });

  it("rejects empty string scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string script values", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: 42 },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/core/scripts.test.ts`
Expected: FAIL — `scripts` field not recognized by schema yet.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/schema.ts`, add the `scripts` field to `stackManifestSchema` (before line 27, after `instructionStrategy`):

```typescript
  scripts: z.object({
    preinstall: z.string().min(1).optional(),
    postinstall: z.string().min(1).optional(),
  }).optional(),
```

The full schema should now be:

```typescript
export const stackManifestSchema = z.object({
  name: z.string().min(1).regex(
    /^[a-zA-Z0-9_@][a-zA-Z0-9_.\-/]*$/,
    "Only alphanumeric, dash, underscore, dot, @, and / allowed",
  ),
  version: z.string().regex(semverRegex, "Must be valid semver (e.g., 1.0.0)"),
  description: z.string().optional(),
  license: z.string().optional(),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  compatibility: z.array(z.string()).optional(),
  extends: z.array(z.string()).optional(),
  instructionStrategy: z.enum(["concatenate", "override"]).optional(),
  scripts: z.object({
    preinstall: z.string().min(1).optional(),
    postinstall: z.string().min(1).optional(),
  }).optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/core/scripts.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schema.ts test/core/scripts.test.ts
git commit -m "feat: add scripts field to stack manifest schema"
```

---

### Task 2: Core — Create `src/core/scripts.ts`

**Files:**
- Create: `src/core/scripts.ts`
- Modify: `test/core/scripts.test.ts`

- [ ] **Step 1: Write the failing tests for `runLifecycleScript`**

Append to `test/core/scripts.test.ts`:

```typescript
import { runLifecycleScript, collectScripts, type ScriptEntry } from "../../src/core/scripts.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("runLifecycleScript", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("runs a script and returns success", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const result = await runLifecycleScript("postinstall", "echo hello", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });

    expect(result.success).toBe(true);
  });

  it("returns failure on non-zero exit code", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const result = await runLifecycleScript("postinstall", "exit 1", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });

    expect(result.success).toBe(false);
  });

  it("runs script from the given cwd", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "marker.txt"), "found");

    const result = await runLifecycleScript("postinstall", "cat marker.txt", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });

    expect(result.success).toBe(true);
  });

  it("injects PIT_ environment variables", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const result = await runLifecycleScript(
      "postinstall",
      "test \"$PIT_STACK_NAME\" = \"my-stack\"",
      dir,
      {
        PIT_TARGET_DIR: "/tmp/target",
        PIT_STACK_NAME: "my-stack",
        PIT_STACK_VERSION: "2.0.0",
        PIT_SOURCE: "github:org/repo",
      },
    );

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/core/scripts.test.ts`
Expected: FAIL — `src/core/scripts.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/core/scripts.ts`:

```typescript
import { execFile } from "node:child_process";
import { log, spinner } from "../shared/io.js";

export interface ScriptEnv {
  PIT_TARGET_DIR: string;
  PIT_STACK_NAME: string;
  PIT_STACK_VERSION: string;
  PIT_SOURCE: string;
}

export interface ScriptResult {
  success: boolean;
  code: number | null;
}

export interface ScriptEntry {
  phase: "preinstall" | "postinstall";
  script: string;
  stackDir: string;
  stackName: string;
  stackVersion: string;
  source: string;
}

export function runLifecycleScript(
  phase: "preinstall" | "postinstall",
  script: string,
  cwd: string,
  env: ScriptEnv,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "sh",
      ["-c", script],
      {
        cwd,
        env: { ...process.env, ...env },
      },
      (error, _stdout, _stderr) => {
        if (error) {
          resolve({ success: false, code: error.code ?? 1 });
        } else {
          resolve({ success: true, code: 0 });
        }
      },
    );
    // Pipe child output to parent so user sees real-time progress
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export function collectScripts(
  entries: Array<{
    manifest: { name: string; version: string; scripts?: { preinstall?: string; postinstall?: string } };
    stackDir: string;
    source: string;
  }>,
  phase: "preinstall" | "postinstall",
): ScriptEntry[] {
  const result: ScriptEntry[] = [];
  for (const entry of entries) {
    const script = entry.manifest.scripts?.[phase];
    if (script) {
      result.push({
        phase,
        script,
        stackDir: entry.stackDir,
        stackName: entry.manifest.name,
        stackVersion: entry.manifest.version,
        source: entry.source,
      });
    }
  }
  return result;
}

export async function promptForScriptConsent(
  entry: ScriptEntry,
): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error();
  log.warn(`This stack wants to run a ${entry.phase} script:`);
  console.error();
  console.error(`  ${entry.script}`);
  console.error();
  console.error(`  Source: ${entry.source}`);
  console.error(`  Stack:  ${entry.stackName}`);
  console.error();

  return new Promise((resolve) => {
    rl.question("Allow? [y/N] ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function executeScripts(
  entries: ScriptEntry[],
  opts: {
    targetDir: string;
    isRemote: (source: string) => boolean;
    trust?: boolean;
    ignoreScriptErrors?: boolean;
  },
): Promise<void> {
  for (const entry of entries) {
    // Consent check for remote stacks
    if (opts.isRemote(entry.source) && !opts.trust) {
      const allowed = await promptForScriptConsent(entry);
      if (!allowed) {
        log.info(`Skipped ${entry.phase} script from ${entry.stackName}`);
        continue;
      }
    }

    const spin = spinner(`Running ${entry.phase} (${entry.stackName})...`);

    const env: ScriptEnv = {
      PIT_TARGET_DIR: opts.targetDir,
      PIT_STACK_NAME: entry.stackName,
      PIT_STACK_VERSION: entry.stackVersion,
      PIT_SOURCE: entry.source,
    };

    const result = await runLifecycleScript(entry.phase, entry.script, entry.stackDir, env);

    if (result.success) {
      spin.succeed(`${entry.phase} (${entry.stackName}) completed`);
    } else if (opts.ignoreScriptErrors) {
      spin.warn(`${entry.phase} (${entry.stackName}) failed (exit ${result.code}) — continuing`);
    } else {
      spin.fail(`${entry.phase} (${entry.stackName}) failed (exit ${result.code})`);
      throw new Error(
        `${entry.phase} script from "${entry.stackName}" exited with code ${result.code}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/core/scripts.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Write tests for `collectScripts`**

Append to the `test/core/scripts.test.ts` file:

```typescript
describe("collectScripts", () => {
  it("collects postinstall scripts in dependency order", () => {
    const entries = [
      {
        manifest: { name: "dep-b", version: "1.0.0", scripts: { postinstall: "./setup-b.sh" } },
        stackDir: "/tmp/b",
        source: "github:org/b",
      },
      {
        manifest: { name: "dep-a", version: "1.0.0", scripts: { postinstall: "./setup-a.sh" } },
        stackDir: "/tmp/a",
        source: "github:org/a",
      },
      {
        manifest: { name: "root", version: "1.0.0" },
        stackDir: "/tmp/root",
        source: ".promptpit",
      },
    ];

    const result = collectScripts(entries, "postinstall");
    expect(result).toHaveLength(2);
    expect(result[0].stackName).toBe("dep-b");
    expect(result[1].stackName).toBe("dep-a");
  });

  it("returns empty array when no scripts defined", () => {
    const entries = [
      { manifest: { name: "no-scripts", version: "1.0.0" }, stackDir: "/tmp/x", source: ".promptpit" },
    ];
    const result = collectScripts(entries, "preinstall");
    expect(result).toHaveLength(0);
  });

  it("collects preinstall scripts", () => {
    const entries = [
      {
        manifest: { name: "dep", version: "1.0.0", scripts: { preinstall: "echo prep" } },
        stackDir: "/tmp/dep",
        source: "github:org/dep",
      },
      {
        manifest: { name: "root", version: "1.0.0", scripts: { preinstall: "echo root-prep", postinstall: "./setup.sh" } },
        stackDir: "/tmp/root",
        source: ".promptpit",
      },
    ];
    const result = collectScripts(entries, "preinstall");
    expect(result).toHaveLength(2);
    expect(result[0].script).toBe("echo prep");
    expect(result[1].script).toBe("echo root-prep");
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/core/scripts.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/scripts.ts test/core/scripts.test.ts
git commit -m "feat: add scripts module for lifecycle script execution"
```

---

### Task 3: CLI — Add `--trust`, `--ignore-scripts`, `--ignore-script-errors` flags

**Files:**
- Modify: `src/cli.ts:80-135`
- Modify: `src/commands/install.ts:20-28`

- [ ] **Step 1: Add flags to `InstallOptions`**

In `src/commands/install.ts`, update the `InstallOptions` interface (lines 20-28):

```typescript
export interface InstallOptions {
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  forceStandards?: boolean;
  preferUniversal?: boolean;
  save?: boolean;
  trust?: boolean;
  ignoreScripts?: boolean;
  ignoreScriptErrors?: boolean;
}
```

- [ ] **Step 2: Add flags to Commander in `cli.ts`**

In `src/cli.ts`, add three new options to the `install` command, after the `--save` option (after line 100):

```typescript
  .option("--trust", "Trust remote stack scripts (skip consent prompt)")
  .option("--ignore-scripts", "Skip lifecycle scripts (preinstall/postinstall)")
  .option(
    "--ignore-script-errors",
    "Continue install even if lifecycle scripts fail",
  )
```

Update the opts type in the action handler (lines 114-122) to include the new fields:

```typescript
      opts: {
        global?: boolean;
        dryRun?: boolean;
        force?: boolean;
        verbose?: boolean;
        forceStandards?: boolean;
        preferUniversal?: boolean;
        save?: boolean;
        trust?: boolean;
        ignoreScripts?: boolean;
        ignoreScriptErrors?: boolean;
      },
```

- [ ] **Step 3: Run lint to verify**

Run: `npm run lint`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/commands/install.ts
git commit -m "feat: add --trust, --ignore-scripts, --ignore-script-errors CLI flags"
```

---

### Task 4: Install integration — Wire scripts into the install flow

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `test/commands/install.test.ts`

- [ ] **Step 1: Write the failing test for postinstall execution**

Append to `test/commands/install.test.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
```

(Add `mkdir` to the existing import from `node:fs/promises` at line 4.)

Then add the test:

```typescript
  it("runs postinstall script after files are written", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Create a stack with a postinstall script that creates a marker file
    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/postinstall-ran"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest instructions");

    await installStack(stackDir, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "postinstall-ran"))).resolves.toBeUndefined();
  });

  it("runs preinstall script before files are written", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // preinstall creates a directory that will be present when files are written
    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { preinstall: `mkdir -p "${target}/pre-marker"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest instructions");

    await installStack(stackDir, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "pre-marker"))).resolves.toBeUndefined();
  });

  it("skips scripts with --ignore-scripts", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/should-not-exist"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    await installStack(stackDir, target, { ignoreScripts: true });

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "should-not-exist"))).rejects.toThrow();
  });

  it("aborts install on preinstall failure by default", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { preinstall: "exit 1" },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    await expect(installStack(stackDir, target, {})).rejects.toThrow(
      /preinstall script.*exited with code/,
    );

    // Verify no files were written (install was aborted)
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toBe("# Existing\n");
  });

  it("continues on script failure with --ignore-script-errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: "exit 1" },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    // Should not throw
    await installStack(stackDir, target, { ignoreScriptErrors: true });

    // Install still completed (CLAUDE.md was written)
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:script-test");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/commands/install.test.ts`
Expected: FAIL — script execution not wired in yet.

- [ ] **Step 3: Wire scripts into `install.ts`**

At the top of `src/commands/install.ts`, add the import:

```typescript
import { collectScripts, executeScripts, type ScriptEntry } from "../core/scripts.js";
```

In `installStack()`, after extends resolution and security validation (after line 169, before line 171 "Detect target adapters"), add logic to build the script entries list from the resolved graph. The key data needed:

1. Build a list of `{ manifest, stackDir, source }` entries in dependency order (same order as `graph.nodes`, which is deepest-first with root last).
2. For stacks without extends, the list is just the single root bundle.

Add this block after line 169 (after MCP warning, before adapter detection):

```typescript
    // Collect lifecycle scripts from resolved chain
    const isRemote = (src: string) => !!parseGitHubSource(src);

    // Build ordered entries for script collection (dependency order: deepest first)
    const scriptChainEntries: Array<{
      manifest: { name: string; scripts?: { preinstall?: string; postinstall?: string } };
      stackDir: string;
      source: string;
    }> = [];

    if (bundle.manifest.extends && bundle.manifest.extends.length > 0) {
      // resolveGraph was already called above — reuse the graph variable
      // graph.nodes is in dependency order (deepest first, root last)
      // Note: graph is scoped inside the if-block above. We need to lift it.
      // See implementation note below.
    }
    // For the root stack (always included)
    scriptChainEntries.push({
      manifest: finalBundle.manifest,
      stackDir: resolvedSource,
      source,
    });
```

**Important:** The `graph` variable from extends resolution (line 117) is scoped inside the `if (bundle.manifest.extends)` block. To reuse node information for scripts, we need to lift the graph nodes data. The cleanest approach: after extends resolution, save the node metadata to a variable accessible at the script collection point.

After line 146 (end of extends resolution block), declare at function scope (before the extends `if` block):

```typescript
    // Track resolved graph nodes for script collection (dependency order)
    let resolvedNodes: Array<{ source: string; stackDir: string; bundle: StackBundle }> = [];
```

Inside the extends resolution block, after `resolvedExtendsEntries` is built (after line 145), add:

```typescript
      resolvedNodes = graph.nodes.filter((n) => n.depth > 0);
```

Then, after the MCP warning (after line 169), the script collection becomes:

```typescript
    // Collect lifecycle scripts from resolved chain
    const scriptChainEntries = [
      // Dependencies first (deepest-first order from resolveGraph)
      ...resolvedNodes.map((n) => ({
        manifest: n.bundle.manifest,
        stackDir: n.stackDir,
        source: n.source,
      })),
      // Root stack last
      {
        manifest: finalBundle.manifest,
        stackDir: resolvedSource,
        source,
      },
    ];

    // Run preinstall scripts (before any files are written)
    if (!opts.ignoreScripts) {
      const preScripts = collectScripts(scriptChainEntries, "preinstall");
      if (preScripts.length > 0) {
        await executeScripts(preScripts, {
          targetDir: target,
          isRemote: (src) => !!parseGitHubSource(src),
          trust: opts.trust,
          ignoreScriptErrors: opts.ignoreScriptErrors,
        });
      }
    }
```

Then, after .env handling (after line 497, before the success message at line 499), add:

```typescript
    // Run postinstall scripts (after all files are written)
    if (!opts.ignoreScripts) {
      const postScripts = collectScripts(scriptChainEntries, "postinstall");
      if (postScripts.length > 0) {
        await executeScripts(postScripts, {
          targetDir: target,
          isRemote: (src) => !!parseGitHubSource(src),
          trust: opts.trust,
          ignoreScriptErrors: opts.ignoreScriptErrors,
        });
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/commands/install.test.ts`
Expected: All tests PASS (both new and existing).

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/install.ts test/commands/install.test.ts
git commit -m "feat: wire lifecycle scripts into install flow"
```

---

### Task 5: Dry-run — Show scripts in `pit install --dry-run` output

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `test/commands/install.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/commands/install.test.ts`:

```typescript
  it("dry-run shows lifecycle scripts without executing", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/should-not-run"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await installStack(stackDir, target, { dryRun: true });
    } finally {
      console.log = origLog;
    }

    // Script should be shown in output
    const output = logs.join("\n");
    expect(output).toContain("postinstall");
    expect(output).toContain("touch");

    // Script should NOT have been executed
    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "should-not-run"))).rejects.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/commands/install.test.ts`
Expected: FAIL — dry-run output doesn't mention scripts yet.

- [ ] **Step 3: Add scripts to dry-run output**

In the dry-run branch of `install.ts` (around the `if (opts.dryRun)` block that starts at line 315), before `printDryRunReport` is called, add a "Lifecycle scripts" section:

```typescript
      // Show lifecycle scripts in dry-run
      if (!opts.ignoreScripts) {
        const preScripts = collectScripts(scriptChainEntries, "preinstall");
        const postScripts = collectScripts(scriptChainEntries, "postinstall");
        const allScripts = [...preScripts, ...postScripts];
        if (allScripts.length > 0) {
          sections.push({
            label: "Lifecycle scripts",
            entries: allScripts.map((s) => ({
              file: `${s.phase}: ${s.script}`,
              action: "run" as const,
              detail: s.stackName,
            })),
          });
        }
      }
```

Also add `"run"` to the `DryRunEntry` action type. In `src/adapters/types.ts`, find the `DryRunEntry` interface and add `"run"` to the action union. And in `src/shared/io.ts`, handle the `"run"` action color in `printDryRunReport`:

```typescript
      const actionColor =
        entry.action === "create"
          ? chalk.green
          : entry.action === "modify"
            ? chalk.yellow
            : entry.action === "run"
              ? chalk.magenta
              : chalk.dim;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/commands/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/install.ts src/shared/io.ts src/adapters/types.ts test/commands/install.test.ts
git commit -m "feat: show lifecycle scripts in dry-run output"
```

---

### Task 6: Validation — Warn about scripts in `pit validate`

**Files:**
- Modify: `src/core/validate.ts`
- Create: `test/core/validate-scripts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/validate-scripts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateStack } from "../../src/core/validate.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("validate scripts", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("passes validation with valid scripts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    tmpDirs.push(dir);
    await writeFile(
      path.join(dir, "stack.json"),
      JSON.stringify({
        name: "test",
        version: "1.0.0",
        scripts: { postinstall: "./setup.sh" },
      }),
    );

    const result = await validateStack(dir);
    const scriptDiags = result.diagnostics.filter((d) => d.message.includes("script"));
    expect(scriptDiags.filter((d) => d.level === "error")).toHaveLength(0);
  });

  it("errors on empty script string", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    tmpDirs.push(dir);
    await writeFile(
      path.join(dir, "stack.json"),
      // Manually write invalid JSON that Zod will catch
      '{"name":"test","version":"1.0.0","scripts":{"postinstall":""}}',
    );

    const result = await validateStack(dir);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify correctness**

Run: `npm test -- test/core/validate-scripts.test.ts`
Expected: The Zod schema validation already handles empty strings (from Task 1). Both tests should PASS because the schema rejects `""` via `z.string().min(1)`. If they don't pass, the schema addition in Task 1 handles this.

- [ ] **Step 3: Commit**

```bash
git add test/core/validate-scripts.test.ts
git commit -m "test: add validation tests for lifecycle scripts"
```

---

### Task 7: Test fixture — Add a stack with scripts for reuse

**Files:**
- Create: `test/__fixtures__/stacks/stack-with-scripts/stack.json`
- Create: `test/__fixtures__/stacks/stack-with-scripts/agent.promptpit.md`
- Create: `test/__fixtures__/stacks/stack-with-scripts/setup.sh`

- [ ] **Step 1: Create the fixture**

Create `test/__fixtures__/stacks/stack-with-scripts/stack.json`:
```json
{
  "name": "script-stack",
  "version": "1.0.0",
  "description": "Test stack with lifecycle scripts",
  "scripts": {
    "preinstall": "echo preinstall-ran",
    "postinstall": "./setup.sh"
  }
}
```

Create `test/__fixtures__/stacks/stack-with-scripts/agent.promptpit.md`:
```markdown
---
---
Stack with lifecycle scripts for testing.
```

Create `test/__fixtures__/stacks/stack-with-scripts/setup.sh`:
```bash
#!/bin/sh
echo "postinstall-ran"
touch "$PIT_TARGET_DIR/.postinstall-marker"
```

Make it executable:
```bash
chmod +x test/__fixtures__/stacks/stack-with-scripts/setup.sh
```

- [ ] **Step 2: Write a test using the fixture**

Append to `test/commands/install.test.ts`:

```typescript
  const SCRIPT_STACK = path.resolve("test/__fixtures__/stacks/stack-with-scripts");

  it("runs fixture stack scripts and creates marker file", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(SCRIPT_STACK, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, ".postinstall-marker"))).resolves.toBeUndefined();
  });
```

- [ ] **Step 3: Run tests to verify**

Run: `npm test -- test/commands/install.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/__fixtures__/stacks/stack-with-scripts/ test/commands/install.test.ts
git commit -m "test: add stack-with-scripts fixture and integration test"
```

---

### Task 8: Final verification — Full suite + lint + build

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No type errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds, `dist/cli.js` generated.

- [ ] **Step 4: Manual smoke test**

Create a temporary stack and verify scripts run:

```bash
cd /tmp && mkdir pit-smoke && cd pit-smoke
mkdir .promptpit
cat > .promptpit/stack.json << 'EOF'
{
  "name": "smoke-test",
  "version": "1.0.0",
  "scripts": {
    "preinstall": "echo '>>> preinstall ran'",
    "postinstall": "echo '>>> postinstall ran'"
  }
}
EOF
echo '---\n---\nSmoke test' > .promptpit/agent.promptpit.md
node /path/to/dist/cli.js install
```

Expected: Both echo messages visible in output between the install steps.

Then test dry-run:
```bash
node /path/to/dist/cli.js install --dry-run
```

Expected: Scripts shown in output, not executed.

Then test --ignore-scripts:
```bash
node /path/to/dist/cli.js install --ignore-scripts
```

Expected: No echo messages, install completes normally.
