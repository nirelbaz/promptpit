import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import path from "node:path";
import { mkdtemp, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { NavProvider } from "../../../src/tui/nav.js";
import { DeleteBundleScreen } from "../../../src/tui/screens/delete-bundle-screen.js";
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

describe("DeleteBundleScreen", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "pit-delete-screen-"));
    await cp(VALID_STACK, path.join(projectRoot, ".promptpit"), { recursive: true });
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, projectRoot, {});
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("renders the intro and warns about orphaned artifacts", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Delete bundle");
    expect(frame).toContain(".promptpit");
    expect(frame).toContain("orphans installed files");
  });

  it("offers Bundle only and Bundle + uninstall options", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → configuring
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bundle only");
    expect(frame).toContain("Bundle + uninstall");
  });

  it("routes through typed-name confirm before deleting", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("\r"); // pick "Bundle only"
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("type the stack name");
    expect(frame).toContain('type "test-stack" to confirm');
  });

  it("Bundle only deletes .promptpit/ but leaves installed artifacts intact", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("\r"); // Bundle only
    await tick();
    stdin.write("test-stack");
    await tick();
    stdin.write("\r"); // confirm
    await waitForFrame(lastFrame, (f) => f.includes("Deleted bundle"));
    expect(existsSync(path.join(projectRoot, ".promptpit"))).toBe(false);
    // Installed artifacts (CLAUDE.md marker block, .claude/skills/, etc.) are
    // orphaned — we don't assert their state here; the orphan behavior is the
    // contract.
  });

  it("Bundle + uninstall removes both bundle and installed artifacts", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("[B"); // arrow-down → "Bundle + uninstall"
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("test-stack");
    await tick();
    stdin.write("\r"); // confirm
    await waitForFrame(lastFrame, (f) => f.includes("Uninstalled and deleted bundle"));
    expect(existsSync(path.join(projectRoot, ".promptpit"))).toBe(false);
    // CLAUDE.md should have lost its marker block
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf-8");
    expect(content).not.toContain("promptpit:start:test-stack");
  });

  it("typed-name mismatch keeps the bundle in place", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <DeleteBundleScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await tick();
    stdin.write("\r"); // Bundle only
    await tick();
    stdin.write("wrong-name");
    await tick();
    // Spam Enter — should not advance
    stdin.write("\r");
    stdin.write("\r");
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("does not match");
    expect(existsSync(path.join(projectRoot, ".promptpit"))).toBe(true);
  });
});
