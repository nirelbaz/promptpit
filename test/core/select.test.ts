import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StackBundle } from "../../src/shared/schema.js";

/**
 * Exercise pickExclusions by mocking chooseMany. Verifies:
 *   - one prompt per non-empty category
 *   - excluded key format is "type:name"
 *   - preselected state is the INCLUDED subset (invert of excluded)
 *   - deselected items become excluded
 *   - empty categories are skipped
 */

let chooseManyImpl: (message: string, options: unknown, initial?: unknown) => Promise<unknown[]>;
const calls: Array<{ message: string; options: unknown; initial?: unknown }> = [];

vi.mock("../../src/shared/interactive.js", () => ({
  chooseMany: (message: string, options: unknown, initial?: unknown) => {
    calls.push({ message, options, initial });
    return chooseManyImpl(message, options, initial);
  },
}));

const { pickExclusions } = await import("../../src/core/select.js");

function makeBundle(): StackBundle {
  return {
    manifest: {
      name: "t",
      version: "1.0.0",
      skills: ["s1", "s2"],
      agents: ["a1"],
      rules: ["r1"],
      commands: ["c1"],
    },
    agentInstructions: "",
    skills: [
      { name: "s1", path: "skills/s1", content: "", frontmatter: { name: "s1", description: "d" } },
      { name: "s2", path: "skills/s2", content: "", frontmatter: { name: "s2", description: "d" } },
    ],
    agents: [
      { name: "a1", path: "agents/a1.md", content: "", frontmatter: { name: "a1", description: "d" } },
    ],
    rules: [
      { name: "r1", path: "rules/r1.md", content: "", frontmatter: { name: "r1", description: "d" } },
    ],
    commands: [{ name: "c1", path: "commands/c1.md", content: "" }],
    mcpServers: { m1: { command: "node" } },
    envExample: { E1: "env description" },
  };
}

beforeEach(() => {
  calls.length = 0;
  // Default: keep everything (picker returns the initially-selected list)
  chooseManyImpl = async (_m, _o, initial) => (initial as unknown[]) ?? [];
});

describe("pickExclusions", () => {
  it("returns empty excluded when the user keeps everything", async () => {
    const out = await pickExclusions(makeBundle());
    expect(out).toEqual([]);
  });

  it("builds 'type:name' keys for deselected items across all 6 categories", async () => {
    // Deselect one item per category.
    chooseManyImpl = async (_m, _opts, _initial) => {
      // Return a subset that excludes the first item.
      const init = (_initial as unknown[]) ?? [];
      return init.slice(1);
    };
    const out = await pickExclusions(makeBundle());
    expect(out).toEqual([
      "agent:a1",
      "command:c1",
      "env:E1",
      "mcp:m1",
      "rule:r1",
      "skill:s1",
    ]);
  });

  it("preselects items NOT in initiallyExcluded", async () => {
    let capturedInitial: unknown;
    chooseManyImpl = async (message, _o, initial) => {
      if (message.startsWith("Skills")) capturedInitial = initial;
      return initial as unknown[];
    };
    await pickExclusions(makeBundle(), ["skill:s1"]);
    // s1 is excluded → only s2 is preselected
    expect(capturedInitial).toEqual(["s2"]);
  });

  it("prompts once per non-empty category", async () => {
    await pickExclusions(makeBundle());
    const messages = calls.map((c) => c.message);
    expect(messages).toEqual([
      "Skills to include",
      "Agents to include",
      "Rules to include",
      "Commands to include",
      "MCP servers to include",
      "Env vars to include",
    ]);
  });

  it("skips empty categories (no prompt)", async () => {
    const bundle = makeBundle();
    bundle.agents = [];
    bundle.manifest.agents = [];
    bundle.commands = [];
    bundle.manifest.commands = [];
    bundle.envExample = {};
    await pickExclusions(bundle);
    const messages = calls.map((c) => c.message);
    expect(messages).toEqual([
      "Skills to include",
      "Rules to include",
      "MCP servers to include",
    ]);
  });

  it("merges fresh deselections with items already in initiallyExcluded", async () => {
    // Deselect nothing new — but pass in prior exclusions.
    const out = await pickExclusions(makeBundle(), ["mcp:m1"]);
    // Prior exclusion is preserved (picker returns initial, so nothing newly deselected).
    expect(out).toContain("mcp:m1");
  });

  it("returns sorted excluded keys for deterministic manifest output", async () => {
    chooseManyImpl = async (_m, _o, initial) => (initial as unknown[]).slice(1);
    const out = await pickExclusions(makeBundle());
    const sorted = [...out].sort();
    expect(out).toEqual(sorted);
  });
});
