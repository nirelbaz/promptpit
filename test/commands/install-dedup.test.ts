import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("install dedup", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe("default mode (Standards dedup)", () => {
    it("skips .mcp.json when Claude Code is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-cc-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, {});

      // .mcp.json should NOT exist — Claude Code reads it natively
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);
      // MCP should be in .claude/settings.json
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
    });

    it("skips AGENTS.md when Codex is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-codex-"));
      tmpDirs.push(target);
      await mkdir(path.join(target, ".codex"), { recursive: true });

      await installStack(VALID_STACK, target, {});

      // AGENTS.md should exist (Codex writes it) but only one set of markers
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      const startCount = (agents.match(/promptpit:start:test-stack/g) || []).length;
      expect(startCount).toBe(1);
    });

    it("skips .mcp.json even when no tools detected (Claude Code added as default)", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-none-"));
      tmpDirs.push(target);

      await installStack(VALID_STACK, target, {});

      // Claude Code is added as default, and it reads .mcp.json natively
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
      // But AGENTS.md should exist — Claude Code doesn't read it natively
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(true);
    });
  });

  describe("--force-standards", () => {
    it("writes .mcp.json even when Claude Code is detected", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-force-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { forceStandards: true });

      // Both should exist
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();
    });
  });

  describe("--prefer-universal", () => {
    it("writes .mcp.json and skips .claude/settings.json MCP", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-universal-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Existing");

      await installStack(VALID_STACK, target, { preferUniversal: true });

      // .mcp.json should exist (Standards writes it)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      // .claude/settings.json should have no MCP
      const settingsPath = path.join(target, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        expect(settings.mcpServers).toBeUndefined();
      }
      // CLAUDE.md should still have instructions
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(claude).toContain("promptpit:start:test-stack");
    });
  });

  describe("mutual exclusivity", () => {
    it("throws when both --force-standards and --prefer-universal are set", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-dedup-both-"));
      tmpDirs.push(target);

      await expect(
        installStack(VALID_STACK, target, {
          forceStandards: true,
          preferUniversal: true,
        }),
      ).rejects.toThrow("mutually exclusive");
    });
  });
});
