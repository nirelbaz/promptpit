import { describe, it, expect } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { checkCommand } from "../../src/commands/check.js";
import { hasMarkers, replaceMarkerContent } from "../../src/shared/markers.js";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { useTmpDirs } from "./helpers.js";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: Team Lead & CI journeys", () => {
  const { makeTmpDir } = useTmpDirs("pit-team-ci-");

  it("Journey 15: check detects drift after manual CLAUDE.md edit", async () => {
    // Step 1: Collect and install into a fresh target
    const collectDir = await makeTmpDir("j15-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("j15-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 2: Verify check passes right after install
    const resultBefore = await checkCommand(targetDir, {});
    expect(resultBefore.drift.pass).toBe(true);

    // Step 3: Modify the content WITHIN the promptpit markers (simulating manual edit)
    // Drift is only detected when the hashed marker content changes
    const claudeMdPath = path.join(targetDir, "CLAUDE.md");
    const original = await readFile(claudeMdPath, "utf-8");

    // Extract the stack name from the installed manifest to find the right markers
    const stackName = "test-project";
    expect(hasMarkers(original, stackName)).toBe(true);

    // Replace the marker content with modified text
    const modified = replaceMarkerContent(
      original,
      "TAMPERED INSTRUCTIONS — this was manually edited",
      stackName,
      "0.1.0",
      "claude-code",
    );
    await writeFile(claudeMdPath, modified);

    // Step 4: Run checkCommand again — should fail with drift detected
    const resultAfter = await checkCommand(targetDir, {});

    expect(resultAfter.pass).toBe(false);
    expect(resultAfter.drift.pass).toBe(false);
    expect(resultAfter.drift.issues.length).toBeGreaterThan(0);
    expect(
      resultAfter.drift.issues.some((i) => i.artifact === "instructions"),
    ).toBe(true);
  });
});
