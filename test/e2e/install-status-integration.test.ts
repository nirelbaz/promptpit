import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: install → status integration", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `pit-e2e-integ-${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  function captureJson(fn: () => Promise<void>): Promise<Record<string, unknown>> {
    return new Promise(async (resolve, reject) => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await fn();
        const output = spy.mock.calls.map((c) => c.join(" ")).join("");
        resolve(JSON.parse(output));
      } catch (err) {
        reject(err);
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("install with skills + MCP + instructions → status reports all correctly", async () => {
    // Collect from the fixture (has CLAUDE.md, skills, MCP servers)
    const collectDir = await makeTmpDir("collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    // Install into a fresh project with no pre-existing .mcp.json
    const targetDir = await makeTmpDir("target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDir, targetDir, {});

    // Run status --json
    const result = await captureJson(() => statusCommand(targetDir, { json: true }));

    // Verify structure
    expect(result).toHaveProperty("stacks");
    expect(result).toHaveProperty("hasManifest", true);

    const stacks = result.stacks as Array<{
      stack: string;
      adapters: Array<{
        adapterId: string;
        skillCount: number;
        mcpCount: number;
        hasInstructions: boolean;
        state: string;
        driftedFiles: string[];
      }>;
      overallState: string;
    }>;
    expect(stacks).toHaveLength(1);

    const stack = stacks[0]!;
    expect(stack.overallState).toBe("synced");

    // Check each adapter has correct counts
    for (const adapter of stack.adapters) {
      if (adapter.adapterId === "mcp-standard") {
        // mcp-standard should NOT have instructions
        expect(adapter.hasInstructions).toBe(false);
        // mcp-standard SHOULD have MCP count matching the stack's MCP servers
        expect(adapter.mcpCount).toBeGreaterThan(0);
      } else if (adapter.adapterId === "claude-code") {
        // Claude Code should have instructions, skills, and MCP
        expect(adapter.hasInstructions).toBe(true);
        expect(adapter.skillCount).toBeGreaterThan(0);
        expect(adapter.mcpCount).toBeGreaterThan(0);
      } else if (adapter.adapterId === "agents-md") {
        // agents-md should have instructions but no MCP (it doesn't support MCP)
        expect(adapter.hasInstructions).toBe(true);
        expect(adapter.mcpCount).toBe(0);
      }

      // Every adapter should be synced right after install
      expect(adapter.state).toBe("synced");
      expect(adapter.driftedFiles).toEqual([]);
    }
  });

  it(".mcp.json is created even when it didn't exist before install", async () => {
    const collectDir = await makeTmpDir("mcp-create-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-mcp-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    // No .mcp.json exists yet
    await installStack(bundleDir, targetDir, {});

    // .mcp.json should now exist
    const mcpRaw = await readFile(path.join(targetDir, ".mcp.json"), "utf-8");
    const mcp = JSON.parse(mcpRaw);
    expect(mcp).toHaveProperty("mcpServers");
    expect(Object.keys(mcp.mcpServers).length).toBeGreaterThan(0);
  });

  it("status detects drift per artifact type independently", async () => {
    const collectDir = await makeTmpDir("drift-types-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-drift-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    await installStack(bundleDir, targetDir, {});

    // Modify just one skill — other artifacts should stay synced
    const skillDir = path.join(targetDir, ".agents", "skills");
    const skills = await import("node:fs/promises").then((fs) => fs.readdir(skillDir));
    if (skills.length > 0) {
      const skillPath = path.join(skillDir, skills[0]!, "SKILL.md");
      await writeFile(skillPath, "# Modified\n");
    }

    const result = await captureJson(() => statusCommand(targetDir, { json: true }));
    const stacks = result.stacks as Array<{
      adapters: Array<{ adapterId: string; state: string; driftedFiles: string[] }>;
    }>;

    // At least one adapter should show drift (the one tracking the modified skill)
    const driftedAdapters = stacks[0]!.adapters.filter((a) => a.state !== "synced");
    expect(driftedAdapters.length).toBeGreaterThan(0);

    // The drifted files should reference the specific skill, not other artifacts
    for (const a of driftedAdapters) {
      expect(a.driftedFiles.some((f) => f.includes("SKILL.md"))).toBe(true);
    }
  });

  it("two stacks installed → status shows both with correct counts", async () => {
    const collectDir = await makeTmpDir("multi-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    // Create a second stack (instructions only, no skills/MCP)
    const stack2Dir = await makeTmpDir("stack2-");
    const bundle2Dir = path.join(stack2Dir, ".promptpit");
    await mkdir(bundle2Dir, { recursive: true });
    await writeFile(
      path.join(bundle2Dir, "stack.json"),
      JSON.stringify({ name: "second-stack", version: "1.0.0" }),
    );
    await writeFile(path.join(bundle2Dir, "agent.promptpit.md"), "Always be helpful.\n");

    const targetDir = await makeTmpDir("target-multi-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");

    await installStack(bundleDir, targetDir, {});
    await installStack(bundle2Dir, targetDir, {});

    const result = await captureJson(() => statusCommand(targetDir, { json: true }));
    const stacks = result.stacks as Array<{
      stack: string;
      adapters: Array<{ adapterId: string; skillCount: number; mcpCount: number }>;
    }>;

    expect(stacks).toHaveLength(2);

    // First stack should have skills and MCP
    const first = stacks.find((s) => s.stack !== "second-stack")!;
    const firstClaude = first.adapters.find((a) => a.adapterId === "claude-code")!;
    expect(firstClaude.skillCount).toBeGreaterThan(0);
    expect(firstClaude.mcpCount).toBeGreaterThan(0);

    // Second stack should have no skills and no MCP
    const second = stacks.find((s) => s.stack === "second-stack")!;
    const secondClaude = second.adapters.find((a) => a.adapterId === "claude-code")!;
    expect(secondClaude.skillCount).toBe(0);
    expect(secondClaude.mcpCount).toBe(0);
  });

  it("re-install updates manifest without duplicating entries", async () => {
    const collectDir = await makeTmpDir("upsert-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-upsert-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");

    await installStack(bundleDir, targetDir, {});
    await installStack(bundleDir, targetDir, {});
    await installStack(bundleDir, targetDir, {});

    const result = await captureJson(() => statusCommand(targetDir, { json: true }));
    const stacks = result.stacks as Array<{ stack: string }>;

    // Should be exactly 1 stack, not 3
    expect(stacks).toHaveLength(1);
  });

  it("dry-run does not create manifest or .mcp.json", async () => {
    const collectDir = await makeTmpDir("dryrun-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-dryrun-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Project\n");
    await installStack(bundleDir, targetDir, { dryRun: true });

    // Neither manifest nor .mcp.json should exist
    const { exists } = await import("../../src/shared/utils.js");
    expect(await exists(path.join(targetDir, ".promptpit", "installed.json"))).toBe(false);
    expect(await exists(path.join(targetDir, ".mcp.json"))).toBe(false);
  });
});
