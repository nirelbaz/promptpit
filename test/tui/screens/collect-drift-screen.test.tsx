import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { NavProvider } from "../../../src/tui/nav.js";
import { CollectDriftScreen } from "../../../src/tui/screens/collect-drift-screen.js";
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
    overallDrift: "drifted",
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

describe("CollectDriftScreen", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "pit-collect-drift-screen-"));
    await cp(VALID_STACK, path.join(projectRoot, ".promptpit"), { recursive: true });
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, projectRoot, {});
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("renders the intro and explains scoping", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Collect drift");
    expect(frame).toContain("Pull local edits");
    expect(frame).toContain("Scan for drift");
  });

  it("shows the no-drift card when nothing has drifted", async () => {
    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → scanning
    const frame = await waitForFrame(lastFrame, (f) => f.includes("No drift detected"));
    expect(frame).toContain("bundle is up to date");
  });

  it("lists drifted artifacts and lets the user toggle the dry-run flag", async () => {
    const canonicalSkill = path.join(projectRoot, ".agents", "skills", "browse", "SKILL.md");
    const before = await readFile(canonicalSkill, "utf-8");
    await writeFile(canonicalSkill, before + "\n\nLocal edit.\n");

    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → scanning → configuring
    const frame = await waitForFrame(lastFrame, (f) => f.includes("Drift detected"));
    expect(frame).toContain("skill:");
    expect(frame).toContain("browse");
    expect(frame).toContain("[x]"); // default: all selected
    await tick(); // let ConfiguringBody's useInput register

    stdin.write("d"); // toggle dry-run
    await tick();
    await tick();
    expect(lastFrame()).toMatch(/\[x\]\s+Dry run/);
  });

  it("dry-run renders 'Would accept' and writes nothing", async () => {
    const canonicalSkill = path.join(projectRoot, ".agents", "skills", "browse", "SKILL.md");
    const bundleSkill = path.join(projectRoot, ".promptpit", "skills", "browse", "SKILL.md");
    const bundleBefore = await readFile(bundleSkill, "utf-8");
    await writeFile(canonicalSkill, "modified\n");

    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → scanning
    await waitForFrame(lastFrame, (f) => f.includes("Drift detected"));
    await tick(); // let ConfiguringBody's useInput register
    stdin.write("d"); // dry-run on
    await tick();
    await tick();
    // Confirm the toggle landed before pressing Enter — otherwise useInput's
    // closure can fire against a stale render and run a real collect.
    expect(lastFrame()).toMatch(/\[x\]\s+Dry run/);
    stdin.write("\r"); // accept
    await waitForFrame(lastFrame, (f) => f.includes("Would accept"));
    expect(lastFrame()).toContain("Planned bundle changes");
    expect(lastFrame()).toContain("Accept for real");
    expect(await readFile(bundleSkill, "utf-8")).toBe(bundleBefore);
  });

  it("real run pulls drift into the bundle", async () => {
    const canonicalSkill = path.join(projectRoot, ".agents", "skills", "browse", "SKILL.md");
    const bundleSkill = path.join(projectRoot, ".promptpit", "skills", "browse", "SKILL.md");
    const updated = "modified canonical content\n";
    await writeFile(canonicalSkill, updated);

    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → scanning
    await waitForFrame(lastFrame, (f) => f.includes("Drift detected"));
    await tick(); // let ConfiguringBody's useInput register
    stdin.write("\r"); // accept (dry-run off by default)
    await waitForFrame(lastFrame, (f) => f.includes("Accepted"));
    expect(await readFile(bundleSkill, "utf-8")).toBe(updated);
  });

  it("'Accept for real' after dry-run skips the configuring screen", async () => {
    const canonicalSkill = path.join(projectRoot, ".agents", "skills", "browse", "SKILL.md");
    const bundleSkill = path.join(projectRoot, ".promptpit", "skills", "browse", "SKILL.md");
    const updated = "post-dry-run content\n";
    await writeFile(canonicalSkill, updated);

    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro
    await waitForFrame(lastFrame, (f) => f.includes("Drift detected"));
    await tick(); // let ConfiguringBody's useInput register
    stdin.write("d"); // dry-run on
    await tick();
    await tick();
    stdin.write("\r"); // accept (dry-run)
    await waitForFrame(lastFrame, (f) => f.includes("Would accept"));
    await tick();
    stdin.write("\r"); // primary "Accept for real"
    await waitForFrame(lastFrame, (f) => f.includes("Accepted") && !f.includes("Would accept"));
    expect(await readFile(bundleSkill, "utf-8")).toBe(updated);
  });

  it("space deselects an item; Enter does nothing when nothing is selected", async () => {
    const canonicalSkill = path.join(projectRoot, ".agents", "skills", "browse", "SKILL.md");
    await writeFile(canonicalSkill, "modified\n");

    const { lastFrame, stdin } = render(
      <NavProvider initial={() => <CollectDriftScreen stack={managedStack(projectRoot)} />} />,
    );
    await tick();
    stdin.write("\r"); // intro → scanning
    await waitForFrame(lastFrame, (f) => f.includes("Drift detected"));
    await tick(); // let ConfiguringBody's useInput register
    // Toggle-all to clear, then Enter — should stay on configuring.
    stdin.write("a");
    await tick();
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Drift detected");
  });
});
