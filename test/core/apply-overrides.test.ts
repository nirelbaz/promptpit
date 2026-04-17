import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  resolveGraph,
  mergeGraph,
  applyOverrides,
  normalizeOverrideSource,
  type ConflictEntry,
  type MergedStack,
  type ResolvedGraph,
} from "../../src/core/resolve.js";
import type { StackBundle } from "../../src/shared/schema.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("normalizeOverrideSource", () => {
  it("strips @version from github sources", () => {
    expect(normalizeOverrideSource("github:foo/bar@1.0.0")).toBe("github:foo/bar");
    expect(normalizeOverrideSource("github:foo/bar@v2")).toBe("github:foo/bar");
  });

  it("returns github sources without @ unchanged", () => {
    expect(normalizeOverrideSource("github:foo/bar")).toBe("github:foo/bar");
  });

  it("returns local paths unchanged", () => {
    expect(normalizeOverrideSource("/abs/path")).toBe("/abs/path");
    expect(normalizeOverrideSource("./relative")).toBe("./relative");
  });
});

describe("applyOverrides", () => {
  it("passes through when no overrides are provided", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const applied = applyOverrides(merged, graph, undefined);
    expect(applied.unresolved.length).toBe(merged.conflicts.length);
    expect(applied.applied.length).toBe(0);
    expect(applied.warnings.length).toBe(0);
  });

  it("passes through on empty overrides object", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const applied = applyOverrides(merged, graph, {});
    expect(applied.unresolved.length).toBe(merged.conflicts.length);
  });

  it("is a no-op when override picks the current winner", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const conflict = merged.conflicts[0]!;
    const applied = applyOverrides(merged, graph, {
      [`${conflict.type}:${conflict.name}`]: conflict.winner,
    });
    // Winner is already in the bundle — no change needed; conflict resolved.
    expect(applied.applied.length).toBe(1);
    expect(applied.unresolved.length).toBe(merged.conflicts.length - 1);
  });

  it("swaps the winner back to the loser when override picks loser", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const conflict = merged.conflicts.find((c) => c.type === "rule" && c.name === "security")!;
    expect(conflict).toBeDefined();
    const applied = applyOverrides(merged, graph, {
      "rule:security": conflict.from,
    });
    expect(applied.applied).toContainEqual(conflict);
    const secRule = applied.bundle.rules.find((r) => r.name === "security")!;
    // The winner's content had "Use environment variables"; the loser (base)
    // has a different content. After swap, the rule should NOT contain the
    // winner's unique content marker.
    expect(secRule.content).not.toContain("Use environment variables");
    expect(applied.sources.get("security")).toBe(conflict.from);
  });

  it("warns and ignores dangling overrides", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    const merged = mergeGraph(graph);
    const conflict = merged.conflicts[0]!;
    const applied = applyOverrides(merged, graph, {
      [`${conflict.type}:${conflict.name}`]: "github:nonexistent/source",
    });
    expect(applied.warnings.some((w) => w.includes("not in the extends graph"))).toBe(true);
    // Conflict remains unresolved because override couldn't be honored.
    expect(applied.unresolved.some((c) => c.type === conflict.type && c.name === conflict.name)).toBe(true);
  });
});

/**
 * Direct unit tests for each swap branch. Builds a minimal two-node graph
 * with hand-crafted conflicts so we can hit skill/agent/command/mcp/env
 * swaps without shipping fixture directories for each type.
 */
