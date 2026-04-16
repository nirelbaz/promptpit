import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import { updateStacks } from "../../src/commands/update.js";
import { readManifest } from "../../src/core/manifest.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { exists } from "../../src/shared/utils.js";

const V1_STACK = path.resolve("test/__fixtures__/stacks/update-v1");
const V2_STACK = path.resolve("test/__fixtures__/stacks/update-v2");

describe("updateStacks", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("updates a local stack with new/modified/removed artifacts", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    // Install v1
    await installStack(V1_STACK, target, {});

    // Verify v1 installed
    let manifest = await readManifest(target);
    expect(manifest.installs[0]!.stackVersion).toBe("1.0.0");

    // Update from v2 source
    const result = await updateStacks(target, { localSource: V2_STACK });

    expect(result.updated).toBe(true);
    expect(result.stacks[0]!.added.length).toBeGreaterThan(0);
    expect(result.stacks[0]!.modified.length).toBeGreaterThan(0);
    expect(result.stacks[0]!.removed.length).toBeGreaterThan(0);

    // Verify manifest updated to v2
    manifest = await readManifest(target);
    expect(manifest.installs[0]!.stackVersion).toBe("1.1.0");

    // Verify new skill was written
    const reviewerSkill = await readFile(
      path.join(target, ".agents", "skills", "reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(reviewerSkill).toContain("Review code changes");
  });

  it("skips drifted artifacts by default", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Drift the naming rule
    const rulePath = path.join(target, ".claude", "rules", "naming.md");
    const originalRule = await readFile(rulePath, "utf-8");
    await writeFile(rulePath, originalRule + "\nMy custom addition.\n");

    // Update from v2
    const result = await updateStacks(target, { localSource: V2_STACK });

    // The drifted rule should be skipped
    expect(result.stacks[0]!.skipped.length).toBeGreaterThan(0);
    expect(result.stacks[0]!.skipped.some((s) => s.name === "naming")).toBe(true);

    // Verify the rule still has user's modification
    const currentRule = await readFile(rulePath, "utf-8");
    expect(currentRule).toContain("My custom addition");
  });

  it("overwrites drifted artifacts with --force", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Drift a rule
    const rulePath = path.join(target, ".claude", "rules", "naming.md");
    const originalRule = await readFile(rulePath, "utf-8");
    await writeFile(rulePath, originalRule + "\nMy custom addition.\n");

    // Update with --force
    const result = await updateStacks(target, { localSource: V2_STACK, force: true });
    expect(result.stacks[0]!.skipped.length).toBe(0);

    // Verify the rule has v2 content
    const currentRule = await readFile(rulePath, "utf-8");
    expect(currentRule).toContain("SCREAMING_SNAKE");
    expect(currentRule).not.toContain("My custom addition");
  });

  it("reports already up to date when nothing changed", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Update from same v1 source
    const result = await updateStacks(target, { localSource: V1_STACK });

    expect(result.updated).toBe(false);
    expect(result.stacks[0]!.added.length).toBe(0);
    expect(result.stacks[0]!.modified.length).toBe(0);
    expect(result.stacks[0]!.removed.length).toBe(0);
  });

  it("throws when no stacks are installed", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);

    await expect(updateStacks(target)).rejects.toThrow("No stacks installed");
  });

  it("removes deleted artifacts from disk", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Verify helper agent exists after v1 install
    const agentPath = path.join(target, ".claude", "agents", "helper.md");
    expect(await exists(agentPath)).toBe(true);

    // Update from v2 (which removes helper agent)
    await updateStacks(target, { localSource: V2_STACK });

    // Verify agent was removed
    expect(await exists(agentPath)).toBe(false);
  });

  it("filters by stack name", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Update non-existent stack should throw
    await expect(
      updateStacks(target, { stackName: "nonexistent" }),
    ).rejects.toThrow("not installed");
  });
});
