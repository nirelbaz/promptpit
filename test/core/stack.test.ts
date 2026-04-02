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

  it("reads rules from rules/*.md", async () => {
    const bundle = await readStack(VALID_STACK);
    expect(bundle.rules).toHaveLength(2);
    const names = bundle.rules.map((r) => r.name).sort();
    expect(names).toEqual(["security", "testing"]);
    const testing = bundle.rules.find((r) => r.name === "testing")!;
    expect(testing.frontmatter.description).toBe("Testing conventions");
    expect(testing.frontmatter.globs).toEqual(["**/*.test.ts", "**/*.spec.ts"]);
    expect(testing.frontmatter.alwaysApply).toBe(false);
    const security = bundle.rules.find((r) => r.name === "security")!;
    expect(security.frontmatter.alwaysApply).toBe(true);
  });

  it("returns empty rules for bundle without rules dir", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-norules-"));
    await writeFile(path.join(dir, "stack.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const bundle = await readStack(dir);
    expect(bundle.rules).toEqual([]);
    await rm(dir, { recursive: true });
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

  it("writes rules to rules/{name}.md", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-write-rules-"));
    const outputDir = path.join(dir, ".promptpit");

    const bundle = await readStack(VALID_STACK);
    await writeStack(outputDir, bundle);

    const ruleContent = await readFile(
      path.join(outputDir, "rules", "testing.md"),
      "utf-8",
    );
    expect(ruleContent).toContain("Testing conventions");
    expect(ruleContent).toContain("vitest");

    const secContent = await readFile(
      path.join(outputDir, "rules", "security.md"),
      "utf-8",
    );
    expect(secContent).toContain("Security guidelines");

    await rm(dir, { recursive: true });
  });

  it("round-trips rules through write then read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-roundtrip-rules-"));
    const outputDir = path.join(dir, ".promptpit");

    const original = await readStack(VALID_STACK);
    await writeStack(outputDir, original);
    const reread = await readStack(outputDir);

    expect(reread.rules).toHaveLength(original.rules.length);
    for (const origRule of original.rules) {
      const found = reread.rules.find((r) => r.name === origRule.name);
      expect(found).toBeDefined();
      expect(found!.frontmatter.description).toBe(origRule.frontmatter.description);
    }

    await rm(dir, { recursive: true });
  });
});