describe("applyOverrides — swap coverage per artifact type", () => {
  function buildGraph(
    baseBundle: StackBundle,
    teamBundle: StackBundle,
  ): ResolvedGraph {
    return {
      nodes: [
        { source: "base", stackDir: "/tmp/base", bundle: baseBundle, depth: 1 },
        { source: "team", stackDir: "/tmp/team", bundle: teamBundle, depth: 0 },
      ],
      warnings: [],
    };
  }

  function emptyBundle(overrides: Partial<StackBundle> = {}): StackBundle {
    return {
      manifest: { name: "x", version: "1.0.0" },
      agentInstructions: "",
      skills: [],
      agents: [],
      rules: [],
      commands: [],
      mcpServers: {},
      envExample: {},
      ...overrides,
    };
  }

  function makeMerged(
    bundle: StackBundle,
    conflict: ConflictEntry,
  ): MergedStack {
    return {
      bundle,
      conflicts: [conflict],
      sources: new Map([[conflict.name, conflict.winner]]),
    };
  }

  it("swaps a skill from winner to loser", () => {
    const baseSkill = {
      name: "deploy",
      path: "skills/deploy",
      content: "BASE",
      frontmatter: { name: "deploy", description: "d" },
    };
    const teamSkill = { ...baseSkill, content: "TEAM" };
    const graph = buildGraph(
      emptyBundle({ skills: [baseSkill] }),
      emptyBundle({ skills: [teamSkill] }),
    );
    const merged = makeMerged(
      emptyBundle({ skills: [teamSkill] }),
      { type: "skill", name: "deploy", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "skill:deploy": "base" });
    expect(applied.applied).toHaveLength(1);
    expect(applied.bundle.skills[0]!.content).toBe("BASE");
  });

  it("swaps an agent", () => {
    const baseAgent = {
      name: "reviewer",
      path: "agents/reviewer.md",
      content: "BASE",
      frontmatter: { name: "reviewer", description: "d" },
    };
    const teamAgent = { ...baseAgent, content: "TEAM" };
    const graph = buildGraph(
      emptyBundle({ agents: [baseAgent] }),
      emptyBundle({ agents: [teamAgent] }),
    );
    const merged = makeMerged(
      emptyBundle({ agents: [teamAgent] }),
      { type: "agent", name: "reviewer", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "agent:reviewer": "base" });
    expect(applied.bundle.agents[0]!.content).toBe("BASE");
  });

  it("swaps a command", () => {
    const baseCmd = { name: "deploy", path: "commands/deploy.md", content: "BASE" };
    const teamCmd = { ...baseCmd, content: "TEAM" };
    const graph = buildGraph(
      emptyBundle({ commands: [baseCmd] }),
      emptyBundle({ commands: [teamCmd] }),
    );
    const merged = makeMerged(
      emptyBundle({ commands: [teamCmd] }),
      { type: "command", name: "deploy", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "command:deploy": "base" });
    expect(applied.bundle.commands[0]!.content).toBe("BASE");
  });

  it("swaps an MCP server", () => {
    const graph = buildGraph(
      emptyBundle({ mcpServers: { fs: { command: "base-node" } } }),
      emptyBundle({ mcpServers: { fs: { command: "team-node" } } }),
    );
    const merged = makeMerged(
      emptyBundle({ mcpServers: { fs: { command: "team-node" } } }),
      { type: "mcp", name: "fs", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "mcp:fs": "base" });
    expect(applied.bundle.mcpServers["fs"]).toEqual({ command: "base-node" });
  });

  it("swaps an env var", () => {
    const graph = buildGraph(
      emptyBundle({ envExample: { TOKEN: "base hint" } }),
      emptyBundle({ envExample: { TOKEN: "team hint" } }),
    );
    const merged = makeMerged(
      emptyBundle({ envExample: { TOKEN: "team hint" } }),
      { type: "env", name: "TOKEN", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "env:TOKEN": "base" });
    expect(applied.bundle.envExample["TOKEN"]).toBe("base hint");
  });

  it("returns swap=failed when the picked source lacks the artifact", () => {
    // base source doesn't actually have the skill; override should warn.
    const teamSkill = {
      name: "x",
      path: "skills/x",
      content: "T",
      frontmatter: { name: "x", description: "d" },
    };
    const graph = buildGraph(
      emptyBundle(), // base has no skills
      emptyBundle({ skills: [teamSkill] }),
    );
    const merged = makeMerged(
      emptyBundle({ skills: [teamSkill] }),
      { type: "skill", name: "x", from: "base", winner: "team" },
    );
    const applied = applyOverrides(merged, graph, { "skill:x": "base" });
    expect(applied.warnings.some((w) => w.includes("could not locate"))).toBe(true);
    // Unresolved because swap failed.
    expect(applied.unresolved).toHaveLength(1);
  });

  it("applies a normalized-source match with a warning when @version differs", () => {
    const baseSkill = {
      name: "x",
      path: "skills/x",
      content: "B",
      frontmatter: { name: "x", description: "d" },
    };
    const teamSkill = { ...baseSkill, content: "T" };
    const graph: ResolvedGraph = {
      nodes: [
        {
          source: "github:acme/base@1.0.0",
          stackDir: "/tmp/base",
          bundle: emptyBundle({ skills: [baseSkill] }),
          depth: 1,
        },
        {
          source: "team",
          stackDir: "/tmp/team",
          bundle: emptyBundle({ skills: [teamSkill] }),
          depth: 0,
        },
      ],
      warnings: [],
    };
    const merged = makeMerged(
      emptyBundle({ skills: [teamSkill] }),
      {
        type: "skill",
        name: "x",
        from: "github:acme/base@1.0.0",
        winner: "team",
      },
    );
    // User wrote the override with a DIFFERENT version than what's in the graph.
    const applied = applyOverrides(merged, graph, {
      "skill:x": "github:acme/base@2.0.0",
    });
    expect(
      applied.warnings.some((w) => w.includes("normalized match")),
    ).toBe(true);
    expect(applied.bundle.skills[0]!.content).toBe("B");
  });
});
