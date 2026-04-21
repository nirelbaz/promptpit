import { describe, it, expect, vi } from "vitest";
import { stackMenu, type StackMenuActions, type ActionContext } from "../../src/tui/stack-menu.js";
import { ScriptedPrompter } from "../../src/shared/interactive.js";
import type { ScannedStack, PitConfig } from "../../src/shared/schema.js";

function managed(): ScannedStack {
  return {
    root: "/u/p/a",
    kind: "managed",
    name: "a",
    manifestCorrupt: false,
    promptpit: { stackVersion: "1.0.0", hasInstalledJson: true },
    adapters: [],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "synced",
  };
}

function unmanaged(): ScannedStack {
  return {
    root: "/u/p/b",
    kind: "unmanaged",
    name: "b",
    manifestCorrupt: false,
    adapters: [],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "unknown",
  };
}

function stubActions(overrides: Partial<StackMenuActions> = {}): StackMenuActions {
  const keys: Array<keyof StackMenuActions> = [
    "install", "installTo", "adapt", "update", "statusDiff", "collect", "collectDrift",
    "artifacts", "validate", "uninstall", "open", "deleteBundle", "deleteFiles",
    "copyTo", "resolveConflicts", "reviewOverrides", "showExtends",
  ];
  const base = Object.fromEntries(
    keys.map((k) => [k, vi.fn<(ctx: ActionContext) => Promise<void>>().mockResolvedValue(undefined)]),
  ) as unknown as StackMenuActions;
  return { ...base, ...overrides };
}

const emptyConfig = {} as unknown as PitConfig;

describe("stackMenu", () => {
  it("exits immediately on 'back'", async () => {
    const prompter = ScriptedPrompter.from([{ type: "select", answer: "back" }]);
    const actions = stubActions();
    await stackMenu({ stack: managed(), cwd: "/u/p/a", config: emptyConfig, prompter, actions });
    const trace = prompter.trace();
    expect(trace).toHaveLength(1);
    expect(trace[0]!.type).toBe("select");
  });

  it("routes 'install-from' to the install action for unmanaged stacks", async () => {
    const install = vi.fn<(ctx: ActionContext) => Promise<void>>().mockResolvedValue(undefined);
    const prompter = ScriptedPrompter.from([
      { type: "select", answer: "install-from" },
      { type: "select", answer: "back" },
    ]);
    await stackMenu({
      stack: unmanaged(),
      cwd: "/u/p/b",
      config: emptyConfig,
      prompter,
      actions: stubActions({ install }),
    });
    expect(install).toHaveBeenCalledOnce();
    expect(install.mock.calls[0]![0].stack.name).toBe("b");
  });

  it("routes 'validate' to the validate action for managed stacks", async () => {
    const validate = vi.fn<(ctx: ActionContext) => Promise<void>>().mockResolvedValue(undefined);
    const prompter = ScriptedPrompter.from([
      { type: "select", answer: "validate" },
      { type: "select", answer: "back" },
    ]);
    await stackMenu({
      stack: managed(),
      cwd: "/u/p/a",
      config: emptyConfig,
      prompter,
      actions: stubActions({ validate }),
    });
    expect(validate).toHaveBeenCalledOnce();
  });

  it("re-renders after an action (two selects across one action)", async () => {
    const open = vi.fn<(ctx: ActionContext) => Promise<void>>().mockResolvedValue(undefined);
    const prompter = ScriptedPrompter.from([
      { type: "select", answer: "open" },
      { type: "select", answer: "back" },
    ]);
    await stackMenu({
      stack: managed(),
      cwd: "/u/p/a",
      config: emptyConfig,
      prompter,
      actions: stubActions({ open }),
    });
    expect(open).toHaveBeenCalledOnce();
    expect(prompter.trace()).toHaveLength(2);
  });
});
