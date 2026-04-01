import { describe, it, expect, vi, afterEach } from "vitest";
import { validateCommand } from "../../src/commands/validate.js";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
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
