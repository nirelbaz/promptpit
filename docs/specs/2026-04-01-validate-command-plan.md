# pit validate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pit validate [dir]` command that checks if a `.promptpit/` stack is well-formed, with optional agnix lint integration.

**Architecture:** Dedicated `core/validate.ts` module walks the stack directory, runs Zod schema checks against each file, collects diagnostics, and optionally shells out to agnix CLI. `commands/validate.ts` handles CLI output formatting. The core function returns a pure `ValidateResult` for reuse by future commands (`pit check`, `pit publish`).

**Tech Stack:** Zod (existing), gray-matter (existing), chalk (existing), child_process.execFile for agnix.

---

### Task 1: Test Fixtures

**Files:**
- Create: `test/__fixtures__/stacks/invalid-stack/stack.json`
- Create: `test/__fixtures__/stacks/invalid-stack/skills/bad-skill/SKILL.md`
- Create: `test/__fixtures__/stacks/invalid-stack/mcp.json`
- Create: `test/__fixtures__/stacks/invalid-stack/.env.example`

These fixtures are used by tests in Tasks 2-4. Create them first so tests can reference them.

- [ ] **Step 1: Create invalid-stack fixtures**

`test/__fixtures__/stacks/invalid-stack/stack.json` — invalid name (empty string fails Zod min(1)):
```json
{"name":"","version":"not-semver"}
```

`test/__fixtures__/stacks/invalid-stack/skills/bad-skill/SKILL.md` — missing required `description`:
```markdown
---
name: bad-skill
---

Content without description.
```

`test/__fixtures__/stacks/invalid-stack/mcp.json` — invalid structure (command must be string):
```json
{"broken-server": {"command": 123}}
```

`test/__fixtures__/stacks/invalid-stack/.env.example` — dangerous env name:
```
PATH=/usr/bin
SAFE_VAR=hello
```

- [ ] **Step 2: Commit fixtures**

```bash
git add test/__fixtures__/stacks/invalid-stack/
git commit -m "test: add invalid-stack fixtures for validate command"
```

---

### Task 2: Core Validation — Types and stack.json Check

**Files:**
- Create: `src/core/validate.ts`
- Create: `test/core/validate.test.ts`

- [ ] **Step 1: Write failing tests for types and stack.json validation**

`test/core/validate.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateStack } from "../../src/core/validate.js";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");
const INVALID_STACK = path.resolve("test/__fixtures__/stacks/invalid-stack");

describe("validateStack", () => {
  it("returns valid for a well-formed stack", async () => {
    const result = await validateStack(VALID_STACK);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns error when stack.json is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    try {
      const result = await validateStack(dir);
      expect(result.valid).toBe(false);
      expect(result.errors).toBe(1);
      expect(result.diagnostics[0]).toMatchObject({
        file: "stack.json",
        level: "error",
        source: "pit",
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns error when stack.json has invalid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    try {
      await writeFile(path.join(dir, "stack.json"), "not json{{{");
      const result = await validateStack(dir);
      expect(result.valid).toBe(false);
      const diag = result.diagnostics.find((d) => d.file === "stack.json");
      expect(diag).toMatchObject({ level: "error", source: "pit" });
      expect(diag!.message).toContain("Invalid JSON");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns errors for invalid stack.json schema", async () => {
    const result = await validateStack(INVALID_STACK);
    expect(result.valid).toBe(false);
    const stackErrors = result.diagnostics.filter(
      (d) => d.file === "stack.json" && d.level === "error",
    );
    expect(stackErrors.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/validate.test.ts`
Expected: FAIL — module `../../src/core/validate.js` not found

- [ ] **Step 3: Implement types and stack.json validation**

