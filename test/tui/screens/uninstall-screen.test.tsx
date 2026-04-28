import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { NavProvider } from "../../../src/tui/nav.js";
import { UninstallScreen } from "../../../src/tui/screens/uninstall-screen.js";
import { installStack } from "../../../src/commands/install.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

function managedStack(root: string, name = "test-stack"): ScannedStack {
  return {
    root,
    kind: "managed",
    name,
    manifestCorrupt: false,
    promptpit: { stackVersion: "1.0.0", hasInstalledJson: true },
    adapters: [],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "synced",
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

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

describe("UninstallScreen", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "pit-uninstall-screen-"));
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, projectRoot, {});
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("renders the intro with stack name and target path", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Uninstall");
    expect(frame).toContain("Remove the installed artifacts");
    expect(frame).toContain("test-stack");
    expect(frame).toContain("Continue");
  });

  it("advances intro → configuring and shows force + dry-run toggles", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Force");
    expect(frame).toContain("Dry run");
    expect(frame).toContain("[ ]");
    expect(frame).toContain("Uninstall");
  });

  it("toggles dry-run with space", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write(" ");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[x]");
    expect(frame).toContain("Preview");
  });

  it("toggles force with f and primary action becomes 'Force uninstall'", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("f");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Force uninstall");
  });

  it("dry-run renders 'Would uninstall' and writes nothing", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write(" "); // toggle dry-run on
    await tick();
    stdin.write("\r"); // run preview
    const frame = await waitForFrame(lastFrame, (f) => f.includes("Would uninstall"));
    expect(frame).toContain("Planned files");
    expect(frame).toContain("Uninstall for real");
    // Manifest should still be intact
    expect(existsSync(path.join(projectRoot, ".promptpit", "installed.json"))).toBe(true);
  });

  it("real uninstall removes installed.json and renders the done card", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → configuring
    await tick();
    stdin.write("\r"); // run uninstall (force=false, dryRun=false)
    const frame = await waitForFrame(
      lastFrame,
      (f) => f.includes("Uninstalled") && !f.includes("Would uninstall"),
    );
    expect(frame).toContain("test-stack@1.0.0");
    // Last stack — installed.json removed
    expect(existsSync(path.join(projectRoot, ".promptpit", "installed.json"))).toBe(false);
  });

  it("force without dry-run routes through typed-name confirm", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → configuring
    await tick();
    stdin.write("f"); // toggle force
    await tick();
    stdin.write("\r"); // continue → confirming
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Force uninstall");
    expect(frame).toContain("type the stack name");
    expect(frame).toContain('type "test-stack" to confirm');
  });

  it("typed-name confirm fires the run when name matches", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("f"); // force
    await tick();
    stdin.write("\r"); // continue → confirming
    await tick();
    stdin.write("test-stack");
    await tick();
    stdin.write("\r"); // confirm
    await waitForFrame(lastFrame, (f) => f.includes("Uninstalled"));
    expect(existsSync(path.join(projectRoot, ".promptpit", "installed.json"))).toBe(false);
  });

  it("'Uninstall for real' after a dry-run skips configuring", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <UninstallScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write(" "); // dry-run on
    await tick();
    stdin.write("\r"); // run preview
    await waitForFrame(lastFrame, (f) => f.includes("Would uninstall"));
    await tick(); // let DoneBody mount its useInput
    stdin.write("\r"); // primary "Uninstall for real"
    const frame = await waitForFrame(
      lastFrame,
      (f) => f.includes("Uninstalled") && !f.includes("Would uninstall"),
    );
    expect(frame).toContain("test-stack");
    expect(existsSync(path.join(projectRoot, ".promptpit", "installed.json"))).toBe(false);
  });

  it("renders an error card when the stack is not installed", async () => {
    // Fresh project with no install — uninstallStack throws "No stacks are installed"
    const emptyRoot = await mkdtemp(path.join(tmpdir(), "pit-uninstall-empty-"));
    try {
      const { lastFrame, stdin } = render(
        <NavProvider initial={() => <UninstallScreen stack={managedStack(emptyRoot, "ghost")} />} />,
      );
      await tick();
      stdin.write("\r"); // intro
      await tick();
      stdin.write("\r"); // run
      const frame = await waitForFrame(lastFrame, (f) => f.includes("Uninstall failed"));
      expect(frame).toContain("Retry");
      expect(frame).toContain("Back");
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
