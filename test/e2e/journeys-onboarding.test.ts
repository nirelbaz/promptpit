import { describe, it, expect } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { useTmpDirs, captureJson } from "./helpers.js";

const MULTI_TOOL_PROJECT = path.resolve("test/__fixtures__/multi-tool-project");
const CURSOR_PROJECT = path.resolve("test/__fixtures__/cursor-project");

describe("E2E: Onboarding & Migration journeys", () => {
  const { makeTmpDir } = useTmpDirs("pit-onboard-");

  // ── Journey 8: install succeeds with only one tool present ──

  it("Journey 8: install succeeds when only one tool is present (missing tools skipped)", async () => {
    // Step 1: Collect from multi-tool-project (has both Claude + Cursor configs)
    const collectDir = await makeTmpDir("j8-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(MULTI_TOOL_PROJECT, bundleDir);

    // Step 2: Install into a project with ONLY CLAUDE.md (simulates only Claude Code installed)
    const targetDir = await makeTmpDir("j8-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 3: Should not have thrown — missing Cursor silently skipped

    // Step 4: CLAUDE.md should have promptpit markers
    const claudeMd = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain("promptpit:start");
    expect(claudeMd).toContain("promptpit:end");

    // Step 5: Status (--json) should report hasManifest: true
    const result = await captureJson(() =>
      statusCommand(targetDir, { json: true }),
    );
    expect(result.hasManifest).toBe(true);
  });

  // ── Journey 17: collect from Cursor project installs into Claude Code ──

  it("Journey 17: collect from Cursor project installs into Claude Code", async () => {
    // Step 1: Collect from cursor-project fixture (Cursor-only configs)
    const collectDir = await makeTmpDir("j17-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CURSOR_PROJECT, bundleDir);

    // Step 2: Verify agent.promptpit.md was created with content
    const agentMd = await readFile(
      path.join(bundleDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd.length).toBeGreaterThan(0);

    // Step 3: Install into a project with only CLAUDE.md (Claude Code only)
    const targetDir = await makeTmpDir("j17-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 4: CLAUDE.md should have promptpit markers
    const claudeMd = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain("promptpit:start");
    expect(claudeMd).toContain("promptpit:end");

    // Step 5: Status should show synced
    const result = await captureJson(() =>
      statusCommand(targetDir, { json: true }),
    );
    expect(result.hasManifest).toBe(true);
    const stacks = result.stacks as Array<{
      overallState: string;
    }>;
    expect(stacks.length).toBeGreaterThan(0);
    expect(stacks[0]!.overallState).toBe("synced");
  });
});