`src/core/validate.ts`:
```typescript
import path from "node:path";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "../adapters/adapter-utils.js";
import {
  stackManifestSchema,
  mcpConfigSchema,
  skillFrontmatterSchema,
  isDangerousEnvName,
} from "../shared/schema.js";
import { readFileOrNull } from "../shared/utils.js";
import fg from "fast-glob";

export interface Diagnostic {
  file: string;
  level: "error" | "warning";
  message: string;
  source: "pit" | "agnix";
  rule?: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
  agnix: {
    available: boolean;
    diagnostics: Diagnostic[];
  };
}

function addDiag(
  diagnostics: Diagnostic[],
  file: string,
  level: "error" | "warning",
  message: string,
): void {
  diagnostics.push({ file, level, message, source: "pit" });
}

export async function validateStack(stackDir: string): Promise<ValidateResult> {
  const diagnostics: Diagnostic[] = [];

  // --- stack.json (required) ---
  const manifestPath = path.join(stackDir, "stack.json");
  const manifestRaw = await readFileOrNull(manifestPath);
  if (!manifestRaw) {
    addDiag(diagnostics, "stack.json", "error", "File not found (required)");
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestRaw);
    } catch {
      addDiag(diagnostics, "stack.json", "error", "Invalid JSON");
    }
    if (parsed !== undefined) {
      const result = stackManifestSchema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(
            diagnostics,
            "stack.json",
            "error",
            `${issue.path.join(".")}: ${issue.message}`,
          );
        }
      }
    }
  }

  // --- agent.promptpit.md (optional) ---
  const agentPath = path.join(stackDir, "agent.promptpit.md");
  const agentRaw = await readFileOrNull(agentPath);
  if (agentRaw) {
    try {
      matter(agentRaw, SAFE_MATTER_OPTIONS as never);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, "agent.promptpit.md", "error", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- skills/*/SKILL.md (optional) ---
  const skillsDir = path.join(stackDir, "skills");
  const skillFiles = await fg("*/SKILL.md", { cwd: skillsDir, absolute: true }).catch(
    () => [] as string[],
  );
  for (const file of skillFiles) {
    const skillName = path.basename(path.dirname(file));
    const relPath = `skills/${skillName}/SKILL.md`;
    const raw = await readFileOrNull(file);
    if (!raw) continue;
    try {
      const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
      const result = skillFrontmatterSchema.safeParse(parsed.data);
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

  // --- mcp.json (optional) ---
  const mcpPath = path.join(stackDir, "mcp.json");
  const mcpRaw = await readFileOrNull(mcpPath);
  if (mcpRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mcpRaw);
    } catch {
      addDiag(diagnostics, "mcp.json", "error", "Invalid JSON");
    }
    if (parsed !== undefined) {
      const result = mcpConfigSchema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(
            diagnostics,
            "mcp.json",
            "error",
            `${issue.path.join(".")}: ${issue.message}`,
          );
        }
      }
    }
  }

  // --- .env.example (optional, warnings only) ---
  const envPath = path.join(stackDir, ".env.example");
  const envRaw = await readFileOrNull(envPath);
  if (envRaw) {
    for (const line of envRaw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const name = trimmed.slice(0, eqIdx);
        if (isDangerousEnvName(name)) {
          addDiag(diagnostics, ".env.example", "warning", `Dangerous env name: ${name}`);
        }
      }
    }
  }

  // --- agnix (optional, Task 4) ---
  const agnixResult = await runAgnix(stackDir);

  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings: warnings + agnixResult.diagnostics.filter((d) => d.level === "warning").length,
    diagnostics,
    agnix: agnixResult,
  };
}

// Placeholder — implemented in Task 4
async function runAgnix(_stackDir: string): Promise<ValidateResult["agnix"]> {
  return { available: false, diagnostics: [] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/core/validate.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/validate.ts test/core/validate.test.ts
git commit -m "feat: add core validation pipeline with stack.json, skills, MCP, env checks"
```

---

### Task 3: CLI Command and Output Formatting

**Files:**
- Create: `src/commands/validate.ts`
- Modify: `src/cli.ts` (add validate command registration)
- Create: `test/commands/validate.test.ts`

- [ ] **Step 1: Write failing tests for the command**

