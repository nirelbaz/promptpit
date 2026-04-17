import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  resolveGraph,
  mergeGraph,
  applyOverrides,
  normalizeOverrideSource,
} from "../../src/core/resolve.js";

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
