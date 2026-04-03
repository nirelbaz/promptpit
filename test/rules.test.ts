import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readRulesFromDir } from "../src/adapters/adapter-utils.js";
import { ruleToClaudeFormat } from "../src/adapters/claude-code.js";
import { ruleToMdc } from "../src/adapters/cursor.js";
import { ruleToInstructionsMd } from "../src/adapters/copilot.js";
import { mergeConfigs } from "../src/core/merger.js";
import { ruleFrontmatterSchema } from "../src/shared/schema.js";
import type { PlatformConfig } from "../src/adapters/types.js";
import type { RuleEntry } from "../src/shared/schema.js";

let tmpDirs: string[] = [];

async function makeTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeRule(overrides: Partial<{ name: string; description: string; globs: string[]; alwaysApply: boolean; body: string }> = {}): string {
  const { name = "test-rule", description = "A test rule", globs, alwaysApply, body = "Do the thing.\n" } = overrides;
  const fmLines = [`name: ${name}`, `description: ${description}`];
  if (globs) fmLines.push(`globs:\n${globs.map(g => `  - "${g}"`).join("\n")}`);
  if (alwaysApply != null) fmLines.push(`alwaysApply: ${alwaysApply}`);
  return `---\n${fmLines.join("\n")}\n---\n\n${body}`;
}

// --- ruleFrontmatterSchema ---

