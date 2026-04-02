import { describe, it, expect } from "vitest";
import { mergeConfigs } from "../../src/core/merger.js";
import type { PlatformConfig } from "../../src/adapters/types.js";
import type { AgentEntry } from "../../src/shared/schema.js";

function makeConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    adapterId: "test",
    agentInstructions: "",
    skills: [],
    agents: [],
    mcpServers: {},
    rules: [],
    ...overrides,
  };
}

function makeAgent(name: string): AgentEntry {
  return {
    name,
    path: `agents/${name}`,
    frontmatter: { name, description: `${name} agent` },
    content: `---\nname: ${name}\ndescription: ${name} agent\n---\n\nDo ${name} things.\n`,
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
});

describe("mergeConfigs agents", () => {
  it("passes through agents from a single config", () => {
    const config: PlatformConfig = makeConfig({
      adapterId: "claude-code",
      agents: [makeAgent("reviewer")],
    });
    const result = mergeConfigs([config]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.name).toBe("reviewer");
  });

  it("deduplicates agents by name across configs", () => {
    const config1: PlatformConfig = makeConfig({
      adapterId: "claude-code",
      agents: [makeAgent("reviewer")],
    });
    const config2: PlatformConfig = makeConfig({
      adapterId: "copilot",
      agents: [makeAgent("reviewer"), makeAgent("deployer")],
    });
    const result = mergeConfigs([config1, config2]);
    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.name)).toEqual(["reviewer", "deployer"]);
  });

  it("handles empty agents", () => {
    const config: PlatformConfig = makeConfig({ adapterId: "test", agents: [] });
    const result = mergeConfigs([config]);
    expect(result.agents).toEqual([]);
  });
});

describe("mergeConfigs MCP", () => {
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
    const result = mergeConfigs([a, b]);
    expect(result.mcpServers).toHaveProperty("postgres");
    expect(result.mcpServers).toHaveProperty("redis");
    expect(result.mcpServers.postgres.command).toBe("pg-a");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("postgres")]),
    );
  });
});
