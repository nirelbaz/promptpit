import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { vi } from "vitest";

describe("E2E: Skill Author journeys", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `pit-skill-${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  it("Journey 19: skill in .agents/skills/ is collected and distributable", async () => {
    // Step 1: Set up a project with CLAUDE.md and a custom skill
    const sourceDir = await makeTmpDir("j19-source-");
    await writeFile(path.join(sourceDir, "CLAUDE.md"), "# My project\n");

    const skillDir = path.join(sourceDir, ".claude", "skills", "my-linter");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-linter",
        "description: Custom linting rules",
        "---",
        "",
        "Always run eslint before committing.",
        "",
      ].join("\n"),
    );

    // Step 2: Collect — verify skill appears in bundle
    const bundleDir = path.join(sourceDir, ".promptpit");
    await collectStack(sourceDir, bundleDir);

    const collectedSkill = await readFile(
      path.join(bundleDir, "skills", "my-linter", "SKILL.md"),
      "utf-8",
    );
    expect(collectedSkill).toContain("name: my-linter");
    expect(collectedSkill).toContain("Custom linting rules");
    expect(collectedSkill).toContain("Always run eslint before committing.");

    // Step 3: Install into a fresh project with only CLAUDE.md
    const targetDir = await makeTmpDir("j19-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Target project\n");
    await installStack(bundleDir, targetDir, {});

    // Step 4: Verify skill lands in .agents/skills/my-linter/SKILL.md in the target
    const installedSkill = await readFile(
      path.join(targetDir, ".agents", "skills", "my-linter", "SKILL.md"),
      "utf-8",
    );
    expect(installedSkill).toContain("name: my-linter");
    expect(installedSkill).toContain("Custom linting rules");
    expect(installedSkill).toContain("Always run eslint before committing.");
  });
});
