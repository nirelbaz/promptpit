import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveGraph, mergeGraph } from "../../src/core/resolve.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("mergeGraph", () => {
  it("passes through single-node graph unchanged", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "base-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.manifest.name).toBe("base-stack");
    expect(merged.conflicts).toHaveLength(0);
  });

  it("merges skills from base and team (union)", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const skillNames = merged.bundle.skills.map((s) => s.name);
    expect(skillNames).toContain("lint");
    expect(skillNames).toContain("component-gen");
  });

  it("last-declared-wins for conflicting rules", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const secRule = merged.bundle.rules.find((r) => r.name === "security");
    expect(secRule).toBeDefined();
    expect(secRule!.content).toContain("Use environment variables");
    const conflict = merged.conflicts.find(
      (c) => c.type === "rule" && c.name === "security",
    );
    expect(conflict).toBeDefined();
    expect(conflict!.winner).toContain("team-stack");
  });

  it("concatenates instructions in order", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const instructions = merged.bundle.agentInstructions;
    expect(instructions.indexOf("OWASP")).toBeLessThan(
      instructions.indexOf("React 19"),
    );
    expect(instructions).toContain("## From");
  });

  it("override strategy drops extends instructions", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph, { instructionStrategy: "override" });
    expect(merged.bundle.agentInstructions).toContain("React 19");
    expect(merged.bundle.agentInstructions).not.toContain("OWASP");
  });

  it("merges MCP servers from base and team", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.mcpServers).toHaveProperty("github-mcp");
    expect(merged.bundle.mcpServers).toHaveProperty("figma-mcp");
  });

  it("merges env vars from base", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.envExample).toHaveProperty("GITHUB_TOKEN");
  });

  it("tracks provenance in sources map", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.sources.get("lint")).toContain("base-stack");
    expect(merged.sources.get("component-gen")).toContain("team-stack");
  });

  it("deep chain merges in correct order", async () => {
    const graph = await resolveGraph(
      path.join(FIXTURES, "deep-chain", "level-2"),
    );
    const merged = mergeGraph(graph);
    const skillNames = merged.bundle.skills.map((s) => s.name);
    expect(skillNames).toContain("base-skill");
    expect(skillNames).toContain("mid-skill");
    expect(skillNames).toContain("top-skill");
    const instr = merged.bundle.agentInstructions;
    expect(instr.indexOf("Level 0")).toBeLessThan(instr.indexOf("Level 1"));
    expect(instr.indexOf("Level 1")).toBeLessThan(instr.indexOf("Level 2"));
  });

  it("uses root manifest as base for merged result", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.manifest.name).toBe("team-stack");
    expect(merged.bundle.manifest.description).toBe("Frontend team stack");
  });

  it("merged manifest skills array includes all merged skills", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.manifest.skills).toContain("lint");
    expect(merged.bundle.manifest.skills).toContain("component-gen");
  });

  it("tracks MCP provenance with mcp: prefix", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.sources.get("mcp:github-mcp")).toContain("base-stack");
    expect(merged.sources.get("mcp:figma-mcp")).toContain("team-stack");
  });

  it("tracks env provenance with env: prefix", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.sources.get("env:GITHUB_TOKEN")).toContain("base-stack");
  });

  it("instruction headers use basename not full path", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    expect(merged.bundle.agentInstructions).toContain("## From base-stack");
    expect(merged.bundle.agentInstructions).toContain("## From team-stack");
    // Should not contain full absolute paths
    expect(merged.bundle.agentInstructions).not.toContain("__fixtures__");
  });

  it("single-node returns bundle directly without wrapping instructions", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "base-stack"));
    const merged = mergeGraph(graph);
    // Single-node should return instructions as-is (no ## From header)
    expect(merged.bundle.agentInstructions).not.toContain("## From");
    expect(merged.bundle.agentInstructions).toContain("OWASP");
  });

  it("deep chain instruction headers use basenames", async () => {
    const graph = await resolveGraph(
      path.join(FIXTURES, "deep-chain", "level-2"),
    );
    const merged = mergeGraph(graph);
    expect(merged.bundle.agentInstructions).toContain("## From level-0");
    expect(merged.bundle.agentInstructions).toContain("## From level-1");
    expect(merged.bundle.agentInstructions).toContain("## From level-2");
  });

  it("conflict entry records correct from and winner", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const ruleConflict = merged.conflicts.find(
      (c) => c.type === "rule" && c.name === "security",
    );
    expect(ruleConflict).toBeDefined();
    // "from" should be the base-stack source (the one being overridden)
    expect(ruleConflict!.from).toContain("base-stack");
    // "winner" should be team-stack (the one that wins)
    expect(ruleConflict!.winner).toContain("team-stack");
  });
});
