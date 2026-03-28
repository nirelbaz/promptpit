import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("installStack", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("installs stack from local path into a Claude Code project", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing content\n");

    await installStack(VALID_STACK, target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# Existing content");
    expect(claudeMd).toContain("promptpit:start:test-stack");
    expect(claudeMd).toContain("TypeScript strict mode");

    const skill = await readFile(
      path.join(target, ".claude", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toContain("browse");
  });

  it("writes .env file with placeholders", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const envFile = await readFile(path.join(target, ".env"), "utf-8");
    expect(envFile).toContain("DATABASE_URL");
  });

  it("re-install replaces marker content", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});
    await installStack(VALID_STACK, target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    const startCount = (
      claudeMd.match(/promptpit:start:test-stack/g) || []
    ).length;
    expect(startCount).toBe(1);
  });
});
