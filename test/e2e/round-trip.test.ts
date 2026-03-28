import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: collect -> install round-trip", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("collects from a project and installs into a fresh project", async () => {
    // Step 1: Collect
    const collectDir = await mkdtemp(path.join(tmpdir(), "pit-e2e-collect-"));
    tmpDirs.push(collectDir);
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const manifest = JSON.parse(
      await readFile(path.join(bundleDir, "stack.json"), "utf-8"),
    );
    expect(manifest.name).toBe("test-project");

    // Step 2: Install into a fresh project
    const targetDir = await mkdtemp(path.join(tmpdir(), "pit-e2e-target-"));
    tmpDirs.push(targetDir);
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");

    await installStack(bundleDir, targetDir, {});

    const claudeMd = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain("# Existing");
    expect(claudeMd).toContain("promptpit:start:test-project");

    const skill = await readFile(
      path.join(targetDir, ".claude", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toContain("browse");

    const envFile = await readFile(path.join(targetDir, ".env"), "utf-8");
    expect(envFile).toContain("DATABASE_URL");
  });
});