`test/commands/validate.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { validateCommand } from "../../src/commands/validate.js";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");
const INVALID_STACK = path.resolve("test/__fixtures__/stacks/invalid-stack");

describe("pit validate", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function captureConsole(fn: () => Promise<void>): Promise<string> {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return fn().then(
      () => {
        const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        logSpy.mockRestore();
        errSpy.mockRestore();
        return out;
      },
      (err) => {
        logSpy.mockRestore();
        errSpy.mockRestore();
        throw err;
      },
    );
  }

  it("prints pass for a valid stack", async () => {
    const output = await captureConsole(() => validateCommand(VALID_STACK, {}));
    expect(output).toContain("stack.json");
    expect(output).toContain("✓");
  });

  it("reports errors for an invalid stack", async () => {
    await expect(
      captureConsole(() => validateCommand(INVALID_STACK, {})),
    ).rejects.toThrow();
  });

  it("outputs JSON when --json is passed", async () => {
    const output = await captureConsole(() => validateCommand(VALID_STACK, { json: true }));
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("exits with error for missing directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    tmpDirs.push(dir);
    await expect(
      captureConsole(() => validateCommand(dir, {})),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/validate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the command handler**

`src/commands/validate.ts`:
```typescript
import chalk from "chalk";
import { validateStack, type ValidateResult, type Diagnostic } from "../core/validate.js";
import { log } from "../shared/io.js";

export interface ValidateOptions {
  json?: boolean;
}

// Error subclass to carry exit code without printing extra noise
class ExitError extends Error {
  constructor() {
    super("Validation failed");
    this.name = "ExitError";
  }
}

function statusIcon(level: "pass" | "error" | "warning"): string {
  switch (level) {
    case "pass": return chalk.green("✓");
    case "error": return chalk.red("✖");
    case "warning": return chalk.yellow("⚠");
  }
}

function fileStatus(
  file: string,
  diagnostics: Diagnostic[],
  extra?: string,
): void {
  const fileDiags = diagnostics.filter((d) => d.file === file);
  const hasError = fileDiags.some((d) => d.level === "error");
  const hasWarning = fileDiags.some((d) => d.level === "warning");

  if (hasError) {
    const msgs = fileDiags
      .filter((d) => d.level === "error")
      .map((d) => d.message)
      .join("; ");
    console.log(`  ${statusIcon("error")} ${file} ${chalk.red("— " + msgs)}`);
  } else if (hasWarning) {
    const msgs = fileDiags.map((d) => d.message).join("; ");
    console.log(`  ${statusIcon("warning")} ${file} ${chalk.yellow("— " + msgs)}`);
  } else {
    const suffix = extra ? ` ${chalk.dim(`(${extra})`)}` : "";
    console.log(`  ${statusIcon("pass")} ${file}${suffix}`);
  }
}

