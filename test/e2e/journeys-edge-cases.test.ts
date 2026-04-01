import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: Multi-Stack & Edge Case journeys", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `pit-edge-${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  function captureJson(fn: () => Promise<void>): Promise<Record<string, unknown>> {
    return new Promise(async (resolve, reject) => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await fn();
        const output = spy.mock.calls.map((c) => c.join(" ")).join("");
        resolve(JSON.parse(output));
      } catch (err) {
        reject(err);
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("Journey 24: re-installing one stack does not clobber another", async () => {
    // Step 1: Collect stack A from claude-project fixture
    const collectDirA = await makeTmpDir("j24-collectA-");
    const bundleDirA = path.join(collectDirA, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDirA);

    // Install stack A into target
    const targetDir = await makeTmpDir("j24-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDirA, targetDir, {});

    // Step 2: Create stack B manually
    const collectDirB = await makeTmpDir("j24-collectB-");
    const bundleDirB = path.join(collectDirB, ".promptpit");
    await mkdir(bundleDirB, { recursive: true });
    await writeFile(
      path.join(bundleDirB, "stack.json"),
      JSON.stringify({ name: "overlay-stack", version: "1.0.0" }),
    );
    await writeFile(
      path.join(bundleDirB, "agent.promptpit.md"),
      "Use TypeScript strict mode.\n",
    );

    // Step 3: Install stack B into the same target
    await installStack(bundleDirB, targetDir, {});

    // Step 4: Verify CLAUDE.md contains markers for both stacks
    const claudeMdAfterBoth = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMdAfterBoth).toContain("promptpit:start:test-project");
    expect(claudeMdAfterBoth).toContain("promptpit:start:overlay-stack");

    // Step 5: Re-install stack A
    await installStack(bundleDirA, targetDir, {});

    // Step 6: Verify both stacks still present after re-install of A
    const claudeMdAfterReinstall = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMdAfterReinstall).toContain("promptpit:start:test-project");
    expect(claudeMdAfterReinstall).toContain("promptpit:start:overlay-stack");
    expect(claudeMdAfterReinstall).toContain("Use TypeScript strict mode.");

    // Step 7: Status should show 2 stacks, both synced
    const result = await captureJson(() =>
      statusCommand(targetDir, { json: true }),
    );
    const stacks = result.stacks as Array<{
      stack: string;
      overallState: string;
    }>;
    expect(stacks).toHaveLength(2);
    const stackNames = stacks.map((s) => s.stack).sort();
    expect(stackNames).toEqual(["overlay-stack", "test-project"]);
    for (const stack of stacks) {
      expect(stack.overallState).toBe("synced");
    }
  });

  it("Journey 26: status handles corrupted installed.json gracefully", async () => {
    // Step 1: Create target dir with CLAUDE.md
    const targetDir = await makeTmpDir("j26-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");

    // Step 2: Create .promptpit/ with corrupted installed.json
    const promptpitDir = path.join(targetDir, ".promptpit");
    await mkdir(promptpitDir, { recursive: true });
    await writeFile(
      path.join(promptpitDir, "installed.json"),
      "{ this is not valid JSON",
    );

    // Step 3: statusCommand handles gracefully — returns empty stacks with hasManifest: false
    const result = await captureJson(() =>
      statusCommand(targetDir, { json: true }),
    );
    expect(result.stacks).toEqual([]);
    expect(result.hasManifest).toBe(false);
  });

  it("Journey 28: double install produces byte-identical files", async () => {
    // Step 1: Collect and install
    const collectDir = await makeTmpDir("j28-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("j28-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 2: Read content after first install
    const contentAfterFirst = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );

    // Step 3: Install again
    await installStack(bundleDir, targetDir, {});

    // Step 4: Read content after second install
    const contentAfterSecond = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );

    // Step 5: Assert byte-identical — no duplication, no marker drift
    expect(contentAfterSecond).toBe(contentAfterFirst);
  });
});
