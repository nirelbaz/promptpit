import { describe, it, expect } from "vitest";
import { mergeAdapterConfigs } from "../../src/core/merger.js";
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
    commands: [],
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
    const merged = mergeAdapterConfigs([config]);
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
    const merged = mergeAdapterConfigs([a, b]);
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
    const merged = mergeAdapterConfigs([a, b]);
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
    const result = mergeAdapterConfigs([config]);
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
    const result = mergeAdapterConfigs([config1, config2]);
    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.name)).toEqual(["reviewer", "deployer"]);
  });

  it("handles empty agents", () => {
    const config: PlatformConfig = makeConfig({ adapterId: "test", agents: [] });
    const result = mergeAdapterConfigs([config]);
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
    const result = mergeAdapterConfigs([a, b]);
    expect(result.mcpServers).toHaveProperty("postgres");
    expect(result.mcpServers).toHaveProperty("redis");
    expect(result.mcpServers.postgres.command).toBe("pg-a");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("postgres")]),
    );
  });
});

describe("commands merge", () => {
  it("deduplicates commands by name", () => {
    const configs: PlatformConfig[] = [
      {
        adapterId: "claude-code",
        agentInstructions: "",
        skills: [],
        agents: [],
        mcpServers: {},
        rules: [],
        commands: [
          { name: "review", path: "commands/review", content: "Review from Claude" },
        ],
      },
      {
        adapterId: "cursor",
        agentInstructions: "",
        skills: [],
        agents: [],
        mcpServers: {},
        rules: [],
        commands: [
          { name: "review", path: "commands/review", content: "Review from Cursor" },
          { name: "deploy", path: "commands/deploy", content: "Deploy" },
        ],
      },
    ];

    const result = mergeAdapterConfigs(configs);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]!.content).toBe("Review from Claude");
    expect(result.commands[1]!.name).toBe("deploy");
  });

  it("handles empty commands arrays", () => {
    const configs: PlatformConfig[] = [
      {
        adapterId: "claude-code",
        agentInstructions: "test",
        skills: [],
        agents: [],
        mcpServers: {},
        rules: [],
        commands: [],
      },
    ];

    const result = mergeAdapterConfigs(configs);
    expect(result.commands).toEqual([]);
  });

  it("handles config without commands property (uses ?? [] fallback)", () => {
    // When one config omits the commands key entirely, the ?? [] guard fires.
    // Cast to bypass TypeScript to simulate an adapter that doesn't populate commands.
    const configWithCommands: PlatformConfig = makeConfig({
      adapterId: "claude-code",
      commands: [{ name: "review", path: "commands/review", content: "Review code" }],
    });
    const configWithoutCommands: PlatformConfig = {
      ...makeConfig({ adapterId: "cursor" }),
      commands: undefined as unknown as [],
    };

    const result = mergeAdapterConfigs([configWithCommands, configWithoutCommands]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.name).toBe("review");
  });
});
