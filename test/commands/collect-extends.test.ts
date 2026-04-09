import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeFileEnsureDir } from "../../src/shared/utils.js";

describe("collectStack with extends", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("preserves existing extends field when re-collecting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-collect-ext-"));
    tmpDirs.push(root);
    await writeFile(path.join(root, "CLAUDE.md"), "# My project\n");

    await writeFileEnsureDir(
      path.join(root, ".promptpit", "stack.json"),
      JSON.stringify({
        name: "my-project",
        version: "1.0.0",
        extends: ["github:acme/base-stack@1.0.0"],
        instructionStrategy: "override",
      }, null, 2),
    );

    await collectStack(root, path.join(root, ".promptpit"), {});

    const result = JSON.parse(
      await readFile(path.join(root, ".promptpit", "stack.json"), "utf-8"),
    );
    expect(result.extends).toEqual(["github:acme/base-stack@1.0.0"]);
    expect(result.instructionStrategy).toBe("override");
  });

  it("collects normally when no extends exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pit-collect-ext-"));
    tmpDirs.push(root);
    await writeFile(path.join(root, "CLAUDE.md"), "# My project\n");

    await collectStack(root, path.join(root, ".promptpit"), {});

    const result = JSON.parse(
      await readFile(path.join(root, ".promptpit", "stack.json"), "utf-8"),
    );
    expect(result.extends).toBeUndefined();
    expect(result.instructionStrategy).toBeUndefined();
  });
});
