import { describe, it, expect, afterEach } from "vitest";
import { copilotAdapter, skillToInstructionsMd, ruleToInstructionsMd } from "../../src/adapters/copilot.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack } from "../../src/core/stack.js";

describe("copilotAdapter", () => {
  it("has correct id and displayName", () => {
    expect(copilotAdapter.id).toBe("copilot");
    expect(copilotAdapter.displayName).toBe("GitHub Copilot");
  });

  it("capabilities are correct", () => {
    expect(copilotAdapter.capabilities.skillLinkStrategy).toBe("translate-copy");
    expect(copilotAdapter.capabilities.rules).toBe(true);
    expect(copilotAdapter.capabilities.agentsmd).toBe(true);
    expect(copilotAdapter.capabilities.mcpRemote).toBe(true);
  });
});

describe("skillToInstructionsMd", () => {
  it("converts SKILL.md to .instructions.md with applyTo frontmatter", () => {
    const skillMd = `---
name: browse
description: Headless browser for QA
user-invocable: true
---

# Browse Skill

Navigate pages and take screenshots.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).toContain('applyTo: "**"');
    expect(result).toContain("Navigate pages and take screenshots.");
    expect(result).not.toContain("name: browse");
  });

  it("maps context globs to applyTo", () => {
    const skillMd = `---
name: test-rules
description: Testing rules
context:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

Use vitest for all tests.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).toContain('applyTo: "**/*.test.ts, **/*.spec.ts"');
    expect(result).toContain("Use vitest for all tests.");
  });

  it("strips original frontmatter from output", () => {
    const skillMd = `---
name: my-skill
description: A test skill
allowed-tools:
  - Read
  - Grep
---

Content here.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).not.toContain("allowed-tools");
    expect(result).not.toContain("Read");
    expect(result).toContain("Content here.");
  });
});

describe("copilot rules", () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("reads .instructions.md files as RuleEntry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-copilot-readrules-"));
    tmpDirs.push(dir);
    await mkdir(path.join(dir, ".github", "instructions"), { recursive: true });
    await writeFile(
      path.join(dir, ".github", "instructions", "lint.instructions.md"),
      '---\napplyTo: "**/*.ts"\n---\n\nRun eslint.\n',
    );

    const config = await copilotAdapter.read(dir);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe("lint");
    expect(config.rules[0].frontmatter.globs).toEqual(["**/*.ts"]);
  });

  it("writes rules with rule- prefix", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-copilot-writerules-"));
    tmpDirs.push(target);
    await mkdir(path.join(target, ".github"), { recursive: true });

    const bundle = await readStack(
      path.resolve("test/__fixtures__/stacks/valid-stack"),
    );

    await copilotAdapter.write(target, bundle, {});

    const testingRule = await readFile(
      path.join(target, ".github", "instructions", "rule-testing.instructions.md"), "utf-8",
    );
    expect(testingRule).toContain("**/*.test.ts, **/*.spec.ts");
    expect(testingRule).toContain("vitest");

    const securityRule = await readFile(
      path.join(target, ".github", "instructions", "rule-security.instructions.md"), "utf-8",
    );
    expect(securityRule).toContain("applyTo:");
    expect(securityRule).toContain("**");
    expect(securityRule).toContain("sanitize");
  });
});
