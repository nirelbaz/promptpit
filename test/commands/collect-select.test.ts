import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import path from "node:path";
import process from "node:process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("collect --select", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("errors in non-TTY with an actionable message", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-cs-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Project rules\n");

    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
    try {
      await expect(
        collectStack(target, path.join(target, ".promptpit"), { select: true }),
      ).rejects.toThrow(/--select requires an interactive terminal/);
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });
});
