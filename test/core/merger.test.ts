import { describe, it, expect } from "vitest";
import { mergeConfigs } from "../../src/core/merger.js";
import type { PlatformConfig } from "../../src/adapters/types.js";

function makeConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    adapterId: "test",
    agentInstructions: "",
    skills: [],
    mcpServers: {},
    rules: [],
    ...overrides,
  };
}

describe("mergeConfigs", () => {
  it("passes through single config", () => {
    const config = makeConfig({ agentInstructions: "hello" });
    const merged = mergeConfigs([config]);
    expect(merged.agentInstructions).toBe("hello");
  });

  it("concatenates agent instructions with headers", () => {
    const a = makeConfig({
      adapterId: "claude-code",
      agentInstructions: "Claude instructions",
    });
    const b = makeConfig({
      adapterId: "cursor",
      agentInstructions: "Cursor instructions",
    });
    const merged = mergeConfigs([a, b]);
    expect(merged.agentInstructions).toContain("## From claude-code");
    expect(merged.agentInstructions).toContain("Claude instructions");
    expect(merged.agentInstructions).toContain("## From cursor");
    expect(merged.agentInstructions).toContain("Cursor instructions");
  });

  it("unions skills by name, first seen wins", () => {
    const a = makeConfig({
      skills: [
        {
          name: "browse",
          path: "skills/browse",
          frontmatter: { name: "browse", description: "A" },
          content: "A",
        },
        {
          name: "review",
          path: "skills/review",
          frontmatter: { name: "review", description: "R" },
          content: "R",
        },
      ],
    });
    const b = makeConfig({
      skills: [
        {
          name: "browse",
          path: "skills/browse",
          frontmatter: { name: "browse", description: "B" },
          content: "B",
        },
      ],
    });
    const merged = mergeConfigs([a, b]);
    expect(merged.skills).toHaveLength(2);
    expect(merged.skills.find((s) => s.name === "browse")?.content).toBe("A");
  });

  it("unions MCP servers, first wins on conflict", () => {
    const a = makeConfig({
      mcpServers: { postgres: { command: "pg-a" } },
    });
    const b = makeConfig({
      mcpServers: {
        postgres: { command: "pg-b" },
        redis: { command: "redis" },
      },
    });
    const result = mergeConfigs([a, b], { returnWarnings: true });
    expect(result.mcpServers).toHaveProperty("postgres");
    expect(result.mcpServers).toHaveProperty("redis");
    expect(result.mcpServers.postgres.command).toBe("pg-a");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("postgres")]),
    );
  });
});
