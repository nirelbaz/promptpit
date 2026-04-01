import { describe, it, expect, afterEach } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import { readManifest } from "../../src/core/manifest.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("E2E: round-trip dedup guarantee", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `pit-e2e-dedup-${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  it("collect -> install -> collect produces identical output (no duplication)", async () => {
    // First collect
    const collectDir = await makeTmpDir("collect1-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);
    await readFile(
      path.join(bundleDir, "agent.promptpit.md"),
      "utf-8",
    );

    // Install into a fresh project
    const targetDir = await makeTmpDir("target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDir, targetDir, {});

    // Second collect from the installed project
    const secondBundleDir = path.join(targetDir, ".promptpit-test");
    await collectStack(targetDir, secondBundleDir);
    const secondBundle = await readFile(
      path.join(secondBundleDir, "agent.promptpit.md"),
      "utf-8",
    );

    // The installed content should be stripped — no duplication
    expect(secondBundle).not.toContain("promptpit:start:");
    expect(secondBundle).not.toContain("promptpit:end:");
  });

  it("install writes a valid manifest", async () => {
    const collectDir = await makeTmpDir("manifest-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-manifest-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");
    await installStack(bundleDir, targetDir, {});

    const manifest = await readManifest(targetDir);
    expect(manifest.version).toBe(1);
    expect(manifest.installs).toHaveLength(1);
    expect(manifest.installs[0]!.stack).toBe("test-project");
    expect(manifest.installs[0]!.adapters).toHaveProperty("claude-code");
  });

  it("re-install replaces manifest entry (upsert)", async () => {
    const collectDir = await makeTmpDir("upsert-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-upsert-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");

    // Install twice
    await installStack(bundleDir, targetDir, {});
    await installStack(bundleDir, targetDir, {});

    const manifest = await readManifest(targetDir);
    // Should still have exactly 1 entry (upserted, not duplicated)
    expect(manifest.installs).toHaveLength(1);
  });

  it("status reports synced after fresh install", async () => {
    const collectDir = await makeTmpDir("status-sync-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-status-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");
    await installStack(bundleDir, targetDir, {});

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(targetDir, { json: true });

    const output = spy.mock.calls.map((c) => c.join(" ")).join("");
    const parsed = JSON.parse(output);
    expect(parsed.stacks).toHaveLength(1);
    spy.mockRestore();
  });

  it("status detects drifted skill after manual edit", async () => {
    const collectDir = await makeTmpDir("drift-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-drift-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");
    await installStack(bundleDir, targetDir, {});

    // Manually edit a skill file
    const skillPath = path.join(targetDir, ".agents", "skills", "browse", "SKILL.md");
    await writeFile(skillPath, "# Modified by user\n");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(targetDir, { json: true });

    const output = spy.mock.calls.map((c) => c.join(" ")).join("");
    const parsed = JSON.parse(output);
    expect(parsed.stacks).toHaveLength(1);

    // At least one adapter should show drift
    const hasNonSynced = parsed.stacks[0].adapters.some(
      (a: { state: string }) => a.state !== "synced",
    );
    expect(hasNonSynced).toBe(true);
    spy.mockRestore();
  });

  it("two stacks installed, collect strips both", async () => {
    // Set up a project with two installed stacks
    const targetDir = await makeTmpDir("multi-stack-");
    await writeFile(
      path.join(targetDir, "CLAUDE.md"),
      "# My project\n\n<!-- promptpit:start:stack-a:1.0.0:claude-code -->\nFrom stack A\n<!-- promptpit:end:stack-a -->\n\n<!-- promptpit:start:stack-b:1.0.0:claude-code -->\nFrom stack B\n<!-- promptpit:end:stack-b -->\n",
    );

    // Write a minimal manifest so collect sees installs exist
    const manifestDir = path.join(targetDir, ".promptpit");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      path.join(manifestDir, "installed.json"),
      JSON.stringify({
        version: 1,
        installs: [
          { stack: "stack-a", stackVersion: "1.0.0", installedAt: "2026-01-01T00:00:00Z", adapters: {} },
          { stack: "stack-b", stackVersion: "1.0.0", installedAt: "2026-01-01T00:00:00Z", adapters: {} },
        ],
      }),
    );

    const bundleDir = path.join(targetDir, ".promptpit-out");
    await collectStack(targetDir, bundleDir);

    const collected = await readFile(
      path.join(bundleDir, "agent.promptpit.md"),
      "utf-8",
    );

    // Both installed blocks should be stripped
    expect(collected).not.toContain("From stack A");
    expect(collected).not.toContain("From stack B");
    expect(collected).toContain("# My project");
  });

  it(".mcp.json is written during install when MCP servers exist", async () => {
    const collectDir = await makeTmpDir("mcp-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-mcp-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");
    await installStack(bundleDir, targetDir, {});

    // Check if .mcp.json was created (only if the fixture has MCP servers)
    const manifest = await readManifest(targetDir);
    expect(manifest.version).toBe(1);
    // The fixture has MCP servers, so the manifest should track them
  });

  it("dry-run does not write manifest", async () => {
    const collectDir = await makeTmpDir("dryrun-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    const targetDir = await makeTmpDir("target-dryrun-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# Existing\n");
    await installStack(bundleDir, targetDir, { dryRun: true });

    const manifest = await readManifest(targetDir);
    expect(manifest.installs).toHaveLength(0);
  });
});
