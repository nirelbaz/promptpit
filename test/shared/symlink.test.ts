import { describe, it, expect, afterEach } from "vitest";
import { symlinkOrCopy, removeFileOrSymlink } from "../../src/shared/utils.js";
import path from "node:path";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  lstat,
  readlink,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";

describe("removeFileOrSymlink", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("removes a regular file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-rm-"));
    tmpDirs.push(root);
    const file = path.join(root, "test.txt");
    await writeFile(file, "content");

    await removeFileOrSymlink(file);

    await expect(lstat(file)).rejects.toThrow();
  });

  it("removes a symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-rm-"));
    tmpDirs.push(root);
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    await writeFile(target, "content");
    await symlink(target, link);

    await removeFileOrSymlink(link);

    await expect(lstat(link)).rejects.toThrow();
    // Target should still exist
    const content = await readFile(target, "utf-8");
    expect(content).toBe("content");
  });

  it("removes a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-rm-"));
    tmpDirs.push(root);
    const dir = path.join(root, "subdir");
    await mkdir(dir);
    await writeFile(path.join(dir, "file.txt"), "content");

    await removeFileOrSymlink(dir);

    await expect(lstat(dir)).rejects.toThrow();
  });

  it("does nothing for non-existent path", async () => {
    await removeFileOrSymlink("/tmp/does-not-exist-pit-test");
    // No error thrown
  });
});

describe("symlinkOrCopy", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("creates a relative symlink on POSIX", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-sym-"));
    tmpDirs.push(root);

    const src = path.join(root, "canonical", "SKILL.md");
    const dest = path.join(root, "linked", "SKILL.md");
    await mkdir(path.dirname(src), { recursive: true });
    await writeFile(src, "skill content");

    await symlinkOrCopy(src, dest);

    // Dest should be a symlink
    const stat = await lstat(dest);
    expect(stat.isSymbolicLink()).toBe(true);

    // Symlink should be relative
    const linkTarget = await readlink(dest);
    expect(path.isAbsolute(linkTarget)).toBe(false);

    // Content should be readable through the symlink
    const content = await readFile(dest, "utf-8");
    expect(content).toBe("skill content");
  });

  it("removes existing regular file before creating symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-sym-"));
    tmpDirs.push(root);

    const src = path.join(root, "canonical", "SKILL.md");
    const dest = path.join(root, "linked", "SKILL.md");
    await mkdir(path.dirname(src), { recursive: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(src, "new content");
    await writeFile(dest, "old content");

    await symlinkOrCopy(src, dest);

    const stat = await lstat(dest);
    expect(stat.isSymbolicLink()).toBe(true);
    const content = await readFile(dest, "utf-8");
    expect(content).toBe("new content");
  });

  it("removes existing symlink before creating new one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-sym-"));
    tmpDirs.push(root);

    const src1 = path.join(root, "old", "SKILL.md");
    const src2 = path.join(root, "new", "SKILL.md");
    const dest = path.join(root, "linked", "SKILL.md");
    await mkdir(path.dirname(src1), { recursive: true });
    await mkdir(path.dirname(src2), { recursive: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(src1, "old");
    await writeFile(src2, "new");
    await symlink(src1, dest);

    await symlinkOrCopy(src2, dest);

    const content = await readFile(dest, "utf-8");
    expect(content).toBe("new");
  });

  it("creates parent directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-sym-"));
    tmpDirs.push(root);

    const src = path.join(root, "canonical", "SKILL.md");
    const dest = path.join(root, "deep", "nested", "path", "SKILL.md");
    await mkdir(path.dirname(src), { recursive: true });
    await writeFile(src, "content");

    await symlinkOrCopy(src, dest);

    const content = await readFile(dest, "utf-8");
    expect(content).toBe("content");
  });
});
