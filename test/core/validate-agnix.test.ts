import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { promisify } from "node:util";

// Controllable mock implementation, swapped per test
let currentImpl: (bin: string, args: string[], opts: unknown) => Promise<{ stdout: string; stderr: string }>;

vi.mock("node:child_process", () => {
  // Provide a callback-style execFile AND a custom promisify that delegates to currentImpl
  function execFile(bin: string, args: string[], opts: unknown, cb: (err: Error | null, stdout?: string, stderr?: string) => void) {
    currentImpl(bin, args, opts).then(
      (result) => cb(null, result.stdout, result.stderr),
      (err) => cb(err as Error),
    );
  }
  // Custom promisify so util.promisify(execFile) returns our async wrapper
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (bin: string, args: string[], opts: unknown) => {
    return currentImpl(bin, args, opts);
  };
  return { execFile };
});

// Helper: exec succeeds with stdout
function succeedWith(stdout: string) {
  return async () => ({ stdout, stderr: "" });
}

// Helper: exec fails (ENOENT)
function failEnoent() {
  return async () => {
    throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  };
}

// Helper: exec exits 1 but has stdout (agnix validation errors)
function exitOneWith(stdout: string) {
  return async () => {
    throw Object.assign(new Error("exit code 1"), { code: 1, stdout, stderr: "" });
  };
}

// Import after mock — promisify will use our custom implementation
const { validateStack, mapAgnixDiagnostic } = await import("../../src/core/validate.js");
const VALID_STACK = "test/__fixtures__/stacks/valid-stack";
const localBin = path.resolve("node_modules", ".bin", "agnix");

describe("agnix integration", () => {
  beforeEach(() => {
    currentImpl = failEnoent();
  });

  it("returns available: false when agnix is not installed", async () => {
    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(false);
    expect(result.agnix.diagnostics).toEqual([]);
  });

  it("maps agnix diagnostic shape to pit Diagnostic", () => {
    const mapped = mapAgnixDiagnostic({
      level: "warning",
      rule: "CC-042",
      file: "CLAUDE.md",
      message: "hooks should declare explicit timeout",
    });
    expect(mapped).toEqual({
      file: "CLAUDE.md",
      level: "warning",
      message: "hooks should declare explicit timeout",
      source: "agnix",
      rule: "CC-042",
    });
  });

  it("uses local agnix binary when available", async () => {
    const validOutput = JSON.stringify({
      diagnostics: [
        { level: "warning", rule: "CC-001", file: "agent.promptpit.md", message: "test warning" },
      ],
    });

    const calls: string[] = [];
    currentImpl = async (bin) => {
      calls.push(bin);
      if (bin === localBin) return { stdout: validOutput, stderr: "" };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(true);
    expect(result.agnix.diagnostics).toHaveLength(1);
    expect(result.agnix.diagnostics[0]).toEqual({
      file: "agent.promptpit.md",
      level: "warning",
      message: "test warning",
      source: "agnix",
      rule: "CC-001",
    });
    expect(calls).toContain(localBin);
  });

  it("falls back to global agnix when local is not found", async () => {
    const validOutput = JSON.stringify({ diagnostics: [] });

    const calls: string[] = [];
    currentImpl = async (bin) => {
      calls.push(bin);
      if (bin === "agnix") return { stdout: validOutput, stderr: "" };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(true);
    expect(result.agnix.diagnostics).toEqual([]);
    expect(calls).toContain(localBin);
    expect(calls).toContain("agnix");
  });

  it("handles agnix exit code 1 with JSON stdout", async () => {
    const errorOutput = JSON.stringify({
      diagnostics: [
        { level: "error", rule: "CC-042", file: "CLAUDE.md", message: "hooks need timeout" },
        { level: "warning", rule: "CC-100", file: "mcp.json", message: "missing description" },
      ],
    });

    currentImpl = exitOneWith(errorOutput);

    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(true);
    expect(result.agnix.diagnostics).toHaveLength(2);
    expect(result.agnix.diagnostics[0].level).toBe("error");
    expect(result.agnix.diagnostics[0].rule).toBe("CC-042");
    expect(result.agnix.diagnostics[1].level).toBe("warning");
  });

  it("returns available: false when agnix outputs invalid JSON", async () => {
    currentImpl = succeedWith("not valid json {{{");

    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(false);
    expect(result.agnix.diagnostics).toEqual([]);
  });
});
