import { describe, it, expect } from "vitest";
import { readStack, writeStack } from "../../src/core/stack.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("readStack", () => {
  it("reads a valid .promptpit/ bundle", async () => {
    const bundle = await readStack(VALID_STACK);
    expect(bundle.manifest.name).toBe("test-stack");
    expect(bundle.manifest.version).toBe("1.0.0");
    expect(bundle.skills).toHaveLength(1);
    expect(bundle.skills[0]!.name).toBe("browse");
    expect(bundle.mcpServers).toHaveProperty("postgres");
    expect(bundle.agentInstructions).toContain("TypeScript strict mode");
  });

  it("throws on missing stack.json", async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), "pit-test-"));
    await expect(readStack(emptyDir)).rejects.toThrow("stack.json");
    await rm(emptyDir, { recursive: true });
  });

  it("throws on invalid stack.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-test-"));
    await writeFile(path.join(dir, "stack.json"), '{"name":""}');
    await expect(readStack(dir)).rejects.toThrow();
    await rm(dir, { recursive: true });
  });
});

describe("writeStack", () => {
  it("writes a complete .promptpit/ directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-write-"));
    const outputDir = path.join(dir, ".promptpit");

    const bundle = await readStack(VALID_STACK);
    await writeStack(outputDir, bundle);

    const manifest = JSON.parse(
      await readFile(path.join(outputDir, "stack.json"), "utf-8"),
    );
    expect(manifest.name).toBe("test-stack");

    const skillContent = await readFile(
      path.join(outputDir, "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("browse");

    await rm(dir, { recursive: true });
  });
});
