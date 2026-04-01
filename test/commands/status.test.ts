import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusCommand } from "../../src/commands/status.js";
import { writeManifest, computeHash } from "../../src/core/manifest.js";
import { insertMarkers } from "../../src/shared/markers.js";
import type { InstallManifest } from "../../src/shared/schema.js";

describe("pit status", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-status-"));
    tmpDirs.push(dir);
    return dir;
  }

  async function captureOutput(fn: () => Promise<void>): Promise<string> {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await fn();
      return spy.mock.calls.map((c) => c.join(" ")).join("\n");
    } finally {
      spy.mockRestore();
    }
  }

  it("reports no stacks when no manifest exists", async () => {
    const dir = await makeTmpDir();
    const output = await captureOutput(() => statusCommand(dir));
    expect(output).toContain("No stacks installed");
  });

  it("reports synced when hashes match", async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    const skillContent = "---\nname: security\ndescription: sec\n---\nrules";
    await writeFile(path.join(skillDir, "SKILL.md"), skillContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: computeHash(skillContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir));
    expect(output).toContain("my-stack");
    expect(output).toContain("✓");
  });

  it("reports drifted when skill hash differs", async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "modified content");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: "sha256:original-hash" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir));
    expect(output).toContain("my-stack");
  });

  it("reports deleted when skill file is missing", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: "sha256:abc" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir));
    expect(output).toContain("my-stack");
  });

  it("--json outputs valid JSON", async () => {
    const dir = await makeTmpDir();
    const output = await captureOutput(() => statusCommand(dir, { json: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stacks");
    expect(parsed).toHaveProperty("hasManifest");
  });

  it("--verbose shows individual skill names and paths", async () => {
    const dir = await makeTmpDir();
    const skillDir1 = path.join(dir, ".agents", "skills", "security");
    const skillDir2 = path.join(dir, ".agents", "skills", "testing");
    await mkdir(skillDir1, { recursive: true });
    await mkdir(skillDir2, { recursive: true });
    const skill1 = "---\nname: security\n---\nrules";
    const skill2 = "---\nname: testing\n---\nrules";
    await writeFile(path.join(skillDir1, "SKILL.md"), skill1);
    await writeFile(path.join(skillDir2, "SKILL.md"), skill2);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: {
              security: { hash: computeHash(skill1) },
              testing: { hash: computeHash(skill2) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("security");
    expect(output).toContain("testing");
    expect(output).toContain("SKILL.md");
  });

  it("--verbose shows MCP server names", async () => {
    const dir = await makeTmpDir();
    const mcpConfig = { mcpServers: { "my-server": { command: "node", args: ["server.js"] } } };
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify(mcpConfig));

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "mcp-standard": {
            mcp: { "my-server": { hash: computeHash(JSON.stringify(mcpConfig.mcpServers["my-server"])) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("my-server");
    expect(output).toContain("mcp");
  });

  it("--verbose shows per-artifact state icons for drifted skills", async () => {
    const dir = await makeTmpDir();
    const skillDir1 = path.join(dir, ".agents", "skills", "synced-skill");
    const skillDir2 = path.join(dir, ".agents", "skills", "drifted-skill");
    await mkdir(skillDir1, { recursive: true });
    await mkdir(skillDir2, { recursive: true });
    const skill1 = "original content";
    await writeFile(path.join(skillDir1, "SKILL.md"), skill1);
    await writeFile(path.join(skillDir2, "SKILL.md"), "modified content");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: {
              "synced-skill": { hash: computeHash(skill1) },
              "drifted-skill": { hash: "sha256:original-hash" },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("synced-skill");
    expect(output).toContain("drifted-skill");
    expect(output).toContain("✓");
    expect(output).toContain("M");
  });

  // --- Verbose stress tests ---

  it("--verbose on empty project shows no-stacks message", async () => {
    const dir = await makeTmpDir();
    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("No stacks installed");
  });

  it("--verbose with instructions shows file path and state", async () => {
    const dir = await makeTmpDir();
    const instrContent = "Be helpful";
    const claudeMd = insertMarkers("", instrContent, "my-stack", "1.0.0", "claude-code");
    await writeFile(path.join(dir, "CLAUDE.md"), claudeMd);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: computeHash(instrContent) },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("instructions");
    expect(output).toContain("CLAUDE.md");
    expect(output).toContain("✓");
  });

  it("--verbose with drifted instructions shows M state", async () => {
    const dir = await makeTmpDir();
    const originalContent = "Be helpful";
    const modifiedContent = "Be very helpful and thorough";
    const claudeMd = insertMarkers("", modifiedContent, "my-stack", "1.0.0", "claude-code");
    await writeFile(path.join(dir, "CLAUDE.md"), claudeMd);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: computeHash(originalContent) },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("M");
    expect(output).toContain("CLAUDE.md");
  });

  it("--verbose with deleted instructions shows D state", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: "sha256:abc" },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("D");
    expect(output).toContain("instructions");
  });

  it("--verbose with removed-by-user instructions shows R state", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, "CLAUDE.md"), "My own instructions, no markers");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: "sha256:abc" },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("R");
    expect(output).toContain("instructions");
  });

  it("--verbose with missing MCP file shows all servers as deleted", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "mcp-standard": {
            mcp: {
              "server-a": { hash: "sha256:aaa" },
              "server-b": { hash: "sha256:bbb" },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("server-a");
    expect(output).toContain("server-b");
    expect(output).toContain("D");
  });

  it("--verbose with corrupt MCP JSON does not crash", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, ".mcp.json"), "not valid json {{{");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "mcp-standard": {
            mcp: { "my-server": { hash: "sha256:aaa" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("my-stack");
    expect(output).toContain("mcp-standard");
  });

  it("--verbose with empty adapter (no skills, no MCP, no instructions)", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {},
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("claude-code");
    expect(output).not.toMatch(/skill.*SKILL\.md/);
  });

  it("--verbose with multiple stacks and multiple adapters", async () => {
    const dir = await makeTmpDir();

    // Stack A: claude-code with 1 skill, mcp-standard with 1 MCP
    const skillDirA = path.join(dir, ".agents", "skills", "lint");
    await mkdir(skillDirA, { recursive: true });
    const lintContent = "lint rules";
    await writeFile(path.join(skillDirA, "SKILL.md"), lintContent);

    const mcpConfig = { mcpServers: { "db-server": { command: "node", args: ["db.js"] } } };
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify(mcpConfig));

    // Stack B: claude-code with 1 different skill
    const skillDirB = path.join(dir, ".agents", "skills", "deploy");
    await mkdir(skillDirB, { recursive: true });
    const deployContent = "deploy rules";
    await writeFile(path.join(skillDirB, "SKILL.md"), deployContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [
        {
          stack: "team-base",
          stackVersion: "2.0.0",
          source: "github:acme/base",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": {
              skills: { lint: { hash: computeHash(lintContent) } },
            },
            "mcp-standard": {
              mcp: { "db-server": { hash: computeHash(JSON.stringify(mcpConfig.mcpServers["db-server"])) } },
            },
          },
        },
        {
          stack: "deploy-tools",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": {
              skills: { deploy: { hash: computeHash(deployContent) } },
            },
          },
        },
      ],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("team-base");
    expect(output).toContain("deploy-tools");
    expect(output).toContain("lint");
    expect(output).toContain("deploy");
    expect(output).toContain("db-server");
    expect(output).toContain("github:acme/base");
  });

  it("--verbose with all artifact states in one stack", async () => {
    const dir = await makeTmpDir();

    // Synced skill
    const syncedDir = path.join(dir, ".agents", "skills", "synced-one");
    await mkdir(syncedDir, { recursive: true });
    const syncedContent = "synced content";
    await writeFile(path.join(syncedDir, "SKILL.md"), syncedContent);

    // Drifted skill
    const driftedDir = path.join(dir, ".agents", "skills", "drifted-one");
    await mkdir(driftedDir, { recursive: true });
    await writeFile(path.join(driftedDir, "SKILL.md"), "modified");

    // Deleted skill — no file on disk (deleted-one not created)

    // Synced MCP
    const mcpConfig = { mcpServers: { "ok-server": { command: "a" } } };
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify(mcpConfig));

    // Removed-by-user instructions (CLAUDE.md without markers)
    await writeFile(path.join(dir, "CLAUDE.md"), "user content, no markers");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "mixed-stack",
        stackVersion: "3.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: "sha256:old" },
            skills: {
              "synced-one": { hash: computeHash(syncedContent) },
              "drifted-one": { hash: "sha256:original" },
              "deleted-one": { hash: "sha256:gone" },
            },
          },
          "mcp-standard": {
            mcp: { "ok-server": { hash: computeHash(JSON.stringify(mcpConfig.mcpServers["ok-server"])) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("synced-one");
    expect(output).toContain("drifted-one");
    expect(output).toContain("deleted-one");
    expect(output).toContain("ok-server");
    expect(output).toContain("instructions");
    expect(output).toContain("✓");
    expect(output).toContain("M");
    expect(output).toContain("D");
    expect(output).toContain("R");
  });

  it("--verbose with 20 skills renders all of them", async () => {
    const dir = await makeTmpDir();
    const skillNames = Array.from({ length: 20 }, (_, i) => `skill-${String(i).padStart(2, "0")}`);
    const skills: Record<string, { hash: string }> = {};

    for (const name of skillNames) {
      const skillDir = path.join(dir, ".agents", "skills", name);
      await mkdir(skillDir, { recursive: true });
      const content = `content for ${name}`;
      await writeFile(path.join(skillDir, "SKILL.md"), content);
      skills[name] = { hash: computeHash(content) };
    }

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "big-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": { skills },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    for (const name of skillNames) {
      expect(output).toContain(name);
    }
    expect(output).toContain("20 skills");
  });

  it("--json takes precedence over --verbose", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {},
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { json: true, verbose: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stacks");
  });

  it("--verbose shows relative paths, not absolute", async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, ".agents", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    const content = "skill content";
    await writeFile(path.join(skillDir, "SKILL.md"), content);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { "my-skill": { hash: computeHash(content) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain(".agents/skills/my-skill/SKILL.md");
    expect(output).not.toContain(dir);
  });

  it("--short outputs one line per stack", async () => {
    const dir = await makeTmpDir();

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {},
      }],
    };
    await writeManifest(dir, manifest);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(dir, { short: true });

    const calls = spy.mock.calls;
    expect(calls.length).toBe(1);
    const line = calls[0]!.join(" ");
    expect(line).toContain("my-stack");
    spy.mockRestore();
  });
});