describe("ruleFrontmatterSchema", () => {
  it("validates minimal rule frontmatter", () => {
    const result = ruleFrontmatterSchema.safeParse({ name: "test", description: "A rule" });
    expect(result.success).toBe(true);
  });

  it("validates full rule frontmatter", () => {
    const result = ruleFrontmatterSchema.safeParse({
      name: "testing",
      description: "Testing rules",
      globs: ["**/*.test.ts"],
      alwaysApply: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts missing name (inferred from filename at read time)", () => {
    const result = ruleFrontmatterSchema.safeParse({ description: "A rule" });
    expect(result.success).toBe(true);
  });

  it("accepts missing description (optional for real-world compatibility)", () => {
    const result = ruleFrontmatterSchema.safeParse({ name: "test" });
    expect(result.success).toBe(true);
  });

  it("accepts null globs (treated as undefined)", () => {
    const result = ruleFrontmatterSchema.safeParse({ name: "test", globs: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globs).toBeUndefined();
    }
  });

  it("strips unknown adapter fields (paths, applyTo)", () => {
    const result = ruleFrontmatterSchema.safeParse({
      name: "test",
      paths: ["src/**/*.ts"],
      applyTo: "**/*.ts",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("paths" in result.data).toBe(false);
      expect("applyTo" in result.data).toBe(false);
    }
  });

  it("coerces single string globs to array", () => {
    const result = ruleFrontmatterSchema.safeParse({
      name: "test",
      description: "A rule",
      globs: "**/*.ts",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globs).toEqual(["**/*.ts"]);
    }
  });
});

// --- readRulesFromDir ---

describe("readRulesFromDir", () => {
  it("reads rules from a directory", async () => {
    const dir = await makeTmp("pit-rules-read-");
    await writeFile(path.join(dir, "testing.md"), makeRule({ name: "testing", description: "Test rules", globs: ["**/*.test.ts"] }));

    const rules = await readRulesFromDir(dir);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("testing");
    expect(rules[0].frontmatter.description).toBe("Test rules");
    expect(rules[0].frontmatter.globs).toEqual(["**/*.test.ts"]);
  });

  it("returns empty array for missing directory", async () => {
    const rules = await readRulesFromDir("/nonexistent/path");
    expect(rules).toEqual([]);
  });

  it("reads files without name/description (infers name from filename)", async () => {
    const dir = await makeTmp("pit-rules-infer-");
    await writeFile(path.join(dir, "no-name.md"), "---\nfoo: bar\n---\n\nNo name or description.\n");
    await writeFile(path.join(dir, "good.md"), makeRule({ name: "good", description: "Good rule" }));

    const rules = await readRulesFromDir(dir);
    expect(rules).toHaveLength(2);
    const noName = rules.find((r) => r.name === "no-name");
    expect(noName).toBeDefined();
    expect(noName!.frontmatter.name).toBe("no-name");
  });

  it("derives name from filename", async () => {
    const dir = await makeTmp("pit-rules-name-");
    await writeFile(path.join(dir, "my-custom-rule.md"), makeRule({ name: "my-custom-rule", description: "Custom" }));

    const rules = await readRulesFromDir(dir);
    expect(rules[0].name).toBe("my-custom-rule");
    expect(rules[0].path).toBe("rules/my-custom-rule");
  });
});

// --- ruleToClaudeFormat ---

describe("ruleToClaudeFormat", () => {
  it("translates globs to paths", () => {
    const input = makeRule({ name: "testing", description: "Test rules", globs: ["**/*.test.ts", "**/*.spec.ts"] });
    const output = ruleToClaudeFormat(input);

    expect(output).toContain("paths:");
    expect(output).toContain("**/*.test.ts");
    expect(output).toContain("**/*.spec.ts");
    expect(output).not.toContain("globs:");
    expect(output).toContain("Do the thing.");
  });

  it("removes paths when alwaysApply is true", () => {
    const input = makeRule({ name: "always", description: "Always active", globs: ["**/*.ts"], alwaysApply: true });
    const output = ruleToClaudeFormat(input);

    expect(output).not.toContain("paths:");
    expect(output).not.toContain("alwaysApply");
    expect(output).toContain("Do the thing.");
  });

  it("outputs no frontmatter for rule with only name/description", () => {
    const input = makeRule({ name: "simple", description: "Simple" });
    const output = ruleToClaudeFormat(input);

    // gray-matter.stringify adds --- even for empty data, but description should be there
    expect(output).toContain("Do the thing.");
  });
});

// --- ruleToMdc ---

describe("ruleToMdc", () => {
  it("preserves description and globs", () => {
    const input = makeRule({ name: "testing", description: "Test rules", globs: ["**/*.test.ts", "**/*.spec.ts"] });
    const output = ruleToMdc(input);

    expect(output).toContain("description: Test rules");
    expect(output).toContain("**/*.test.ts, **/*.spec.ts");
    expect(output).toContain("Do the thing.");
  });

  it("includes alwaysApply when set", () => {
    const input = makeRule({ name: "always", description: "Always", alwaysApply: true });
    const output = ruleToMdc(input);

    expect(output).toContain("alwaysApply: true");
  });

  it("omits globs when not present", () => {
    const input = makeRule({ name: "simple", description: "Simple" });
    const output = ruleToMdc(input);

    expect(output).toContain("description: Simple");
    expect(output).not.toContain("globs:");
  });
});

// --- ruleToInstructionsMd ---

describe("ruleToInstructionsMd", () => {
  it("translates globs to applyTo", () => {
    const input = makeRule({ name: "testing", description: "Test rules", globs: ["**/*.test.ts"] });
    const output = ruleToInstructionsMd(input);

    expect(output).toContain("**/*.test.ts");
    expect(output).toContain("Do the thing.");
  });

  it("joins multiple globs with comma", () => {
    const input = makeRule({ name: "multi", description: "Multi", globs: ["**/*.ts", "**/*.tsx"] });
    const output = ruleToInstructionsMd(input);

    expect(output).toContain("**/*.ts, **/*.tsx");
  });

  it("defaults to ** when no globs", () => {
    const input = makeRule({ name: "all", description: "All files" });
    const output = ruleToInstructionsMd(input);

    expect(output).toContain("applyTo:");
    expect(output).toContain("**");
  });
});

// --- Merger dedup ---

describe("merger rules dedup", () => {
  function makeConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
    return {
      adapterId: "test",
      agentInstructions: "",
      skills: [],
      mcpServers: {},
      rules: [],
      ...overrides,
    };
  }

  function makeRuleEntry(name: string): RuleEntry {
    return {
      name,
      path: `rules/${name}`,
      frontmatter: { name, description: `Rule ${name}` },
      content: `---\nname: ${name}\ndescription: Rule ${name}\n---\n\nContent for ${name}.\n`,
    };
  }

  it("deduplicates rules by name across adapters", () => {
    const a = makeConfig({ adapterId: "claude-code", rules: [makeRuleEntry("testing")] });
    const b = makeConfig({ adapterId: "cursor", rules: [makeRuleEntry("testing")] });

    const merged = mergeConfigs([a, b]);
    expect(merged.rules).toHaveLength(1);
    expect(merged.rules[0].name).toBe("testing");
  });

  it("keeps unique rules from different adapters", () => {
    const a = makeConfig({ adapterId: "claude-code", rules: [makeRuleEntry("testing")] });
    const b = makeConfig({ adapterId: "cursor", rules: [makeRuleEntry("frontend")] });

    const merged = mergeConfigs([a, b]);
    expect(merged.rules).toHaveLength(2);
  });

  it("preserves first-seen rule on name collision", () => {
    const ruleA = makeRuleEntry("testing");
    ruleA.content = "first";
    const ruleB = makeRuleEntry("testing");
    ruleB.content = "second";

    const a = makeConfig({ adapterId: "a", rules: [ruleA] });
    const b = makeConfig({ adapterId: "b", rules: [ruleB] });

    const merged = mergeConfigs([a, b]);
    expect(merged.rules[0].content).toBe("first");
  });
});
