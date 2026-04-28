import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { NavProvider } from "../../../src/tui/nav.js";
import { CollectScreen } from "../../../src/tui/screens/collect-screen.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

const CLAUDE_FIXTURE = path.resolve("test/__fixtures__/claude-project");

function unmanagedStack(root: string, name = "test-project"): ScannedStack {
  return {
    root,
    kind: "unmanaged",
    name,
    manifestCorrupt: false,
    promptpit: undefined,
    adapters: [],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "unknown",
  };
}

/** Two ticks lets ink-testing-library flush passive effects + state updates. */
async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

/** Wait until a predicate holds against the latest frame, or fail. Polling
 *  fits collect's async chain (detect → read → merge → write) better than a
 *  fixed tick count, which has to grow as the pipeline does. */
async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() ?? "";
    if (predicate(frame)) return frame;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForFrame timed out. Last frame:\n${lastFrame() ?? "<empty>"}`);
}

describe("CollectScreen", () => {
  let projectRoot: string;

  beforeEach(async () => {
    // Copy the Claude fixture so each test gets an isolated tree (collect
    // writes .promptpit/ into the stack root). Using cp avoids fixture
    // mutation between runs.
    projectRoot = await mkdtemp(path.join(tmpdir(), "pit-collect-screen-"));
    await cp(CLAUDE_FIXTURE, projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("renders the intro with the bundle target path", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Collect");
    expect(frame).toContain("Bundle this project's AI config into");
    expect(frame).toContain(".promptpit");
    expect(frame).toContain("Continue");
  });

  it("advances intro → configuring on Continue and shows the dry-run toggle", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dry run");
    expect(frame).toContain("[ ]");
    expect(frame).toContain("Collect"); // primary action label when dry-run is off
  });

  it("toggles dry-run with space", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro Continue
    await tick();
    stdin.write(" ");  // toggle
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[x]");
    expect(frame).toContain("Preview"); // primary action relabels under dry-run
  });

  it("runs collect and renders the summary card with detected counts", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("\r"); // configuring → running
    const frame = await waitForFrame(lastFrame, (f) => f.includes("Collected:"));
    expect(frame).toContain("1 instruction file");
    expect(frame).toContain("1 skill"); // browse fixture
    expect(frame).toContain("1 MCP server");
    expect(frame).toContain("1 secret stripped");
    expect(frame).toContain("output:");
    expect(frame).toContain("./.promptpit");
    expect(existsSync(path.join(projectRoot, ".promptpit", "stack.json"))).toBe(true);
  });

  it("dry-run renders 'Would collect' and writes nothing", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write(" ");  // toggle dry-run on
    await tick();
    stdin.write("\r"); // run
    const frame = await waitForFrame(lastFrame, (f) => f.includes("Would collect:"));
    expect(frame).toContain("Planned files");
    expect(frame).toContain("Collect for real"); // post-dry-run primary action
    expect(existsSync(path.join(projectRoot, ".promptpit", "stack.json"))).toBe(false);
  });

  it("renders an error card when the project has no detected adapters", async () => {
    const emptyRoot = await mkdtemp(path.join(tmpdir(), "pit-collect-empty-"));
    try {
      const { lastFrame, stdin } = render(
        <NavProvider initial={() => <CollectScreen stack={unmanagedStack(emptyRoot, "empty")} />} />,
      );
      await tick();
      stdin.write("\r"); // intro
      await tick();
      stdin.write("\r"); // run
      const frame = await waitForFrame(lastFrame, (f) => f.includes("Collect failed"));
      expect(frame).toContain("Run 'pit init'"); // error message bubbled through
      expect(frame).toContain("Retry");
      expect(frame).toContain("Back");
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it("'Collect for real' after a dry-run goes straight to a real collect", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → configuring
    await tick();
    stdin.write(" ");  // toggle dry-run on
    await tick();
    stdin.write("\r"); // run dry-run
    await waitForFrame(lastFrame, (f) => f.includes("Would collect:"));
    await tick(); // let DoneBody mount its useInput before we send Enter
    // Cursor starts on the primary action ("Collect for real"); selecting it
    // must skip the configuring screen and produce a real collect — not
    // bounce back to a screen that still has [x] Dry run checked.
    stdin.write("\r");
    const frame = await waitForFrame(
      lastFrame,
      (f) => f.includes("Collected:") && !f.includes("Would collect:"),
    );
    expect(frame).toContain("1 instruction file");
    expect(existsSync(path.join(projectRoot, ".promptpit", "stack.json"))).toBe(true);
  });

  it("returns to intro from configuring when Back is selected", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectScreen stack={unmanagedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r");      // intro → configuring
    await tick();
    stdin.write("\u001B[B"); // arrow-down: move cursor to "Back"
    await tick();
    stdin.write("\r");      // select Back
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bundle this project's AI config into");
  });
});

// Suppress unused-import lint for helpers some test runs don't reach.
void writeFile;
void mkdir;
