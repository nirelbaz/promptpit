import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { NavProvider } from "../../../src/tui/nav.js";
import { EmptyState } from "../../../src/tui/screens/empty-state.js";

async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("EmptyState", () => {
  it("names the cwd + scope and shows CLI next steps + a widen-scope option", async () => {
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
    // CLI guidance replaces the disabled "Create / Scan / Install" menu.
    // Until the wizards ship, the user gets concrete commands to run.
    expect(frame).toContain("pit init");
    expect(frame).toContain("pit install");
    expect(frame).toContain("pit collect");
    expect(frame).toContain("Widen scope");
    expect(frame).toContain("Quit");
  });
});
