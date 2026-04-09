import { describe, it, expect, afterEach, vi } from "vitest";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import { readManifest } from "../../src/core/manifest.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("install multi-adapter dedup", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  /**
   * Create a temp directory with detection markers for each adapter.
   * - "claude-code" → CLAUDE.md
   * - "cursor" → .cursorrules
   * - "copilot" → .github/copilot-instructions.md
   * - "codex" → .codex/ directory
   */
  async function setupTarget(adapters: string[]): Promise<string> {
    const suffix = adapters.join("-");
    const dir = await mkdtemp(path.join(tmpdir(), `pit-multi-${suffix}-`));
    tmpDirs.push(dir);

    for (const adapter of adapters) {
      switch (adapter) {
        case "claude-code":
          await writeFile(path.join(dir, "CLAUDE.md"), "# Existing\n");
          break;
        case "cursor":
          await writeFile(path.join(dir, ".cursorrules"), "Existing rules\n");
          break;
        case "copilot":
          await mkdir(path.join(dir, ".github"), { recursive: true });
          await writeFile(
            path.join(dir, ".github", "copilot-instructions.md"),
            "# Existing\n",
          );
          break;
        case "codex":
          await mkdir(path.join(dir, ".codex"), { recursive: true });
          break;
      }
    }

    return dir;
  }

  function countMarkers(content: string, stackName: string): number {
    return (content.match(new RegExp(`promptpit:start:${stackName}`, "g")) || []).length;
  }

  describe("default mode — multi-adapter dedup", () => {
    it("CC + Cursor: skips .mcp.json and AGENTS.md", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json should be absent — CC reads MCP natively
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);

      // AGENTS.md should be absent — Cursor reads instructions natively
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(false);

      // MCP should be in .claude/settings.json
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();

      // Instructions should be in CLAUDE.md and .cursorrules
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(countMarkers(claude, "test-stack")).toBe(1);

      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(countMarkers(cursorrules, "test-stack")).toBe(1);
    });

    it("CC + Copilot: skips .mcp.json and AGENTS.md", async () => {
      const target = await setupTarget(["claude-code", "copilot"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json absent (CC reads natively)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);

      // AGENTS.md absent (Copilot reads instructions natively)
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(false);

      // MCP in .claude/settings.json
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();

      // MCP also in .vscode/mcp.json (Copilot writes its own)
      const vscodeMcp = JSON.parse(
        await readFile(path.join(target, ".vscode", "mcp.json"), "utf-8"),
      );
      expect(vscodeMcp.servers.postgres).toBeDefined();

      // Instructions in CLAUDE.md
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(countMarkers(claude, "test-stack")).toBe(1);

      // Instructions in .github/copilot-instructions.md
      const copilotInstr = await readFile(
        path.join(target, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      expect(countMarkers(copilotInstr, "test-stack")).toBe(1);
    });

    it("all four adapters: skips .mcp.json; Codex writes AGENTS.md (Standards skipped)", async () => {
      const target = await setupTarget(["claude-code", "cursor", "copilot", "codex"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json absent — CC reads MCP natively
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);

      // AGENTS.md present — Codex writes to it directly; Standards is skipped
      // (Standards gets skipInstructions=true because Cursor/Codex/Copilot read natively)
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(countMarkers(agents, "test-stack")).toBe(1);

      // MCP in tool-specific locations
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();

      // Each tool has its own instruction file with exactly 1 marker
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(countMarkers(claude, "test-stack")).toBe(1);

      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(countMarkers(cursorrules, "test-stack")).toBe(1);

      const copilotInstr = await readFile(
        path.join(target, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      expect(countMarkers(copilotInstr, "test-stack")).toBe(1);
    });

    it("Cursor only: .mcp.json present, AGENTS.md absent", async () => {
      const target = await setupTarget(["cursor"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json present — no native MCP reader detected (CC not present)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      const mcp = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf-8"));
      expect(mcp.mcpServers.postgres).toBeDefined();

      // AGENTS.md absent — Cursor reads instructions natively
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(false);

      // Instructions in .cursorrules
      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(countMarkers(cursorrules, "test-stack")).toBe(1);
    });

    it("Copilot only: .mcp.json present, AGENTS.md absent", async () => {
      const target = await setupTarget(["copilot"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json present — no native MCP reader
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);

      // AGENTS.md absent — Copilot reads instructions natively
      expect(existsSync(path.join(target, "AGENTS.md"))).toBe(false);

      // Instructions in .github/copilot-instructions.md
      const copilotInstr = await readFile(
        path.join(target, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      expect(countMarkers(copilotInstr, "test-stack")).toBe(1);
    });

    it("Codex only: .mcp.json present, AGENTS.md written by Codex (not Standards)", async () => {
      const target = await setupTarget(["codex"]);
      await installStack(VALID_STACK, target, {});

      // .mcp.json present — no native MCP reader
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);

      // Codex writes to AGENTS.md directly (same file as Standards), but
      // Standards skipInstructions=true so only one marker block
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(countMarkers(agents, "test-stack")).toBe(1);
    });
  }); // close default mode describe

  describe("mode overrides", () => {
    it("CC + Cursor + --force-standards: writes both universal and tool-specific", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);
      await installStack(VALID_STACK, target, { forceStandards: true });

      // .mcp.json present (Standards writes it)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      const mcp = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf-8"));
      expect(mcp.mcpServers.postgres).toBeDefined();

      // .claude/settings.json also has MCP (CC writes it)
      const settings = JSON.parse(
        await readFile(path.join(target, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers.postgres).toBeDefined();

      // AGENTS.md present (Standards writes it)
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(countMarkers(agents, "test-stack")).toBe(1);

      // CLAUDE.md has instructions (CC writes it)
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(countMarkers(claude, "test-stack")).toBe(1);

      // .cursorrules has instructions (Cursor writes it)
      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(countMarkers(cursorrules, "test-stack")).toBe(1);
    });

    it("CC + Cursor + --prefer-universal: universal files written, tool-specific skipped", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);
      await installStack(VALID_STACK, target, { preferUniversal: true });

      // .mcp.json present (Standards writes it)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);

      // .claude/settings.json should not exist (CC skips MCP write entirely)
      expect(existsSync(path.join(target, ".claude", "settings.json"))).toBe(false);

      // AGENTS.md present (Standards writes it)
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(countMarkers(agents, "test-stack")).toBe(1);

      // .cursorrules unchanged (Cursor skips instructions)
      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(cursorrules).toBe("Existing rules\n");
    });

    it("CC + Copilot + --prefer-universal: Copilot instructions skipped", async () => {
      const target = await setupTarget(["claude-code", "copilot"]);
      await installStack(VALID_STACK, target, { preferUniversal: true });

      // .mcp.json present (Standards writes it)
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);

      // AGENTS.md present (Standards writes it)
      const agents = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(countMarkers(agents, "test-stack")).toBe(1);

      // .github/copilot-instructions.md unchanged (Copilot skips instructions)
      const copilotInstr = await readFile(
        path.join(target, ".github", "copilot-instructions.md"),
        "utf-8",
      );
      expect(copilotInstr).toBe("# Existing\n");
    });
  });

  describe("manifest correctness", () => {
    it("all four adapters: manifest records all detected adapters", async () => {
      const target = await setupTarget(["claude-code", "cursor", "copilot", "codex"]);
      await installStack(VALID_STACK, target, {});

      const manifest = await readManifest(target);
      expect(manifest.installs).toHaveLength(1);

      const adapters = manifest.installs[0]!.adapters;
      expect(adapters).toHaveProperty("claude-code");
      expect(adapters).toHaveProperty("cursor");
      expect(adapters).toHaveProperty("copilot");
      expect(adapters).toHaveProperty("codex");
      expect(adapters).toHaveProperty("standards");
    });

    it("default mode: Standards has no mcp or instructions hashes when skipped", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);
      await installStack(VALID_STACK, target, {});

      const manifest = await readManifest(target);
      const standards = manifest.installs[0]!.adapters.standards;

      // Standards skipped both MCP and instructions
      expect(standards?.mcp).toBeUndefined();
      expect(standards?.instructions).toBeUndefined();
    });

    it("mode switch: re-install updates manifest entry (upsert)", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);

      // First install: default mode
      await installStack(VALID_STACK, target, {});
      const first = await readManifest(target);
      expect(first.installs).toHaveLength(1);
      expect(first.installs[0]!.installMode).toBeUndefined();

      // Second install: --force-standards
      await installStack(VALID_STACK, target, { forceStandards: true });
      const second = await readManifest(target);

      // Still 1 entry (upserted, not duplicated)
      expect(second.installs).toHaveLength(1);
      expect(second.installs[0]!.installMode).toBe("force-standards");

      // Standards now has MCP hashes (it wrote .mcp.json)
      expect(second.installs[0]!.adapters.standards?.mcp).toBeDefined();
    });
  });

  describe("idempotency and lifecycle", () => {
    it("install twice: no marker duplication", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);
      await installStack(VALID_STACK, target, {});
      await installStack(VALID_STACK, target, {});

      // Each file should have exactly 1 marker block
      const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
      expect(countMarkers(claude, "test-stack")).toBe(1);

      const cursorrules = await readFile(path.join(target, ".cursorrules"), "utf-8");
      expect(countMarkers(cursorrules, "test-stack")).toBe(1);
    });

    it("mode switch: universal files appear after re-install with --force-standards", async () => {
      const target = await setupTarget(["claude-code", "cursor"]);

      // Default mode: no .mcp.json
      await installStack(VALID_STACK, target, {});
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(false);

      // Re-install with --force-standards: .mcp.json appears
      await installStack(VALID_STACK, target, { forceStandards: true });
      expect(existsSync(path.join(target, ".mcp.json"))).toBe(true);
      const mcp = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf-8"));
      expect(mcp.mcpServers.postgres).toBeDefined();

      // Manifest updated
      const manifest = await readManifest(target);
      expect(manifest.installs).toHaveLength(1);
      expect(manifest.installs[0]!.installMode).toBe("force-standards");
    });

    it("status reports synced for all adapters after multi-adapter install", async () => {
      const target = await setupTarget(["claude-code", "cursor", "copilot"]);
      await installStack(VALID_STACK, target, {});

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      await statusCommand(target, { json: true });
      const output = spy.mock.calls.map((c) => c.join(" ")).join("");
      const result = JSON.parse(output);
      spy.mockRestore();

      const stacks = result.stacks as Array<{
        adapters: Array<{ adapterId: string; state: string }>;
        overallState: string;
      }>;
      expect(stacks).toHaveLength(1);
      expect(stacks[0]!.overallState).toBe("synced");

      // Each adapter should be synced
      for (const adapter of stacks[0]!.adapters) {
        expect(adapter.state).toBe("synced");
      }

      // All expected adapters present
      const adapterIds = stacks[0]!.adapters.map((a) => a.adapterId);
      expect(adapterIds).toContain("claude-code");
      expect(adapterIds).toContain("cursor");
      expect(adapterIds).toContain("copilot");
      expect(adapterIds).toContain("standards");
    });
  });
});