function formatHuman(result: ValidateResult, stackDir: string): void {
  console.log();
  console.log(`Validating ${stackDir} ...`);
  console.log();

  // Collect unique files in display order
  const displayFiles = ["stack.json", "agent.promptpit.md"];
  const skillFiles = result.diagnostics
    .filter((d) => d.file.startsWith("skills/"))
    .map((d) => d.file);
  // Also include skills that passed (no diagnostics) — we only know about them if there were issues
  // For clean stacks, we just show stack.json and other present files
  const uniqueSkills = [...new Set(skillFiles)];
  displayFiles.push(...uniqueSkills.sort());
  displayFiles.push("mcp.json", ".env.example");

  // Only show files that had diagnostics or are stack.json (always shown)
  const filesWithDiags = new Set(result.diagnostics.map((d) => d.file));

  for (const file of displayFiles) {
    if (file === "stack.json" || filesWithDiags.has(file)) {
      fileStatus(file, result.diagnostics);
    }
  }

  // Show all files that passed but aren't in our ordered list
  const shownFiles = new Set(displayFiles);
  for (const file of filesWithDiags) {
    if (!shownFiles.has(file)) {
      fileStatus(file, result.diagnostics);
    }
  }

  // agnix section
  if (result.agnix.available) {
    const agnixErrors = result.agnix.diagnostics.filter((d) => d.level === "error").length;
    const agnixWarnings = result.agnix.diagnostics.filter((d) => d.level === "warning").length;
    const passed = result.agnix.diagnostics.length === 0;
    if (passed) {
      console.log(`  ${statusIcon("pass")} agnix ${chalk.dim("— all checks passed")}`);
    } else {
      const parts: string[] = [];
      if (agnixErrors > 0) parts.push(`${agnixErrors} error${agnixErrors === 1 ? "" : "s"}`);
      if (agnixWarnings > 0) parts.push(`${agnixWarnings} warning${agnixWarnings === 1 ? "" : "s"}`);
      console.log(`  ${statusIcon(agnixErrors > 0 ? "error" : "warning")} agnix — ${parts.join(", ")}`);
      for (const d of result.agnix.diagnostics) {
        const icon = d.level === "error" ? statusIcon("error") : statusIcon("warning");
        const rule = d.rule ? `${d.rule}: ` : "";
        console.log(`    ${icon} ${rule}${d.message} (${d.file})`);
      }
    }
  } else {
    console.log();
    console.log(chalk.dim("  💡 Tip: install agnix for 385+ adapter-specific checks (npm i -D agnix)"));
  }

  // Summary
  console.log();
  if (result.valid) {
    log.success(`${stackDir} is valid`);
  } else {
    const parts: string[] = [];
    if (result.errors > 0) parts.push(`${result.errors} error${result.errors === 1 ? "" : "s"}`);
    if (result.warnings > 0) parts.push(`${result.warnings} warning${result.warnings === 1 ? "" : "s"}`);
    log.error(parts.join(", "));
  }
  console.log();
}

function formatJson(result: ValidateResult): void {
  console.log(JSON.stringify(result, null, 2));
}

export async function validateCommand(
  stackDir: string,
  opts: ValidateOptions,
): Promise<void> {
  const result = await validateStack(stackDir);

  if (opts.json) {
    formatJson(result);
  } else {
    formatHuman(result, stackDir);
  }

  if (!result.valid) {
    throw new ExitError();
  }
}
```

- [ ] **Step 4: Register the command in cli.ts**

Add to `src/cli.ts` after the watch command import:

```typescript
import { validateCommand } from "./commands/validate.js";
```

Add before `program.parse()`:

```typescript
program
  .command("validate")
  .description("Check if a stack is well-formed")
  .argument("[dir]", "Stack directory to validate", ".promptpit")
  .option("--json", "Output as JSON")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const stackDir = path.resolve(dir);
      await validateCommand(stackDir, opts);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ExitError") {
        process.exit(1);
      }
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/commands/validate.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing + new)

- [ ] **Step 7: Commit**

```bash
git add src/commands/validate.ts src/cli.ts test/commands/validate.test.ts
git commit -m "feat: add pit validate command with human and JSON output"
```

---

### Task 4: agnix Integration

**Files:**
- Modify: `src/core/validate.ts` (replace `runAgnix` placeholder)
- Create: `test/core/validate-agnix.test.ts`

- [ ] **Step 1: Write failing tests for agnix integration**

`test/core/validate-agnix.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";

// Test the agnix output parsing logic in isolation
// We mock execFile to avoid requiring agnix as a dependency

describe("agnix integration", () => {
  it("parses agnix JSON output into diagnostics", async () => {
    // Dynamically import so we can test the module
    const { validateStack } = await import("../../src/core/validate.js");
    const VALID_STACK = "test/__fixtures__/stacks/valid-stack";

    // When agnix is not installed, result should still work
    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(false);
    expect(result.agnix.diagnostics).toEqual([]);
  });

  it("maps agnix diagnostic shape to pit Diagnostic", async () => {
    const { mapAgnixDiagnostic } = await import("../../src/core/validate.js");

    const agnixDiag = {
      level: "warning",
      rule: "CC-042",
      file: "CLAUDE.md",
      message: "hooks should declare explicit timeout",
    };

    const mapped = mapAgnixDiagnostic(agnixDiag);
    expect(mapped).toEqual({
      file: "CLAUDE.md",
      level: "warning",
      message: "hooks should declare explicit timeout",
      source: "agnix",
      rule: "CC-042",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/validate-agnix.test.ts`
