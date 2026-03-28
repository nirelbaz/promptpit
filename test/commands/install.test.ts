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

  it("appends missing .env keys without substring false positives", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    // Pre-populate .env with a key whose name is a superstring of a required key
    await writeFile(
      path.join(target, ".env"),
      "DATABASE_URL_BACKUP=old-value\n",
    );

    await installStack(VALID_STACK, target, {});

    const envFile = await readFile(path.join(target, ".env"), "utf-8");
    // DATABASE_URL should still be added even though DATABASE_URL_BACKUP exists
    expect(envFile).toContain("DATABASE_URL_BACKUP=old-value");
    expect(envFile).toMatch(/^DATABASE_URL=/m);
  });

  it("installs from .promptpit/ in target dir when source is default", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Copy valid stack into target/.promptpit/
    const { cp } = await import("node:fs/promises");
    await cp(VALID_STACK, path.join(target, ".promptpit"), { recursive: true });

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:test-stack");
  });

  it("shows helpful error when no .promptpit/ found", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);

    await expect(
      installStack(".promptpit", target, {}),
    ).rejects.toThrow("No .promptpit/ found");
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
