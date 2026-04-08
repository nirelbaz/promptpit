import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { copilotAdapter } from "../../src/adapters/copilot.js";
import { cursorAdapter } from "../../src/adapters/cursor.js";
import { codexAdapter } from "../../src/adapters/codex.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("preferUniversal mode", () => {
  let tmpDir: string;
  let bundle: Awaited<ReturnType<typeof readStack>>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-prefer-universal-"));
    bundle = await readStack(VALID_STACK);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Claude Code", () => {
    beforeEach(async () => {
      await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Existing");
    });

    it("skips MCP write to .claude/settings.json when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const settingsPath = path.join(tmpDir, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        expect(settings.mcpServers).toBeUndefined();
      }
    });

    it("still writes instructions to CLAUDE.md when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const claude = await readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
      expect(claude).toContain("promptpit:start:test-stack");
    });

    it("still writes skills, agents, rules, commands when preferUniversal", async () => {
      await claudeCodeAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".claude", "rules"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".claude", "agents"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".claude", "commands"))).toBe(true);
    });
  });

  describe("Copilot", () => {
    beforeEach(async () => {
      await mkdir(path.join(tmpDir, ".github"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".github", "copilot-instructions.md"),
        "# Existing",
      );
    });

    it("skips instructions write when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const instructions = await readFile(
        path.join(tmpDir, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      // Should remain unchanged — no marker injection
      expect(instructions).toBe("# Existing");
    });

    it("still writes MCP to .vscode/mcp.json when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".vscode", "mcp.json"))).toBe(true);
    });

    it("still writes skills, agents, rules, commands when preferUniversal", async () => {
      await copilotAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".github", "instructions"))).toBe(true);
      expect(existsSync(path.join(tmpDir, ".github", "agents"))).toBe(true);
    });
  });

  describe("Cursor", () => {
    beforeEach(async () => {
      await writeFile(path.join(tmpDir, ".cursorrules"), "Existing rules");
    });

    it("skips instructions write to .cursorrules when preferUniversal", async () => {
      await cursorAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const rules = await readFile(path.join(tmpDir, ".cursorrules"), "utf-8");
      expect(rules).toBe("Existing rules");
    });

    it("still writes MCP to .cursor/mcp.json when preferUniversal", async () => {
      await cursorAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".cursor", "mcp.json"))).toBe(true);
    });
  });

  describe("Codex", () => {
    beforeEach(async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(path.join(tmpDir, "AGENTS.md"), "# Existing");
    });

    it("skips AGENTS.md write when preferUniversal", async () => {
      await codexAdapter.write(tmpDir, bundle, { preferUniversal: true });
      const agents = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(agents).toBe("# Existing");
    });

    it("still writes MCP to .codex/config.toml when preferUniversal", async () => {
      await codexAdapter.write(tmpDir, bundle, { preferUniversal: true });
      expect(existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(true);
    });
  });
});
