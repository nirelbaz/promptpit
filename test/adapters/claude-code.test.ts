import { describe, it, expect, afterEach } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readStack } from "../../src/core/stack.js";

const FIXTURE_DIR = path.resolve("test/__fixtures__/claude-project");
const EMPTY_DIR = path.resolve("test/__fixtures__/bare-minimum");

describe("claudeCodeAdapter", () => {
  it("has correct id and displayName", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
    expect(claudeCodeAdapter.displayName).toBe("Claude Code");
  });

  describe("detect", () => {
    it("detects Claude Code project", async () => {
      const result = await claudeCodeAdapter.detect(FIXTURE_DIR);
      expect(result.detected).toBe(true);
      expect(result.configPaths.length).toBeGreaterThan(0);
    });

    it("returns false for project without Claude config", async () => {
      const result = await claudeCodeAdapter.detect(EMPTY_DIR);
      expect(result.detected).toBe(false);
    });
  });

  describe("read", () => {
    it("reads CLAUDE.md content", async () => {
      const config = await claudeCodeAdapter.read(FIXTURE_DIR);
      expect(config.agentInstructions).toContain("TypeScript strict mode");
    });

    it("reads skills", async () => {
      const config = await claudeCodeAdapter.read(FIXTURE_DIR);
      expect(config.skills).toHaveLength(1);
      expect(config.skills[0].name).toBe("browse");
      expect(config.skills[0].frontmatter.description).toBe(
        "Headless browser for QA testing",
      );
    });

    it("reads MCP servers", async () => {
      const config = await claudeCodeAdapter.read(FIXTURE_DIR);
      expect(config.mcpServers).toHaveProperty("postgres");
    });
  });

  describe("paths", () => {
    it("returns project-level paths", () => {
      const paths = claudeCodeAdapter.paths.project("/my/project");
      expect(paths.config).toBe("/my/project/CLAUDE.md");
      expect(paths.skills).toBe("/my/project/.claude/skills");
      expect(paths.mcp).toBe("/my/project/.claude/settings.json");
    });

    it("returns user-level paths", () => {
      const paths = claudeCodeAdapter.paths.user();
      expect(paths.config).toContain(".claude");
      expect(paths.config).toContain("CLAUDE.md");
    });
  });

  describe("write with canonicalSkillPaths", () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      tmpDirs.length = 0;
    });

    it("creates symlinks when canonicalSkillPaths is provided", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-cc-sym-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "");

      // Create canonical skill
      const canonDir = path.join(target, ".agents", "skills", "browse");
      await mkdir(canonDir, { recursive: true });
      const canonPath = path.join(canonDir, "SKILL.md");
      await writeFile(canonPath, "---\nname: browse\ndescription: test\n---\n# browse\n");

      const bundle = await readStack(
        path.resolve("test/__fixtures__/stacks/valid-stack"),
      );

      await claudeCodeAdapter.write(target, bundle, {
        canonicalSkillPaths: new Map([["browse", canonPath]]),
      });

      const skillPath = path.join(target, ".claude", "skills", "browse", "SKILL.md");
      const stat = await lstat(skillPath);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    it("falls back to direct write when canonicalSkillPaths is absent", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-cc-fb-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "");

      const bundle = await readStack(
        path.resolve("test/__fixtures__/stacks/valid-stack"),
      );

      await claudeCodeAdapter.write(target, bundle, {});

      const skillPath = path.join(target, ".claude", "skills", "browse", "SKILL.md");
      const stat = await lstat(skillPath);
      // Without canonicalSkillPaths, should be a regular file, not a symlink
      expect(stat.isSymbolicLink()).toBe(false);
      expect(stat.isFile()).toBe(true);
      const content = await readFile(skillPath, "utf-8");
      expect(content).toContain("browse");
    });
  });

  describe("agent read/write", () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      tmpDirs.length = 0;
    });

    it("reads agents from .claude/agents/", async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-cc-agents-read-"));
      tmpDirs.push(tmpDir);
      const agentsDir = path.join(tmpDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "reviewer.md"),
        "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
      );
      const config = await claudeCodeAdapter.read(tmpDir);
      expect(config.agents).toHaveLength(1);
      expect(config.agents[0]!.name).toBe("reviewer");
    });

    it("writes agents to .claude/agents/", async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-cc-agents-write-"));
      tmpDirs.push(tmpDir);
      const bundle = await readStack(path.resolve("test/__fixtures__/stacks/valid-stack"));
      await claudeCodeAdapter.write(tmpDir, bundle, {});
      const content = await readFile(
        path.join(tmpDir, ".claude", "agents", "reviewer.md"),
        "utf-8",
      );
      expect(content).toContain("security-focused code reviewer");
    });

    it("returns empty agents when no .claude/agents/ exists", async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-cc-agents-empty-"));
      tmpDirs.push(tmpDir);
      await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Test");
      const config = await claudeCodeAdapter.read(tmpDir);
      expect(config.agents).toEqual([]);
    });
  });

  describe("rules", () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      tmpDirs.length = 0;
    });

    it("writes rules to .claude/rules/ with translated frontmatter", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-cc-rules-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "");

      const bundle = await readStack(
        path.resolve("test/__fixtures__/stacks/valid-stack"),
      );

      await claudeCodeAdapter.write(target, bundle, {});

      const testingRule = await readFile(
        path.join(target, ".claude", "rules", "testing.md"), "utf-8",
      );
      expect(testingRule).toContain("paths:");
      expect(testingRule).toContain("**/*.test.ts");
      expect(testingRule).not.toContain("globs:");
      expect(testingRule).toContain("vitest");

      const securityRule = await readFile(
        path.join(target, ".claude", "rules", "security.md"), "utf-8",
      );
      // alwaysApply: true should remove paths
      expect(securityRule).not.toContain("paths:");
      expect(securityRule).toContain("sanitize");
    });

    it("reads rules from .claude/rules/*.md", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "pit-cc-readrules-"));
      tmpDirs.push(dir);
      await writeFile(path.join(dir, "CLAUDE.md"), "");
      await mkdir(path.join(dir, ".claude", "rules"), { recursive: true });
      await writeFile(
        path.join(dir, ".claude", "rules", "lint.md"),
        "---\nname: lint\ndescription: Lint rules\n---\n\nRun eslint.\n",
      );

      const config = await claudeCodeAdapter.read(dir);
      expect(config.rules).toHaveLength(1);
      expect(config.rules[0].name).toBe("lint");
      expect(config.rules[0].frontmatter.description).toBe("Lint rules");
    });
  });
});
