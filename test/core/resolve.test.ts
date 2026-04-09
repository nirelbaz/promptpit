import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveGraph } from "../../src/core/resolve.js";

const FIXTURES = path.resolve("test/__fixtures__/extends");

describe("resolveGraph", () => {
  it("returns single-node graph for stack without extends", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "base-stack"));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("base-stack");
    expect(graph.nodes[0]!.depth).toBe(0);
  });

  it("resolves two-level extends chain", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("base-stack");
    expect(graph.nodes[0]!.depth).toBe(1);
    expect(graph.nodes[1]!.bundle.manifest.name).toBe("team-stack");
    expect(graph.nodes[1]!.depth).toBe(0);
  });

  it("resolves three-level deep chain in correct order", async () => {
    const graph = await resolveGraph(
      path.join(FIXTURES, "deep-chain", "level-2"),
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((n) => n.bundle.manifest.name)).toEqual([
      "level-0",
      "level-1",
      "level-2",
    ]);
  });

  it("detects circular dependencies", async () => {
    await expect(
      resolveGraph(path.join(FIXTURES, "circular-a")),
    ).rejects.toThrow(/Circular dependency detected/);
  });

  it("includes full chain in circular dependency error", async () => {
    try {
      await resolveGraph(path.join(FIXTURES, "circular-a"));
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain("circular-a");
      expect(msg).toContain("circular-b");
    }
  });

  it("errors when depth exceeds limit", async () => {
    await expect(
      resolveGraph(path.join(FIXTURES, "deep-chain", "level-2"), {
        maxDepth: 1,
      }),
    ).rejects.toThrow(/exceeds maximum depth/);
  });

  it("returns single-node graph when skipExtends is true", async () => {
    const graph = await resolveGraph(path.join(FIXTURES, "team-stack"), {
      skipExtends: true,
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.bundle.manifest.name).toBe("team-stack");
  });
});
