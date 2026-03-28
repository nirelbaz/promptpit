import { describe, it, expect } from "vitest";
import { cursorAdapter, skillToMdc } from "../../src/adapters/cursor.js";
import path from "node:path";

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
