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

  it("updates by stack name when multiple stacks installed", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    // Install the update-test stack
    await installStack(V1_STACK, target, {});

    // Update only the specific stack by name
    const result = await updateStacks(target, {
      stackName: "update-test",
      localSource: V2_STACK,
    });

    expect(result.stacks.length).toBe(1);
    expect(result.stacks[0]!.stack).toBe("update-test");
    expect(result.updated).toBe(true);
  });

  it("--check mode reports changes without applying them", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Run update in check mode
    const result = await updateStacks(target, {
      localSource: V2_STACK,
      check: true,
    });

    // Should report changes
    expect(result.stacks[0]!.added.length).toBeGreaterThan(0);
    expect(result.stacks[0]!.modified.length).toBeGreaterThan(0);
    expect(result.stacks[0]!.removed.length).toBeGreaterThan(0);

    // But should NOT have applied them
    const manifest = await readManifest(target);
    expect(manifest.installs[0]!.stackVersion).toBe("1.0.0"); // Still v1
    expect(result.updated).toBe(false);
  });

  it("--dry-run mode reports changes without writing", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    const result = await updateStacks(target, {
      localSource: V2_STACK,
      dryRun: true,
    });

    // Should report the delta
    expect(result.stacks[0]!.added.length).toBeGreaterThan(0);

    // But should NOT have applied
    const manifest = await readManifest(target);
    expect(manifest.installs[0]!.stackVersion).toBe("1.0.0"); // Still v1
  });

  it("--json mode suppresses log output", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Should not throw with json mode
    const result = await updateStacks(target, {
      localSource: V1_STACK,
      json: true,
    });
    expect(result.updated).toBe(false);
  });

  it("skips drifted instructions as atomic unit", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Drift the CLAUDE.md instructions (add text inside the marker block)
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    const driftedContent = claudeMd.replace(
      "Use TypeScript strict mode.",
      "Use TypeScript strict mode. MY CUSTOM RULE.",
    );
    await writeFile(path.join(target, "CLAUDE.md"), driftedContent);

    // Update from v2 (which modifies instructions)
    const result = await updateStacks(target, { localSource: V2_STACK });

    // Instructions should be skipped
    const instrSkipped = result.stacks[0]!.skipped.some(
      (s) => s.type === "instructions",
    );
    expect(instrSkipped).toBe(true);

    // Verify custom content preserved
    const currentClaudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(currentClaudeMd).toContain("MY CUSTOM RULE");
  });

  it("preserves skipped artifact manifest entries after update", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Drift the naming rule
    const rulePath = path.join(target, ".claude", "rules", "naming.md");
    const originalRule = await readFile(rulePath, "utf-8");
    await writeFile(rulePath, originalRule + "\nMy custom addition.\n");

    // Update from v2
    await updateStacks(target, { localSource: V2_STACK });

    // Verify the skipped rule is still tracked in the manifest
    const manifest = await readManifest(target);
    const entry = manifest.installs[0]!;
    const ccRecord = entry.adapters["claude-code"];
    expect(ccRecord?.rules?.["naming"]).toBeDefined();
    expect(ccRecord?.rules?.["naming"]?.hash).toBeDefined();
  });

  it("updates modified instructions when not drifted", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Update from v2 without drifting anything
    const result = await updateStacks(target, { localSource: V2_STACK });

    // Instructions should be modified (not skipped)
    const instrSkipped = result.stacks[0]!.skipped.some(
      (s) => s.type === "instructions",
    );
    expect(instrSkipped).toBe(false);

    // Verify v2 instructions are installed
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Always write tests");
  });

  it("handles missing local source gracefully", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    // Update with a source that doesn't exist
    const result = await updateStacks(target, {
      localSource: "/tmp/nonexistent-source",
    });

    // Should skip gracefully (no crash)
    expect(result.updated).toBe(false);
  });

  it("reports correct delta categories", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});
    const result = await updateStacks(target, { localSource: V2_STACK });

    const delta = result.stacks[0]!;

    // v2 adds reviewer skill
    expect(delta.added.some((a) => a.type === "skill" && a.name === "reviewer")).toBe(true);

    // v2 modifies naming rule
    expect(delta.modified.some((a) => a.type === "rule" && a.name === "naming")).toBe(true);

    // v2 removes helper agent
    expect(delta.removed.some((a) => a.type === "agent" && a.name === "helper")).toBe(true);

    // v2 keeps linter skill unchanged
    expect(delta.unchanged).toBeGreaterThan(0);
  });

  it("--check with --json returns structured data", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    const result = await updateStacks(target, {
      localSource: V2_STACK,
      check: true,
      json: true,
    });

    // Structured result should have version info
    expect(result.stacks[0]!.oldVersion).toBe("1.0.0");
    expect(result.stacks[0]!.newVersion).toBe("1.1.0");
    expect(result.stacks[0]!.stack).toBe("update-test");
  });

  it("check mode reports up-to-date when nothing changed", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-update-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(V1_STACK, target, {});

    const result = await updateStacks(target, {
      localSource: V1_STACK,
      check: true,
    });

    expect(result.stacks[0]!.added.length).toBe(0);
    expect(result.stacks[0]!.modified.length).toBe(0);
    expect(result.stacks[0]!.removed.length).toBe(0);
  });
});
