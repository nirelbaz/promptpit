import { describe, it, expect, afterEach } from "vitest";
import { installCanonical } from "../../src/core/skill-store.js";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
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

  it("writes supporting files alongside SKILL.md", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-canon-"));
    tmpDirs.push(root);

    const skillWithSupportingFiles: SkillEntry = {
      name: "toolbox",
      path: "skills/toolbox",
      frontmatter: { name: "toolbox", description: "toolbox skill" },
      content: "---\nname: toolbox\ndescription: toolbox skill\n---\n\n# Toolbox\n",
      supportingFiles: [
        { relativePath: "scripts/setup.sh", content: Buffer.from("#!/bin/sh\necho setup") },
        { relativePath: "references/api.md", content: Buffer.from("# API Reference\nEndpoints here.") },
      ],
    };

    await installCanonical(root, [skillWithSupportingFiles]);

    const setupContent = await readFile(
      path.join(root, ".agents", "skills", "toolbox", "scripts", "setup.sh"),
    );
    expect(setupContent.toString()).toBe("#!/bin/sh\necho setup");

    const apiContent = await readFile(
      path.join(root, ".agents", "skills", "toolbox", "references", "api.md"),
    );
    expect(apiContent.toString()).toBe("# API Reference\nEndpoints here.");

    // SKILL.md must still be present
    const skillMd = await readFile(
      path.join(root, ".agents", "skills", "toolbox", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("toolbox");
  });

  it("writes to ~/.agents/skills/ for global installs", async () => {
    // Global install writes to homedir, not root. We can't mock homedir easily
    // in ESM, so we verify the actual path uses homedir and the file is written.
    const pathMap = await installCanonical("/ignored", [makeSkill("browse")], {
      global: true,
    });

    expect(pathMap.size).toBe(1);
    const canonPath = pathMap.get("browse")!;
    // Path should be under homedir, not under /ignored
    expect(canonPath).toContain(path.join(homedir(), ".agents", "skills", "browse"));
    expect(canonPath).not.toContain("/ignored");

    const content = await readFile(canonPath, "utf-8");
    expect(content).toContain("browse");

    // Cleanup: remove the file we wrote to the real homedir
    await rm(path.join(homedir(), ".agents", "skills", "browse"), {
      recursive: true,
      force: true,
    });
  });
});
