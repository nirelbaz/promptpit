import { describe, it, expect } from "vitest";
import { agentFrontmatterSchema, skillFrontmatterSchema } from "../src/shared/schema.js";

describe("agent schema typed portable fields", () => {
  it("accepts all portable agent fields", () => {
    const result = agentFrontmatterSchema.safeParse({
      name: "test-agent",
      description: "Test agent",
      tools: ["Read"],
      model: "gpt-4o",
      "disable-model-invocation": true,
      "user-invocable": false,
      target: "github-copilot",
      "mcp-servers": { scanner: { command: "npx", args: ["-y", "scanner"] } },
      metadata: { category: "security" },
      effort: "high",
      maxTurns: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["disable-model-invocation"]).toBe(true);
      expect(result.data["user-invocable"]).toBe(false);
      expect(result.data.maxTurns).toBe(10);
      expect(result.data.effort).toBe("high");
      expect(result.data.target).toBe("github-copilot");
    }
  });

  it("still allows tool-specific passthrough fields", () => {
    const result = agentFrontmatterSchema.safeParse({
      name: "test",
      description: "Test",
      permissionMode: "bypassPermissions",
      isolation: "worktree",
      sandbox_mode: "read-only",
    });
    expect(result.success).toBe(true);
  });
});

describe("skill schema typed portable fields", () => {
  it("accepts all portable skill fields", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test-skill",
      description: "Test skill",
      "argument-hint": "URL to navigate to",
      "disable-model-invocation": true,
      effort: "low",
      hooks: { PreToolUse: [{ command: "echo test" }] },
      paths: ["src/**/*.ts"],
      shell: "bash",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["argument-hint"]).toBe("URL to navigate to");
      expect(result.data["disable-model-invocation"]).toBe(true);
      expect(result.data.paths).toEqual(["src/**/*.ts"]);
      expect(result.data.shell).toBe("bash");
    }
  });

  it("preserves unknown tool-specific skill fields via passthrough", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "Test",
      someCustomField: "value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).someCustomField).toBe("value");
    }
  });
});
