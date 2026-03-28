import { describe, it, expect } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.js";
import path from "node:path";

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
});
