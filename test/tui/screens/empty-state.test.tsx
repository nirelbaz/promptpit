import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { NavProvider } from "../../../src/tui/nav.js";
import { EmptyState } from "../../../src/tui/screens/empty-state.js";

async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("EmptyState", () => {
  it("names the cwd + scope and offers five next-step options", async () => {
    const { lastFrame } = render(
      <NavProvider
        initial={() => <EmptyState cwd="~/work/new-project" scopeLabel="current tree (depth 5) + global" />}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No AI config found");
    expect(frame).toContain("~/work/new-project");
    expect(frame).toContain("current tree (depth 5) + global");
    expect(frame).toContain("Create a new stack here");
    expect(frame).toContain("Scan a different path");
    expect(frame).toContain("Scan everywhere");
    expect(frame).toContain("Install a stack from GitHub");
    expect(frame).toContain("Quit");
  });
});
