import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeFileEnsureDir } from "../../src/shared/utils.js";

const EXTENDS_FIXTURES = path.resolve("test/__fixtures__/extends");

describe("installStack with extends", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("resolves extends from local stack.json (no-args mode)", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Copy team-stack into .promptpit/ and base-stack as sibling
    await cp(path.join(EXTENDS_FIXTURES, "team-stack"), path.join(target, ".promptpit"), { recursive: true });
    await cp(path.join(EXTENDS_FIXTURES, "base-stack"), path.join(target, "base-stack"), { recursive: true });

    // Fix extends path relative to .promptpit/
    const stackJson = JSON.parse(await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"));
    stackJson.extends = ["../base-stack"];
    await writeFile(path.join(target, ".promptpit", "stack.json"), JSON.stringify(stackJson, null, 2));

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    // Extended stack's instructions appear in the marker
    expect(claudeMd).toContain("OWASP");
    // Root stack's instructions are NOT in the marker (they're the target file's own content)
    // skipRootInstructions prevents recursive content duplication (BUG 28)
    expect(claudeMd).not.toContain("React 19");
  });

  it("no-args install without extends works unchanged (regression)", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const validStack = path.resolve("test/__fixtures__/stacks/valid-stack");
    await cp(validStack, path.join(target, ".promptpit"), { recursive: true });

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:test-stack");
  });

  it("--save appends source to extends", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await writeFileEnsureDir(
      path.join(target, ".promptpit", "stack.json"),
      JSON.stringify({ name: "my-project", version: "1.0.0" }, null, 2),
    );

    await installStack(path.join(EXTENDS_FIXTURES, "base-stack"), target, { save: true });

    const updated = JSON.parse(await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"));
    expect(updated.extends).toBeDefined();
    expect(updated.extends).toContain(path.join(EXTENDS_FIXTURES, "base-stack"));
  });

  it("--save skips duplicate entries", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const src = path.join(EXTENDS_FIXTURES, "base-stack");
    await writeFileEnsureDir(
      path.join(target, ".promptpit", "stack.json"),
      JSON.stringify({ name: "my-project", version: "1.0.0", extends: [src] }, null, 2),
    );

    await installStack(src, target, { save: true });

    const updated = JSON.parse(await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"));
    expect(updated.extends.filter((e: string) => e === src)).toHaveLength(1);
  });

  it("--save without stack.json errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await expect(
      installStack(path.join(EXTENDS_FIXTURES, "base-stack"), target, { save: true }),
    ).rejects.toThrow(/No stack.json found/);
  });

  it("--save without explicit source errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ext-"));
    tmpDirs.push(target);

    await expect(
      installStack(".promptpit", target, { save: true }),
    ).rejects.toThrow(/Cannot use --save/);
  });
});
