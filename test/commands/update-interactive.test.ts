import { describe, it, expect, afterEach } from "vitest";
import { updateStacks } from "../../src/commands/update.js";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import process from "node:process";
import { mkdtemp, rm, writeFile, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const STACK_FIXTURE = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("update --interactive", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupInstalled(): Promise<string> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-uia-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    await cp(STACK_FIXTURE, path.join(target, ".promptpit"), { recursive: true });
    await installStack(".promptpit", target, {});
    return target;
  }

  it("is a no-op on an up-to-date stack even with --interactive", async () => {
    // No drift, no upstream changes → update short-circuits before any
    // prompting, so --interactive in non-TTY should not throw.
    const target = await setupInstalled();
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
    try {
      const result = await updateStacks(target, { interactive: true });
      expect(result.updated).toBe(false);
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("preserves overrides and excluded on update", async () => {
    const target = await setupInstalled();
    const manifestPath = path.join(target, ".promptpit", "installed.json");

    const m1 = JSON.parse(await readFile(manifestPath, "utf-8"));
    m1.installs[0].overrides = { "skill:deploy-skill": "github:foo/bar" };
    m1.installs[0].excluded = ["mcp:some-server"];
    await writeFile(manifestPath, JSON.stringify(m1, null, 2));

    // Local update (no upstream) should no-op on content but preserve the fields.
    await updateStacks(target, {});

    const m2 = JSON.parse(await readFile(manifestPath, "utf-8"));
    const entry = m2.installs[0];
    expect(entry.overrides).toEqual({ "skill:deploy-skill": "github:foo/bar" });
    expect(entry.excluded).toEqual(["mcp:some-server"]);
  });
});
