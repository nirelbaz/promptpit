import { describe, it, expect } from "vitest";
import { mergeAdapterConfigs } from "../../src/core/merger.js";
import type { PlatformConfig } from "../../src/adapters/types.js";

function makeConfig(id: string, instructions: string): PlatformConfig {
  return {
    adapterId: id,
    agentInstructions: instructions,
    skills: [],
    mcpServers: {},
    rules: [],
  };
}

describe("merger instruction hash dedup", () => {
  it("keeps both when instructions differ", () => {
    const result = mergeAdapterConfigs([
      makeConfig("claude-code", "Use TypeScript."),
      makeConfig("standards", "Use Python."),
    ]);
    expect(result.agentInstructions).toContain("Use TypeScript.");
    expect(result.agentInstructions).toContain("Use Python.");
  });

  it("deduplicates identical instructions", () => {
    const shared = "# Instructions\n\nUse strict mode.";
    const result = mergeAdapterConfigs([
      makeConfig("claude-code", shared),
      makeConfig("standards", shared),
    ]);
    const matches = result.agentInstructions.match(/Use strict mode\./g) || [];
    expect(matches.length).toBe(1);
  });

  it("treats whitespace-only differences as identical", () => {
    const result = mergeAdapterConfigs([
      makeConfig("claude-code", "hello   world"),
      makeConfig("agents-md", "hello\n\nworld"),
    ]);
    const matches = result.agentInstructions.match(/hello/g) || [];
    expect(matches.length).toBe(1);
  });

  it("keeps unique instructions from three adapters", () => {
    const shared = "Same content";
    const result = mergeAdapterConfigs([
      makeConfig("claude-code", shared),
      makeConfig("standards", shared),
      makeConfig("cursor", "Different content"),
    ]);
    const sameMatches = result.agentInstructions.match(/Same content/g) || [];
    expect(sameMatches.length).toBe(1);
    expect(result.agentInstructions).toContain("Different content");
  });
});

describe("merger MCP version pin preference", () => {
  it("prefers version-pinned MCP server over unpinned duplicate", () => {
    const unpinned: PlatformConfig = {
      adapterId: "codex",
      agentInstructions: "",
      skills: [],
      agents: [],
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
      rules: [],
    };
    const pinned: PlatformConfig = {
      adapterId: "standards",
      agentInstructions: "",
      skills: [],
      agents: [],
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"] },
      },
      rules: [],
    };
    // Unpinned first, pinned second — should prefer pinned
    const result = mergeAdapterConfigs([unpinned, pinned]);
    const args = (result.mcpServers.github as Record<string, unknown>).args as string[];
    expect(args[1]).toContain("@2025.4.8");
    expect(result.warnings[0]).toContain("version-pinned");
  });

  it("keeps first when both are pinned", () => {
    const pinned1: PlatformConfig = {
      adapterId: "claude-code",
      agentInstructions: "",
      skills: [],
      agents: [],
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@1.0.0"] },
      },
      rules: [],
    };
    const pinned2: PlatformConfig = {
      adapterId: "standards",
      agentInstructions: "",
      skills: [],
      agents: [],
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2.0.0"] },
      },
      rules: [],
    };
    const result = mergeAdapterConfigs([pinned1, pinned2]);
    const args = (result.mcpServers.github as Record<string, unknown>).args as string[];
    expect(args[1]).toContain("@1.0.0");
    expect(result.warnings[0]).toContain("keeping first");
  });
});
