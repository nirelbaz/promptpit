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

  it("accepts agent without description (inferred from body)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await mkdir(path.join(dir, "agents"), { recursive: true });
      await writeFile(
        path.join(dir, "agents", "bad.md"),
        "---\nname: bad\n---\n\nMissing description.\n",
      );
      const result = await validateStack(dir);
      const agentDiags = result.diagnostics.filter((d) => d.file.includes("agents/"));
      const errors = agentDiags.filter((d) => d.level === "error");
      expect(errors).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("passes validation for valid agents", async () => {
    const result = await validateStack(VALID_STACK);
    const agentDiags = result.diagnostics.filter((d) => d.file.includes("agents/"));
    expect(agentDiags).toHaveLength(0);
  });

  it("reports error for agent with malformed YAML that throws during parse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-agent-malformed-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await mkdir(path.join(dir, "agents"), { recursive: true });
      // This YAML is structurally invalid (unclosed flow sequence) — gray-matter will throw
      await writeFile(
        path.join(dir, "agents", "broken.md"),
        "---\nname: broken\ndescription: test\ntools: [\n---\n\nBody text.\n",
      );
      const result = await validateStack(dir);
      const agentDiags = result.diagnostics.filter((d) => d.file.includes("agents/"));
      expect(agentDiags.length).toBeGreaterThan(0);
      expect(agentDiags[0]!.level).toBe("error");
      // Should hit the catch branch and report "Invalid frontmatter"
      expect(agentDiags[0]!.message).toContain("Invalid frontmatter");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("validates rules with valid frontmatter", async () => {
    const result = await validateStack(VALID_STACK);
    expect(result.valid).toBe(true);
    const ruleDiags = result.diagnostics.filter((d) => d.file.startsWith("rules/"));
    expect(ruleDiags).toHaveLength(0);
  });

  it("accepts rule without name or description (relaxed for real-world compat)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-rules-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await mkdir(path.join(dir, "rules"), { recursive: true });
      await writeFile(path.join(dir, "rules", "no-name.md"), "---\nfoo: bar\n---\n\nNo name or description.\n");
      const result = await validateStack(dir);
      const ruleDiags = result.diagnostics.filter((d) => d.file.startsWith("rules/"));
      const errors = ruleDiags.filter((d) => d.level === "error");
      expect(errors).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("passes validation for valid command files", async () => {
    const result = await validateStack(VALID_STACK);
    const commandDiags = result.diagnostics.filter((d) => d.file.startsWith("commands/"));
    expect(commandDiags).toHaveLength(0);
  });

  it("returns warning for command file with invalid frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-cmd-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await mkdir(path.join(dir, "commands"), { recursive: true });
      // description must be a string — passing a number triggers a schema warning
      await writeFile(
        path.join(dir, "commands", "deploy.md"),
        "---\ndescription: 42\n---\n\nDeploy the app.\n",
      );
      const result = await validateStack(dir);
      const commandDiags = result.diagnostics.filter((d) => d.file.startsWith("commands/"));
      expect(commandDiags.length).toBeGreaterThan(0);
      expect(commandDiags[0]!.level).toBe("warning");
      expect(commandDiags[0]!.message).toContain("description");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("passes validation for command with valid optional description frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-cmd-valid-"));
    try {
      await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
      await mkdir(path.join(dir, "commands"), { recursive: true });
      // Valid frontmatter: description is a string — should produce zero warnings
      await writeFile(
        path.join(dir, "commands", "deploy.md"),
        "---\ndescription: Deploy the application to production\n---\n\nRun the deploy script.\n",
      );
      const result = await validateStack(dir);
      const commandDiags = result.diagnostics.filter((d) => d.file.startsWith("commands/"));
      expect(commandDiags).toHaveLength(0);
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
