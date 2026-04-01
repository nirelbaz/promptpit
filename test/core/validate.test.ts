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

  it("returns errors for invalid mcp.json and skill frontmatter", async () => {
    const result = await validateStack(INVALID_STACK);
    expect(result.diagnostics.some((d) => d.file === "mcp.json" && d.level === "error")).toBe(true);
    expect(result.diagnostics.some((d) => d.file.startsWith("skills/") && d.level === "error")).toBe(true);
  });

  it("returns error for invalid agent.promptpit.md frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await writeFile(path.join(dir, "agent.promptpit.md"), "---\n: bad yaml: [\n---\n");
      const result = await validateStack(dir);
      const agentDiag = result.diagnostics.find((d) => d.file === "agent.promptpit.md");
      expect(agentDiag).toMatchObject({ level: "error", source: "pit" });
      expect(agentDiag!.message).toContain("Invalid frontmatter");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns warnings for dangerous env names", async () => {
    const result = await validateStack(INVALID_STACK);
    const envWarnings = result.diagnostics.filter(
      (d) => d.file === ".env.example" && d.level === "warning",
    );
    expect(envWarnings.length).toBeGreaterThanOrEqual(1);
    expect(envWarnings[0]!.message).toContain("PATH");
    expect(result.warnings).toBeGreaterThanOrEqual(1);
  });
});
