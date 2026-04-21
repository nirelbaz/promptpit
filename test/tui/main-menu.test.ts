import { describe, it, expect, vi } from "vitest";
import { mainMenu } from "../../src/tui/main-menu.js";
import { ScriptedPrompter } from "../../src/shared/interactive.js";
import type { ScannedStack, PitConfig } from "../../src/shared/schema.js";

const sampleStacks: ScannedStack[] = [
  {
    root: "/u/p/a",
    kind: "managed",
    name: "a",
    manifestCorrupt: false,
    promptpit: { stackVersion: "1.0.0", hasInstalledJson: true },
    adapters: [],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "synced",
  },
];

const emptyConfig = {} as unknown as PitConfig;

describe("mainMenu", () => {
  it("returns false on quit", async () => {
    const prompter = ScriptedPrompter.from([{ type: "select", answer: "__quit__" }]);
    const cont = await mainMenu({ cwd: "/u/p/a", stacks: sampleStacks, config: emptyConfig, prompter });
    expect(cont).toBe(false);
  });

  it("routes into stackMenu when a stack row is selected", async () => {
    const stackMenuFn = vi.fn<(args: { stack: ScannedStack; cwd: string; config: PitConfig }) => Promise<void>>().mockResolvedValue(undefined);
    const prompter = ScriptedPrompter.from([{ type: "select", answer: "/u/p/a" }]);
    const cont = await mainMenu({
      cwd: "/u/p/a",
      stacks: sampleStacks,
      config: emptyConfig,
      prompter,
      openStackMenu: stackMenuFn,
    });
    expect(stackMenuFn).toHaveBeenCalledOnce();
    expect(stackMenuFn.mock.calls[0]![0].stack.root).toBe("/u/p/a");
    expect(cont).toBe(true);
  });

  it("re-enters after scope widen (triggers rescan in the caller's loop)", async () => {
    const prompter = ScriptedPrompter.from([
      { type: "select", answer: "__scope__" },
      { type: "select", answer: "current" },
    ]);
    const cont = await mainMenu({ cwd: "/u/p/a", stacks: sampleStacks, config: emptyConfig, prompter });
    expect(cont).toBe(true);
  });

  it("re-enters on rescan", async () => {
    const prompter = ScriptedPrompter.from([{ type: "select", answer: "__rescan__" }]);
    const cont = await mainMenu({ cwd: "/u/p/a", stacks: sampleStacks, config: emptyConfig, prompter });
    expect(cont).toBe(true);
  });

  it("re-enters when the selected row id doesn't match any stack (defensive)", async () => {
    const prompter = ScriptedPrompter.from([{ type: "select", answer: "/u/p/does-not-exist" }]);
    const cont = await mainMenu({ cwd: "/u/p/a", stacks: sampleStacks, config: emptyConfig, prompter });
    expect(cont).toBe(true);
  });
});
