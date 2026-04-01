import { describe, it, expect } from "vitest";
import { mergeConfigs } from "../../src/core/merger.js";
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
    const result = mergeConfigs([
      makeConfig("claude-code", "Use TypeScript."),
      makeConfig("standards", "Use Python."),
    ]);
    expect(result.agentInstructions).toContain("Use TypeScript.");
    expect(result.agentInstructions).toContain("Use Python.");
  });

  it("deduplicates identical instructions", () => {
    const shared = "# Instructions\n\nUse strict mode.";
    const result = mergeConfigs([
      makeConfig("claude-code", shared),
      makeConfig("standards", shared),
    ]);
    const matches = result.agentInstructions.match(/Use strict mode\./g) || [];
    expect(matches.length).toBe(1);
  });

  it("treats whitespace-only differences as identical", () => {
    const result = mergeConfigs([
      makeConfig("claude-code", "hello   world"),
      makeConfig("agents-md", "hello\n\nworld"),
    ]);
    const matches = result.agentInstructions.match(/hello/g) || [];
    expect(matches.length).toBe(1);
  });

  it("keeps unique instructions from three adapters", () => {
    const shared = "Same content";
    const result = mergeConfigs([
      makeConfig("claude-code", shared),
      makeConfig("standards", shared),
      makeConfig("cursor", "Different content"),
    ]);
    const sameMatches = result.agentInstructions.match(/Same content/g) || [];
    expect(sameMatches.length).toBe(1);
    expect(result.agentInstructions).toContain("Different content");
  });
});
