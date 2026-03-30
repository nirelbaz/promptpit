import { describe, it, expect, afterEach } from "vitest";
import { installCanonical } from "../../src/core/skill-store.js";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SkillEntry } from "../../src/shared/schema.js";

const makeSkill = (name: string, content?: string): SkillEntry => ({
  name,
  path: `skills/${name}`,
  frontmatter: { name, description: `${name} skill` },
  content: content ?? `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`,
});

describe("installCanonical", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("writes skills to .agents/skills/<name>/SKILL.md", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-canon-"));
    tmpDirs.push(root);

    const pathMap = await installCanonical(root, [makeSkill("browse")]);

    expect(pathMap.size).toBe(1);
    expect(pathMap.has("browse")).toBe(true);

    const content = await readFile(
      path.join(root, ".agents", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("browse");
  });

  it("overwrites existing skill files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-canon-"));
    tmpDirs.push(root);

    await installCanonical(root, [makeSkill("browse", "old content")]);
    await installCanonical(root, [makeSkill("browse", "new content")]);

    const content = await readFile(
      path.join(root, ".agents", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("new content");
  });

  it("handles multiple skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-canon-"));
    tmpDirs.push(root);

    const pathMap = await installCanonical(root, [
      makeSkill("browse"),
      makeSkill("review"),
    ]);

    expect(pathMap.size).toBe(2);
    expect(pathMap.has("browse")).toBe(true);
    expect(pathMap.has("review")).toBe(true);
  });
});
