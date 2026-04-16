import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import { uninstallStack } from "../../src/commands/uninstall.js";
import { readManifest, writeManifest } from "../../src/core/manifest.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { exists } from "../../src/shared/utils.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("uninstallStack", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupInstalled(): Promise<string> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-uninstall-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, target, {});
    return target;
  }

  it("removes marker block from CLAUDE.md", async () => {
    const target = await setupInstalled();
    const beforeContent = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(beforeContent).toContain("promptpit:start:test-stack");

    await uninstallStack("test-stack", target, {});

    const afterContent = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(afterContent).not.toContain("promptpit:start:test-stack");
    expect(afterContent).not.toContain("promptpit:end:test-stack");
    expect(afterContent).toContain("# My Project");
  });

  it("removes skill files and canonical directory", async () => {
    const target = await setupInstalled();
    expect(await exists(path.join(target, ".claude", "skills", "browse", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(target, ".agents", "skills", "browse", "SKILL.md"))).toBe(true);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(target, ".claude", "skills", "browse"))).toBe(false);
    expect(await exists(path.join(target, ".agents", "skills", "browse"))).toBe(false);
  });

  it("removes agent files", async () => {
    const target = await setupInstalled();
    expect(await exists(path.join(target, ".claude", "agents", "reviewer.md"))).toBe(true);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(target, ".claude", "agents", "reviewer.md"))).toBe(false);
  });

  it("removes rule files", async () => {
    const target = await setupInstalled();
    const rulesDir = path.join(target, ".claude", "rules");
    expect(await exists(rulesDir)).toBe(true);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(rulesDir, "testing.md"))).toBe(false);
    expect(await exists(path.join(rulesDir, "security.md"))).toBe(false);
  });

  it("removes command files", async () => {
    const target = await setupInstalled();
    expect(await exists(path.join(target, ".claude", "commands", "review.md"))).toBe(true);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(target, ".claude", "commands", "review.md"))).toBe(false);
  });

  it("removes install manifest when no stacks remain", async () => {
    const target = await setupInstalled();
    const before = await readManifest(target);
    expect(before.installs).toHaveLength(1);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(target, ".promptpit", "installed.json"))).toBe(false);
  });

  it("preserves .env file (out of scope)", async () => {
    const target = await setupInstalled();
    expect(await exists(path.join(target, ".env"))).toBe(true);

    await uninstallStack("test-stack", target, {});

    expect(await exists(path.join(target, ".env"))).toBe(true);
  });

  it("throws when stack is not installed", async () => {
    const target = await setupInstalled();
    await expect(
      uninstallStack("nonexistent", target, {}),
    ).rejects.toThrow("not installed");
  });

  it("throws when no stacks installed", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-uninstall-"));
    tmpDirs.push(target);
    await expect(
      uninstallStack("anything", target, {}),
    ).rejects.toThrow("No stacks are installed");
  });

  it("skips modified files without --force", async () => {
    const target = await setupInstalled();
    const agentPath = path.join(target, ".claude", "agents", "reviewer.md");
    await writeFile(agentPath, "modified content\n");

    await uninstallStack("test-stack", target, {});

    // Modified agent should be preserved
    expect(await exists(agentPath)).toBe(true);
    const content = await readFile(agentPath, "utf-8");
    expect(content).toBe("modified content\n");
  });

  it("removes modified files with --force", async () => {
    const target = await setupInstalled();
    const agentPath = path.join(target, ".claude", "agents", "reviewer.md");
    await writeFile(agentPath, "modified content\n");

    await uninstallStack("test-stack", target, { force: true });

    expect(await exists(agentPath)).toBe(false);
  });

  it("dry-run does not modify files", async () => {
    const target = await setupInstalled();
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");

    await uninstallStack("test-stack", target, { dryRun: true });

    // Everything should be unchanged
    const afterClaudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(afterClaudeMd).toBe(claudeMd);
    expect(await exists(path.join(target, ".claude", "skills", "browse", "SKILL.md"))).toBe(true);
    const manifest = await readManifest(target);
    expect(manifest.installs).toHaveLength(1);
  });

  it("preserves artifacts shared with another installed stack", async () => {
    const target = await setupInstalled();

    // Simulate another stack that shares the same artifacts
    const manifest = await readManifest(target);
    const clonedEntry = JSON.parse(JSON.stringify(manifest.installs[0]));
    clonedEntry.stack = "other-stack";
    manifest.installs.push(clonedEntry);
    await writeManifest(target, manifest);

    await uninstallStack("test-stack", target, {});

    // Skills should still exist (shared with other-stack)
    expect(await exists(path.join(target, ".claude", "skills", "browse", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(target, ".agents", "skills", "browse", "SKILL.md"))).toBe(true);

    // Manifest should still have other-stack
    const after = await readManifest(target);
    expect(after.installs).toHaveLength(1);
    expect(after.installs[0]!.stack).toBe("other-stack");
  });

  it("deletes config file when empty after marker removal", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-uninstall-"));
    tmpDirs.push(target);
    // Start with empty CLAUDE.md — after install it's only the marker block
    await writeFile(path.join(target, "CLAUDE.md"), "");
    await installStack(VALID_STACK, target, {});

    await uninstallStack("test-stack", target, {});

    // CLAUDE.md should be deleted since it only contained the marker block
    expect(await exists(path.join(target, "CLAUDE.md"))).toBe(false);
  });

  it("updates manifest but keeps file when other stacks remain", async () => {
    const target = await setupInstalled();

    // Add a fake second stack to the manifest
    const manifest = await readManifest(target);
    manifest.installs.push({
      stack: "other-stack",
      stackVersion: "1.0.0",
      installedAt: new Date().toISOString(),
      adapters: {},
    });
    await writeManifest(target, manifest);

    await uninstallStack("test-stack", target, {});

    // Manifest should still exist with other-stack
    expect(await exists(path.join(target, ".promptpit", "installed.json"))).toBe(true);
    const after = await readManifest(target);
    expect(after.installs).toHaveLength(1);
    expect(after.installs[0]!.stack).toBe("other-stack");
  });

  it("removes MCP servers from settings.json", async () => {
    const target = await setupInstalled();
    const settingsPath = path.join(target, ".claude", "settings.json");
    // The valid stack fixture has MCP servers — verify they were installed
    expect(await exists(settingsPath)).toBe(true);
    const before = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(Object.keys(before.mcpServers ?? {}).length).toBeGreaterThan(0);

    await uninstallStack("test-stack", target, {});

    // Settings file should be cleaned up
    // If only mcpServers existed, file may be deleted or have empty mcpServers
    if (await exists(settingsPath)) {
      const after = JSON.parse(await readFile(settingsPath, "utf-8"));
      expect(Object.keys(after.mcpServers ?? {}).length).toBe(0);
    }
  });
});
