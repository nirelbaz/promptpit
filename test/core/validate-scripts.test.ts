import { describe, it, expect, afterEach } from "vitest";
import { validateStack } from "../../src/core/validate.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("validate scripts", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("passes validation with valid scripts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    tmpDirs.push(dir);
    await writeFile(
      path.join(dir, "stack.json"),
      JSON.stringify({
        name: "test",
        version: "1.0.0",
        scripts: { postinstall: "./setup.sh" },
      }),
    );

    const result = await validateStack(dir);
    const scriptErrors = result.diagnostics.filter(
      (d) => d.level === "error" && d.file === "stack.json" && d.message.includes("scripts"),
    );
    expect(scriptErrors).toHaveLength(0);
  });

  it("errors on empty script string", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    tmpDirs.push(dir);
    await writeFile(
      path.join(dir, "stack.json"),
      '{"name":"test","version":"1.0.0","scripts":{"postinstall":""}}',
    );

    const result = await validateStack(dir);
    expect(result.valid).toBe(false);
  });
});
