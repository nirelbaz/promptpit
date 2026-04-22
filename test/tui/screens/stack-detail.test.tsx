import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { NavProvider } from "../../../src/tui/nav.js";
import { StackDetail } from "../../../src/tui/screens/stack-detail.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

function managed(): ScannedStack {
  return {
    root: "/u/p/a",
    kind: "managed",
    name: "app-frontend",
    manifestCorrupt: false,
    promptpit: { stackVersion: "0.4.2", hasInstalledJson: true, source: "github:acme/stack@v0.4.2" },
    adapters: [
      { id: "claude-code", artifacts: { skills: 3, agents: 1, rules: 0, commands: 2, mcp: 0, instructions: true }, drift: "synced" },
    ],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "synced",
  };
}

function unmanaged(): ScannedStack {
  return {
    ...managed(),
    kind: "unmanaged",
    promptpit: undefined,
    name: "app-backend",
  };
}

function global(): ScannedStack {
  return {
    ...managed(),
    kind: "global",
    name: "user-level",
    promptpit: undefined,
  };
}

/** Ink's render resolves children across React passive effects — the very
 *  first frame is blank until microtasks flush. Wait a tick before
 *  asserting. Two ticks for safety since our primitives read state inside
 *  useInput registration. */
async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("StackDetail", () => {
  it("renders the managed menu with install/update/validate in the right order", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <StackDetail stack={managed()} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("app-frontend");
    expect(frame).toContain("managed · v0.4.2");
    expect(frame).toContain("Install from");
    expect(frame).toContain("Update");
    expect(frame).toContain("Validate");
    expect(frame.indexOf("Install from")).toBeLessThan(frame.indexOf("Install to"));
    expect(frame.indexOf("Install to")).toBeLessThan(frame.indexOf("Update"));
  });

  it("renders the unmanaged menu without install-to / update / artifacts", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <StackDetail stack={unmanaged()} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Install from");
    expect(frame).toContain("Collect");
    expect(frame).toContain("Copy to");
    expect(frame).not.toContain("Install to");
    expect(frame).not.toContain("Update\n");
    expect(frame).not.toContain("Artifacts");
  });

  it("renders the global menu: install-from / artifacts / open / back only", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <StackDetail stack={global()} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Install from");
    expect(frame).toContain("Artifacts");
    expect(frame).toContain("Open");
    expect(frame).toContain("Back");
    expect(frame).not.toContain("Uninstall");
    expect(frame).not.toContain("Delete bundle");
  });

  it("shows the source chip for managed stacks", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <StackDetail stack={managed()} />} />,
    );
    await tick();
    expect(lastFrame()).toContain("github:acme/stack@v0.4.2");
  });
});
