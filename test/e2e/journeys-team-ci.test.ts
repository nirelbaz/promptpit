import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { checkCommand } from "../../src/commands/check.js";
import { hasMarkers, replaceMarkerContent } from "../../src/shared/markers.js";
import path from "node:path";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: Team Lead & CI journeys", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `pit-team-ci-${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  // ── Journey 5: collect after config change updates the bundle ──

  it("Journey 5: re-collect after config change updates the bundle", async () => {
    // Step 1: Create a project with CLAUDE.md containing "Original instructions"
    const sourceDir = await makeTmpDir("j5-source-");
    await writeFile(
      path.join(sourceDir, "CLAUDE.md"),
      "Original instructions",
    );
    await writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ name: "j5-project", version: "1.0.0" }),
    );

    // Step 2: Collect
    const collectDir = await makeTmpDir("j5-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(sourceDir, bundleDir);

    // Step 3: Verify agent.promptpit.md contains "Original instructions"
    const agentMd1 = await readFile(
      path.join(bundleDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd1).toContain("Original instructions");

    // Step 4: Modify CLAUDE.md
    await writeFile(
      path.join(sourceDir, "CLAUDE.md"),
      "Updated instructions",
    );

    // Step 5: Re-collect into the same bundle dir
    await collectStack(sourceDir, bundleDir);

    // Step 6: Verify agent.promptpit.md now contains "Updated instructions"
    const agentMd2 = await readFile(
      path.join(bundleDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd2).toContain("Updated instructions");
    expect(agentMd2).not.toContain("Original instructions");
  });

  // ── Journey 6/14: check fails when stack was updated but not re-installed ──

  it("Journey 6/14: check fails when stack version bumped but not re-installed", async () => {
    // Step 1: Collect from fixture and install into a target
    const collectDir = await makeTmpDir("j6-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("j6-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 2: Copy the bundle's stack.json into the target's .promptpit/
    // (simulates the team lead distributing an updated stack with the project)
    const targetPromptpit = path.join(targetDir, ".promptpit");
    await mkdir(targetPromptpit, { recursive: true });
    await cp(path.join(bundleDir, "stack.json"), path.join(targetPromptpit, "stack.json"));

    // Verify check passes before the version bump
    const resultBefore = await checkCommand(targetDir, {});
    expect(resultBefore.freshness.pass).toBe(true);

    // Step 3: Simulate a stack version bump (team lead updated the stack)
    const stackJsonPath = path.join(targetPromptpit, "stack.json");
    const stackJson = JSON.parse(await readFile(stackJsonPath, "utf-8"));
    stackJson.version = "99.0.0";
    await writeFile(stackJsonPath, JSON.stringify(stackJson));

    // Step 4: Run checkCommand — should fail on freshness
    const result = await checkCommand(targetDir, {});

    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(
      result.freshness.issues.some((i) => i.message.includes("version")),
    ).toBe(true);
  });

  // ── Journey 15: check detects drift from manual config edit ──

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
