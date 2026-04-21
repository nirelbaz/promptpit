import { describe, it, expect } from "vitest";
import { ScriptedPrompter } from "../../src/shared/interactive.js";

describe("ScriptedPrompter", () => {
  it("returns queued answers in order and records the trace", async () => {
    const p = ScriptedPrompter.from([
      { type: "select", answer: "install" },
      { type: "text", answer: "/tmp/x" },
      { type: "confirm", answer: true },
    ]);
    expect(
      await p.select({
        message: "pick",
        options: [{ value: "install", label: "install" }],
      }),
    ).toBe("install");
    expect(await p.text({ message: "path" })).toBe("/tmp/x");
    expect(await p.confirm({ message: "apply?" })).toBe(true);
    expect(p.trace().length).toBe(3);
  });

  it("throws if script is exhausted", async () => {
    const p = ScriptedPrompter.from([]);
    await expect(
      p.select({ message: "x", options: [] }),
    ).rejects.toThrow(/exhausted/);
  });

  it("throws if the prompt type doesn't match", async () => {
    const p = ScriptedPrompter.from([{ type: "confirm", answer: true }]);
    await expect(
      p.select({ message: "x", options: [] }),
    ).rejects.toThrow(/expected select/);
  });
});