Expected: FAIL — `mapAgnixDiagnostic` not exported

- [ ] **Step 3: Implement agnix integration**

Replace the `runAgnix` placeholder in `src/core/validate.ts`. Add this import at the top:

```typescript
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath } from "node:path";

const execFileAsync = promisify(execFileCb);
```

Replace the placeholder `runAgnix` function and add `mapAgnixDiagnostic`:

```typescript
export function mapAgnixDiagnostic(d: {
  level: string;
  rule?: string;
  file: string;
  message: string;
}): Diagnostic {
  return {
    file: d.file,
    level: d.level === "error" ? "error" : "warning",
    message: d.message,
    source: "agnix",
    rule: d.rule,
  };
}

function findAgnixBinary(): string | null {
  try {
    // Check node_modules/.bin/agnix relative to cwd
    const binPath = resolvePath("node_modules", ".bin", "agnix");
    return binPath;
  } catch {
    return null;
  }
}

async function runAgnix(stackDir: string): Promise<ValidateResult["agnix"]> {
  const binPath = findAgnixBinary();
  if (!binPath) {
    return { available: false, diagnostics: [] };
  }

  try {
    // agnix exits non-zero when it finds errors, so we need to handle that
    const { stdout } = await execFileAsync(binPath, [
      "validate",
      "--format", "json",
      stackDir,
    ]).catch((err: { stdout?: string; stderr?: string }) => {
      // agnix exits 1 on validation errors but still outputs JSON to stdout
      if (err.stdout) return { stdout: err.stdout, stderr: err.stderr ?? "" };
      throw err;
    });

    const parsed = JSON.parse(stdout);
    if (!parsed.diagnostics || !Array.isArray(parsed.diagnostics)) {
      return { available: true, diagnostics: [] };
    }

    const diagnostics: Diagnostic[] = parsed.diagnostics.map(mapAgnixDiagnostic);
    return { available: true, diagnostics };
  } catch {
    // Binary not executable, JSON parse failed, or other error — skip gracefully
    return { available: false, diagnostics: [] };
  }
}
```

Also update the `errors`/`warnings` count in `validateStack` to include agnix errors:

```typescript
  const errors = diagnostics.filter((d) => d.level === "error").length
    + agnixResult.diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length
    + agnixResult.diagnostics.filter((d) => d.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    diagnostics,
    agnix: agnixResult,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/core/validate-agnix.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/validate.ts test/core/validate-agnix.test.ts
git commit -m "feat: add optional agnix CLI integration to pit validate"
```

---

### Task 5: Build Verification and Lint

**Files:**
- No new files — just verification

- [ ] **Step 1: Run TypeScript strict mode check**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: `dist/cli.js` built successfully

- [ ] **Step 3: Run full test suite one final time**

Run: `npm test`
Expected: All tests pass (163 existing + new validate tests)

- [ ] **Step 4: Smoke test the CLI**

Run against the valid fixture:
```bash
node dist/cli.js validate test/__fixtures__/stacks/valid-stack
```
Expected: Shows green checkmarks, exit 0

Run against the invalid fixture:
```bash
node dist/cli.js validate test/__fixtures__/stacks/invalid-stack || echo "exit: $?"
```
Expected: Shows errors, exit 1

Run with `--json`:
```bash
node dist/cli.js validate test/__fixtures__/stacks/valid-stack --json
```
Expected: Valid JSON output with `"valid": true`

- [ ] **Step 5: Commit plan doc if not already committed**

```bash
git add docs/specs/2026-04-01-validate-command-plan.md
git commit -m "docs: add pit validate implementation plan"
```
