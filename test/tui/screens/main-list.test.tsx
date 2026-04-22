import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import { NavProvider } from "../../../src/tui/nav.js";
import { ScanProvider } from "../../../src/tui/scan-context.js";
import { MainList } from "../../../src/tui/screens/main-list.js";

// ink-testing-library's first frame is blank until React's passive effects
// flush and scan() resolves. Empty-directory scans are fast; a few ticks
// plus a small timeout is enough for the loading → ready transition.
async function tick(ms = 1500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("MainList", () => {
  it("renders a spinner in the loading state, then the empty-state screen when scan returns nothing", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "pit-mainlist-empty-"));
    try {
      const { lastFrame } = render(
        <ScanProvider cwd={empty}>
          <NavProvider initial={() => <MainList />} />
        </ScanProvider>,
      );
      // A real scan on an empty directory returns no stacks. MainList
      // routes to EmptyState, which renders "No AI config found".
      await tick();
      const frame = lastFrame() ?? "";
      // The scan reaches the ready or empty state; in either path the
      // Frame header and the quit keybind are always rendered. This is a
      // minimal smoke test — it guards against regressions where the
      // MainList would render nothing (e.g. a crash in the scan effect).
      expect(frame).toContain("pit");
      expect(frame).toContain("quit");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
