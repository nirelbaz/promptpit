import { describe, it, expect, afterEach } from "vitest";
import { cursorAdapter, skillToMdc, ruleToMdc } from "../../src/adapters/cursor.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack } from "../../src/core/stack.js";

const FIXTURE_DIR = path.resolve("test/__fixtures__/cursor-project");
const EMPTY_DIR = path.resolve("test/__fixtures__/bare-minimum");

describe("cursorAdapter", () => {
  it("has correct id and displayName", () => {
    expect(cursorAdapter.id).toBe("cursor");
    expect(cursorAdapter.displayName).toBe("Cursor");
  });

  describe("detect", () => {
    it("detects Cursor project", async () => {
      const result = await cursorAdapter.detect(FIXTURE_DIR);
      expect(result.detected).toBe(true);
    });

    it("returns false for project without Cursor config", async () => {
      const result = await cursorAdapter.detect(EMPTY_DIR);
      expect(result.detected).toBe(false);
    });
  });

  describe("read", () => {
    it("reads .cursorrules", async () => {
      const config = await cursorAdapter.read(FIXTURE_DIR);
      expect(config.agentInstructions).toContain("functional components");
    });

    it("reads MCP config", async () => {
      const config = await cursorAdapter.read(FIXTURE_DIR);
      expect(config.mcpServers).toHaveProperty("filesystem");
    });

    it("reads both .mdc and .md rules into RuleEntry format", async () => {
      const config = await cursorAdapter.read(FIXTURE_DIR);
      expect(config.rules).toHaveLength(2);
      const names = config.rules.map((r) => r.name).sort();
      expect(names).toEqual(["coding-style", "testing"]);
      expect(config.rules.find((r) => r.name === "testing")!.frontmatter.description).toBe("Testing rules");
      expect(config.rules.find((r) => r.name === "coding-style")!.frontmatter.description).toBe("Coding style conventions");
    });

    it("reads skills from .cursor/skills/", async () => {
      const config = await cursorAdapter.read(FIXTURE_DIR);
      expect(config.skills).toHaveLength(1);
      expect(config.skills[0].name).toBe("browse");
      expect(config.skills[0].frontmatter.description).toBe("Headless browser for QA");
    });
  });

  describe("read commands", () => {
    const tmpDirs: string[] = [];
    afterEach(async () => {
      for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
      tmpDirs.length = 0;
    });

    it("reads commands from .cursor/commands/", async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-cursor-commands-"));
      tmpDirs.push(tmpDir);
      const commandsDir = path.join(tmpDir, ".cursor", "commands");
      await mkdir(commandsDir, { recursive: true });
      await writeFile(path.join(commandsDir, "deploy.md"), "Deploy to prod");
      await writeFile(path.join(tmpDir, ".cursorrules"), "rules");

      const config = await cursorAdapter.read(tmpDir);
      expect(config.commands).toHaveLength(1);
      expect(config.commands[0]!.name).toBe("deploy");
    });
  });

  describe("write rules", () => {
    const tmpDirs: string[] = [];
    afterEach(async () => {
      for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
      tmpDirs.length = 0;
    });

    it("writes rules with rule- prefix to avoid skill collision", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-cursor-rules-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, ".cursorrules"), "");
      await mkdir(path.join(target, ".cursor", "rules"), { recursive: true });

      const bundle = await readStack(
        path.resolve("test/__fixtures__/stacks/valid-stack"),
      );

      await cursorAdapter.write(target, bundle, {});

      const testingRule = await readFile(
        path.join(target, ".cursor", "rules", "rule-testing.mdc"), "utf-8",
      );
      expect(testingRule).toContain("description: Testing conventions");
      expect(testingRule).toContain("globs:");
      expect(testingRule).toContain("vitest");

      const securityRule = await readFile(
        path.join(target, ".cursor", "rules", "rule-security.mdc"), "utf-8",
      );
      expect(securityRule).toContain("description: Security guidelines");
    });

    it("does not double-prefix rule names that already have rule-", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-cursor-nodup-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, ".cursorrules"), "");
      await mkdir(path.join(target, ".cursor", "rules"), { recursive: true });

      const bundle = await readStack(
        path.resolve("test/__fixtures__/stacks/valid-stack"),
      );
      // Simulate a rule that already has the prefix
      bundle.rules = [{
        name: "rule-already-prefixed",
        path: "rules/rule-already-prefixed",
        frontmatter: { name: "rule-already-prefixed", description: "Already prefixed" },
        content: "---\nname: rule-already-prefixed\ndescription: Already prefixed\n---\n\nContent.\n",
      }];

      await cursorAdapter.write(target, bundle, {});

      const content = await readFile(
        path.join(target, ".cursor", "rules", "rule-already-prefixed.mdc"), "utf-8",
      );
      expect(content).toContain("Already prefixed");
    });
  });
});

describe("cursor inline agent writing", () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("includes agents section when bundle has agents but empty agentInstructions", async () => {
    // This exercises the buildInlineContent else branch:
    // agentInstructions is "" so content starts as "" and is replaced by agentSection alone.
    const target = await mkdtemp(path.join(tmpdir(), "pit-cursor-agents-only-"));
    tmpDirs.push(target);

    const bundle = {
      manifest: { name: "agents-only", version: "1.0.0", skills: [], compatibility: [] },
      agentInstructions: "",
      skills: [],
      agents: [
        {
          name: "helper",
          path: "agents/helper",
          frontmatter: { name: "helper", description: "General helper" },
          content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
        },
      ],
      rules: [],
      mcpServers: {},
      envExample: {},
    };

    await cursorAdapter.write(target, bundle, {});

    const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
    expect(cursorrules).toContain("## Custom Agents");
    expect(cursorrules).toContain("### helper");
    expect(cursorrules).toContain("Help with tasks.");
  });
});

describe("skillToMdc", () => {
  it("converts SKILL.md content to .mdc format", () => {
    const skillMd = `---
name: browse
description: Headless browser for QA
user-invocable: true
---

# Browse Skill

Navigate pages and take screenshots.`;

    const mdc = skillToMdc(skillMd, "browse");
    expect(mdc).toContain("description: Headless browser for QA");
    expect(mdc).toContain("Navigate pages");
  });
});
