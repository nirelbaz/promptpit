import { describe, it, expect } from "vitest";
import { applyExcluded } from "../../src/core/merger.js";
import type { StackBundle } from "../../src/shared/schema.js";

function makeBundle(): StackBundle {
  return {
    manifest: {
      name: "test",
      version: "1.0.0",
      skills: ["a", "b"],
      agents: ["x"],
      rules: ["r1"],
      commands: ["c1"],
    },
    agentInstructions: "instructions",
    skills: [
      { name: "a", path: "skills/a", content: "a", frontmatter: { name: "a", description: "a" } },
      { name: "b", path: "skills/b", content: "b", frontmatter: { name: "b", description: "b" } },
    ],
    agents: [
      { name: "x", path: "agents/x.md", content: "x", frontmatter: { name: "x", description: "x" } },
    ],
    rules: [
      { name: "r1", path: "rules/r1.md", content: "r1", frontmatter: { name: "r1", description: "r1" } },
    ],
    commands: [
      { name: "c1", path: "commands/c1.md", content: "c1" },
    ],
    mcpServers: {
      "srv1": { command: "node", args: [] },
      "srv2": { command: "node", args: [] },
    },
    envExample: {
      TOKEN: "an api token",
      OTHER: "other",
    },
  };
}

describe("applyExcluded", () => {
  it("returns the bundle unchanged when excluded is empty or undefined", () => {
    const bundle = makeBundle();
    expect(applyExcluded(bundle, undefined)).toBe(bundle);
    expect(applyExcluded(bundle, [])).toBe(bundle);
  });

  it("excludes a skill", () => {
    const bundle = makeBundle();
    const out = applyExcluded(bundle, ["skill:a"]);
    expect(out.skills.map((s) => s.name)).toEqual(["b"]);
    expect(out.manifest.skills).toEqual(["b"]);
  });

  it("excludes an agent", () => {
    const out = applyExcluded(makeBundle(), ["agent:x"]);
    expect(out.agents).toHaveLength(0);
    expect(out.manifest.agents).toEqual([]);
  });

  it("excludes a rule", () => {
    const out = applyExcluded(makeBundle(), ["rule:r1"]);
    expect(out.rules).toHaveLength(0);
    expect(out.manifest.rules).toEqual([]);
  });

  it("excludes a command", () => {
    const out = applyExcluded(makeBundle(), ["command:c1"]);
    expect(out.commands).toHaveLength(0);
    expect(out.manifest.commands).toEqual([]);
  });

  it("excludes an MCP server", () => {
    const out = applyExcluded(makeBundle(), ["mcp:srv1"]);
    expect(Object.keys(out.mcpServers)).toEqual(["srv2"]);
  });

  it("excludes an env var", () => {
    const out = applyExcluded(makeBundle(), ["env:TOKEN"]);
    expect(Object.keys(out.envExample)).toEqual(["OTHER"]);
  });

  it("excludes multiple types at once", () => {
    const out = applyExcluded(makeBundle(), [
      "skill:a",
      "agent:x",
      "mcp:srv2",
      "env:OTHER",
    ]);
    expect(out.skills.map((s) => s.name)).toEqual(["b"]);
    expect(out.agents).toHaveLength(0);
    expect(Object.keys(out.mcpServers)).toEqual(["srv1"]);
    expect(Object.keys(out.envExample)).toEqual(["TOKEN"]);
  });

  it("ignores unknown excluded keys", () => {
    const out = applyExcluded(makeBundle(), ["skill:nonexistent", "mcp:nope"]);
    expect(out.skills).toHaveLength(2);
    expect(Object.keys(out.mcpServers)).toEqual(["srv1", "srv2"]);
  });

  it("does not mutate the input bundle", () => {
    const bundle = makeBundle();
    const out = applyExcluded(bundle, ["skill:a"]);
    expect(bundle.skills).toHaveLength(2);
    expect(out).not.toBe(bundle);
  });
});
