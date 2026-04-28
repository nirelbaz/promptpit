import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { installStack } from "../../src/commands/install.js";
import { deleteBundle } from "../../src/commands/delete.js";
import { exists } from "../../src/shared/utils.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("deleteBundle", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupBundle(): Promise<string> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-delete-"));
    tmpDirs.push(target);
    await cp(VALID_STACK, path.join(target, ".promptpit"), { recursive: true });
    return target;
  }

  it("removes the .promptpit/ directory when the stack name matches", async () => {
    const target = await setupBundle();
    const result = await deleteBundle("test-stack", target, {});
    expect(result.bundleRemoved).toBe(true);
    expect(await exists(path.join(target, ".promptpit"))).toBe(false);
  });

  it("dry-run leaves the bundle in place", async () => {
    const target = await setupBundle();
    const result = await deleteBundle("test-stack", target, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.bundleRemoved).toBe(false);
    expect(await exists(path.join(target, ".promptpit"))).toBe(true);
  });

  it("throws when the stack name doesn't match the bundle", async () => {
    const target = await setupBundle();
    await expect(deleteBundle("wrong-name", target, {})).rejects.toThrow(/not "wrong-name"/);
    expect(await exists(path.join(target, ".promptpit"))).toBe(true);
  });

  it("throws when there is no bundle to delete", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-delete-empty-"));
    tmpDirs.push(target);
    await expect(deleteBundle("anything", target, {})).rejects.toThrow(/No \.promptpit\/ bundle/);
  });

  it("--also-uninstall runs uninstall first, then deletes the bundle", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-delete-also-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, target, {});

    const result = await deleteBundle("test-stack", target, { alsoUninstall: true });
    expect(result.uninstall).toBeDefined();
    expect(result.uninstall!.dryRun).toBe(false);
    expect(result.bundleRemoved).toBe(true);
    expect(await exists(path.join(target, ".promptpit"))).toBe(false);
    // CLAUDE.md should have lost its marker block via uninstall
    const { readFile } = await import("node:fs/promises");
    const after = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(after).not.toContain("promptpit:start:test-stack");
  });

  it("--also-uninstall is forgiving when nothing is installed", async () => {
    const target = await setupBundle();
    // No installStack call — bundle exists, but installed.json doesn't.
    const result = await deleteBundle("test-stack", target, { alsoUninstall: true });
    expect(result.bundleRemoved).toBe(true);
    expect(await exists(path.join(target, ".promptpit"))).toBe(false);
  });
});
