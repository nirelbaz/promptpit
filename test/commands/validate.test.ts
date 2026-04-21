import { describe, it, expect, vi, afterEach } from "vitest";
import { validateCommand, ExitError } from "../../src/commands/validate.js";
import { validateStack, LARGE_INSTRUCTION_THRESHOLD } from "../../src/core/validate.js";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
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

  it("throws ExitError when stack has errors (signals non-zero exit)", async () => {
    await expect(
      captureConsole(() => validateCommand(INVALID_STACK, {})),
    ).rejects.toBeInstanceOf(ExitError);
  });

  it("throws ExitError with --json when stack has errors", async () => {
    await expect(
      captureConsole(() => validateCommand(INVALID_STACK, { json: true })),
    ).rejects.toBeInstanceOf(ExitError);
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

  it("warns about unusually large instruction files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-large-"));
    tmpDirs.push(dir);

    // Copy a valid stack.json from fixture
    await copyFile(
      path.join(VALID_STACK, "stack.json"),
      path.join(dir, "stack.json"),
    );

    // Write an instruction file that exceeds the threshold
    const frontmatter = "---\nname: big-stack\ndescription: test\n---\n\n";
    const largeContent = frontmatter + "x".repeat(LARGE_INSTRUCTION_THRESHOLD + 1000);
    await writeFile(path.join(dir, "agent.promptpit.md"), largeContent);

    const result = await validateStack(dir);
    const sizeWarning = result.diagnostics.find(
      (d) => d.file === "agent.promptpit.md" && d.level === "warning" && d.message.includes("unusually large"),
    );
    expect(sizeWarning).toBeDefined();
    expect(sizeWarning!.message).toMatch(/\d+\.\d+ KB/);
  });

  it("does not warn about normal-sized instruction files", async () => {
    const result = await validateStack(VALID_STACK);
    const sizeWarning = result.diagnostics.find(
      (d) => d.file === "agent.promptpit.md" && d.message.includes("unusually large"),
    );
    expect(sizeWarning).toBeUndefined();
  });
});
