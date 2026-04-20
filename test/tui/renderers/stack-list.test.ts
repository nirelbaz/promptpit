import { describe, it, expect } from "vitest";
import { renderStackList } from "../../../src/tui/renderers/stack-list.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

function managed(over: Partial<ScannedStack> = {}): ScannedStack {
  return {
    root: "/u/projects/app-frontend",
    kind: "managed",
    name: "app-frontend",
    manifestCorrupt: false,
    promptpit: { stackVersion: "0.3.1", hasInstalledJson: true },
    adapters: [
      { id: "claude-code", artifacts: { skills: 3, rules: 0, agents: 1, commands: 0, mcp: 0, instructions: true }, drift: "drifted" },
      { id: "cursor", artifacts: { skills: 0, rules: 5, agents: 0, commands: 0, mcp: 0, instructions: false }, drift: "synced" },
    ],
    unmanagedAnnotations: [],
    overallDrift: "drifted",
    ...over,
  };
}

describe("renderStackList", () => {
  it("renders managed + unmanaged + global into grouped sections", () => {
    const stacks: ScannedStack[] = [
      managed(),
      { root: "/u/projects/app-backend", kind: "unmanaged", name: "app-backend", manifestCorrupt: false,
        adapters: [{ id: "claude-code", artifacts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 1, instructions: true }, drift: "unknown" }],
        unmanagedAnnotations: [], overallDrift: "unknown" },
      { root: "~", kind: "global", name: "user-level", manifestCorrupt: false,
        adapters: [{ id: "claude-code", artifacts: { skills: 12, rules: 0, agents: 3, commands: 4, mcp: 0, instructions: false }, drift: "unknown" }],
        unmanagedAnnotations: [], overallDrift: "unknown" },
    ];
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks, scopeLabel: "current tree (depth 5) + global" });
    expect(out).toMatchSnapshot();
  });

  it("shows drifted badge for managed stacks with drift", () => {
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks: [managed()], scopeLabel: "current" });
    expect(out).toContain("drifted");
  });

  it("shows subpath annotations on managed rows", () => {
    const stack = managed({ unmanagedAnnotations: [{
      subpath: "packages/ui", adapterId: "cursor",
      counts: { skills: 0, rules: 2, agents: 0, commands: 0, mcp: 0, instructions: false },
    }] });
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks: [stack], scopeLabel: "current" });
    expect(out).toMatch(/packages\/ui/);
    expect(out).toMatch(/unmanaged/);
  });

  it("renders onboarding card when stacks is empty", () => {
    const out = renderStackList({ cwd: "/u/projects/new-repo", stacks: [], scopeLabel: "current (depth 5) + global" });
    expect(out).toMatch(/No AI config found/);
    expect(out).toMatch(/pit init/);
  });
});
