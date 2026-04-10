import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusCommand, computeStatus } from "../../src/commands/status.js";
import { writeManifest, computeHash, computeMcpServerHash } from "../../src/core/manifest.js";
import { insertMarkers } from "../../src/shared/markers.js";
import { writeMcpToToml } from "../../src/adapters/toml-utils.js";
import { installStack } from "../../src/commands/install.js";
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
    expect(output).toContain(".agents/skills/");
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
          "standards": {
            mcp: { "my-server": { hash: computeMcpServerHash(mcpConfig.mcpServers["my-server"] as Record<string, unknown>) } },
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
          "standards": {
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
          "standards": {
            mcp: { "my-server": { hash: "sha256:aaa" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("my-stack");
    expect(output).toContain("standards");
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

    // Stack A: claude-code with 1 skill, standards with 1 MCP
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
            "standards": {
              mcp: { "db-server": { hash: computeMcpServerHash(mcpConfig.mcpServers["db-server"] as Record<string, unknown>) } },
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
          "standards": {
            mcp: { "ok-server": { hash: computeMcpServerHash(mcpConfig.mcpServers["ok-server"] as Record<string, unknown>) } },
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
    expect(output).toContain(".agents/skills/my-skill");
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

  // --- MCP drift detection per adapter ---

  it("reports synced for Codex TOML MCP immediately after install", async () => {
    const dir = await makeTmpDir();

    // Write MCP in TOML format (as Codex adapter does)
    const servers = {
      context7: { command: "npx", args: ["-y", "@context7/mcp"], env: { API_KEY: "test" } },
      playwright: { command: "npx", args: ["@playwright/mcp"] },
    };
    const tomlContent = writeMcpToToml("", servers);
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), tomlContent);

    // Manifest with canonical hashes (as install.ts now computes them)
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          codex: {
            mcp: {
              context7: { hash: computeMcpServerHash(servers.context7 as unknown as Record<string, unknown>) },
              playwright: { hash: computeMcpServerHash(servers.playwright as unknown as Record<string, unknown>) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const codexAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "codex")!;
    expect(codexAdapter.state).toBe("synced");
    for (const mcp of codexAdapter.mcpDetails) {
      expect(mcp.state).toBe("synced");
    }
  });

  it("reports synced for Copilot MCP immediately after install", async () => {
    const dir = await makeTmpDir();

    // Write MCP in Copilot format (servers key + type field)
    const originalServers = {
      context7: { command: "npx", args: ["-y", "@context7/mcp"] },
    };
    const copilotMcp = {
      servers: {
        context7: { type: "stdio", command: "npx", args: ["-y", "@context7/mcp"] },
      },
    };
    await mkdir(path.join(dir, ".vscode"), { recursive: true });
    await writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify(copilotMcp));

    // Manifest with canonical hashes (from original config, no type field)
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            mcp: {
              context7: { hash: computeMcpServerHash(originalServers.context7 as unknown as Record<string, unknown>) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilotAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(copilotAdapter.state).toBe("synced");
    for (const mcp of copilotAdapter.mcpDetails) {
      expect(mcp.state).toBe("synced");
    }
  });

  it("detects real drift in Codex TOML MCP", async () => {
    const dir = await makeTmpDir();

    const originalServers = {
      context7: { command: "npx", args: ["-y", "@context7/mcp"] },
    };
    // Write modified TOML (different args)
    const modifiedServers = {
      context7: { command: "npx", args: ["-y", "@context7/mcp", "--modified"] },
    };
    const tomlContent = writeMcpToToml("", modifiedServers);
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), tomlContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          codex: {
            mcp: {
              context7: { hash: computeMcpServerHash(originalServers.context7 as unknown as Record<string, unknown>) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const codexAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "codex")!;
    expect(codexAdapter.state).toBe("drifted");
    expect(codexAdapter.mcpDetails[0]!.state).toBe("drifted");
  });

  // --- Agent drift detection ---

  it("reports synced when agent hash matches", async () => {
    const dir = await makeTmpDir();
    const agentDir = path.join(dir, ".claude", "agents");
    await mkdir(agentDir, { recursive: true });
    const agentContent = "---\nname: reviewer\ndescription: code reviewer\n---\nReview code carefully.";
    await writeFile(path.join(agentDir, "reviewer.md"), agentContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            agents: { reviewer: { hash: computeHash(agentContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code")!;
    expect(adapter.state).toBe("synced");
    expect(adapter.agentDetails[0]!.state).toBe("synced");
    expect(adapter.agentCount).toBe(1);
  });

  it("reports drifted when agent file is modified on disk", async () => {
    const dir = await makeTmpDir();
    const agentDir = path.join(dir, ".claude", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "reviewer.md"), "modified agent content");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            agents: { reviewer: { hash: "sha256:original-hash" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code")!;
    expect(adapter.state).toBe("drifted");
    expect(adapter.agentDetails[0]!.state).toBe("drifted");
  });

  it("reports deleted when agent file is missing from disk", async () => {
    const dir = await makeTmpDir();
    // No .claude/agents/ directory — agent file does not exist

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            agents: { reviewer: { hash: "sha256:abc" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code")!;
    expect(adapter.state).toBe("deleted");
    expect(adapter.agentDetails[0]!.state).toBe("deleted");
  });

  it("reports synced for Copilot agent using .agent.md extension", async () => {
    const dir = await makeTmpDir();
    const agentDir = path.join(dir, ".github", "agents");
    await mkdir(agentDir, { recursive: true });
    const agentContent = "---\nname: reviewer\n---\nReview code.";
    await writeFile(path.join(agentDir, "reviewer.agent.md"), agentContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            agents: { reviewer: { hash: computeHash(agentContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(adapter.state).toBe("synced");
    expect(adapter.agentDetails[0]!.state).toBe("synced");
  });

  it("--verbose shows agent names and paths", async () => {
    const dir = await makeTmpDir();
    const agentDir = path.join(dir, ".claude", "agents");
    await mkdir(agentDir, { recursive: true });
    const agentContent = "---\nname: tester\n---\nRun tests.";
    await writeFile(path.join(agentDir, "tester.md"), agentContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            agents: { tester: { hash: computeHash(agentContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => statusCommand(dir, { verbose: true }));
    expect(output).toContain("tester");
    expect(output).toContain("agent");
    expect(output).toContain(".claude/agents/tester.md");
  });

  it("codex reports per-file agent drift for native TOML agents", async () => {
    const dir = await makeTmpDir();
    // Codex is a native adapter — agents are .codex/agents/*.toml files

    // Create the agent TOML file with content that won't match the stored hash
    const agentsDir = path.join(dir, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "reviewer.toml"), 'name = "reviewer"\ndescription = "Code reviewer"\n');

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          codex: {
            agents: { reviewer: { hash: "sha256:mismatched" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "codex")!;
    // Native adapter checks per-file agents — should detect drift (hash mismatch)
    expect(adapter.agentDetails).toHaveLength(1);
    expect(adapter.agentDetails[0].state).toBe("drifted");
  });

  it("detects real drift in Copilot MCP", async () => {
    const dir = await makeTmpDir();

    const originalServers = {
      context7: { command: "npx", args: ["-y", "@context7/mcp"] },
    };
    // Write modified Copilot MCP (different args)
    const copilotMcp = {
      servers: {
        context7: { type: "stdio", command: "npx", args: ["-y", "@context7/mcp", "--modified"] },
      },
    };
    await mkdir(path.join(dir, ".vscode"), { recursive: true });
    await writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify(copilotMcp));

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            mcp: {
              context7: { hash: computeMcpServerHash(originalServers.context7 as unknown as Record<string, unknown>) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilotAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(copilotAdapter.state).toBe("drifted");
    expect(copilotAdapter.mcpDetails[0]!.state).toBe("drifted");
  });

  it("detects synced copilot agent using .agent.md extension", async () => {
    const dir = await makeTmpDir();
    const agentContent = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n";

    // Write the agent file at the Copilot-native path
    const agentsDir = path.join(dir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "reviewer.agent.md"), agentContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            agents: { reviewer: { hash: computeHash(agentContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilotAdapterStatus = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(copilotAdapterStatus.agentDetails).toHaveLength(1);
    expect(copilotAdapterStatus.agentDetails[0]!.state).toBe("synced");
    expect(copilotAdapterStatus.agentDetails[0]!.path).toContain(".agent.md");
  });

  it("copilot agent synced when manifest stores translated hash", async () => {
    // BUG 11 fix: install must hash agentToGitHubAgent() output, not source content
    const { agentToGitHubAgent } = await import("../../src/adapters/copilot.js");
    const dir = await makeTmpDir();
    const sourceContent = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\nmodel: o3\n---\n\nReview code.\n";
    const translated = agentToGitHubAgent(sourceContent);

    const agentsDir = path.join(dir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "reviewer.agent.md"), translated);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            agents: { reviewer: { hash: computeHash(translated) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilot = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(copilot.agentDetails[0]!.state).toBe("synced");
  });

  it("inline-agent instructions synced when manifest stores buildInlineContent hash", async () => {
    // BUG 11 fix: inline-agent adapters embed agents in marker block
    const { buildInlineContent } = await import("../../src/adapters/adapter-utils.js");
    const dir = await makeTmpDir();
    const instructions = "Use TypeScript.";
    const agents = [{
      name: "helper",
      path: "agents/helper",
      frontmatter: { name: "helper", description: "General helper" },
      content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
    }];
    const inlineContent = buildInlineContent(instructions, agents)!;
    const agentsMd = insertMarkers("", inlineContent, "my-stack", "1.0.0", "standards");
    await writeFile(path.join(dir, "AGENTS.md"), agentsMd);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          standards: {
            instructions: { hash: computeHash(inlineContent) },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const standards = result.stacks[0]!.adapters.find((a) => a.adapterId === "standards")!;
    expect(standards.instructionDetail!.state).toBe("synced");
  });

  it("detects drifted copilot agent when .agent.md content changes", async () => {
    const dir = await makeTmpDir();
    const originalContent = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nOriginal body.\n";
    const modifiedContent = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nModified body.\n";

    const agentsDir = path.join(dir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    // Write modified content on disk but record the original hash
    await writeFile(path.join(agentsDir, "reviewer.agent.md"), modifiedContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            agents: { reviewer: { hash: computeHash(originalContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilotAdapterStatus = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
    expect(copilotAdapterStatus.agentDetails[0]!.state).toBe("drifted");
  });

  // --- Command drift detection ---

  describe("command drift detection", () => {
    it("detects synced commands", async () => {
      const tmpDir = await makeTmpDir();
      await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Test");
      const stackDir = path.resolve("test/__fixtures__/stacks/valid-stack");
      await installStack(stackDir, tmpDir, {});

      const result = await computeStatus(tmpDir);
      expect(result.stacks).toHaveLength(1);
      const claudeAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code");
      expect(claudeAdapter!.commandCount).toBeGreaterThan(0);
      expect(claudeAdapter!.state).toBe("synced");
    });

    it("detects drifted commands", async () => {
      const tmpDir = await makeTmpDir();
      await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Test");
      const stackDir = path.resolve("test/__fixtures__/stacks/valid-stack");
      await installStack(stackDir, tmpDir, {});

      await writeFile(
        path.join(tmpDir, ".claude", "commands", "review.md"),
        "MODIFIED content",
      );

      const result = await computeStatus(tmpDir);
      const claudeAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code");
      expect(claudeAdapter!.state).not.toBe("synced");
    });

    it("detects deleted commands", async () => {
      const tmpDir = await makeTmpDir();
      const commandContent = "Deploy: $ARGUMENTS";
      const manifest: InstallManifest = {
        version: 1,
        installs: [{
          stack: "my-stack",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": {
              commands: { review: { hash: computeHash(commandContent) } },
            },
          },
        }],
      };
      await writeManifest(tmpDir, manifest);

      const result = await computeStatus(tmpDir);
      const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "claude-code")!;
      expect(adapter.commandCount).toBe(1);
      expect(adapter.state).toBe("deleted");
      expect(adapter.commandDetails[0]!.state).toBe("deleted");
    });

    it("detects synced copilot commands using .prompt.md extension via prompts path", async () => {
      // Copilot uses paths.prompts → .github/prompts/ with .prompt.md extension
      const tmpDir = await makeTmpDir();
      const commandContent = "Deploy the app\n";
      await mkdir(path.join(tmpDir, ".github", "prompts"), { recursive: true });
      await writeFile(path.join(tmpDir, ".github", "prompts", "deploy.prompt.md"), commandContent);

      const manifest: InstallManifest = {
        version: 1,
        installs: [{
          stack: "my-stack",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            copilot: {
              commands: { deploy: { hash: computeHash(commandContent) } },
            },
          },
        }],
      };
      await writeManifest(tmpDir, manifest);

      const result = await computeStatus(tmpDir);
      const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
      expect(adapter.commandCount).toBe(1);
      expect(adapter.state).toBe("synced");
      expect(adapter.commandDetails[0]!.state).toBe("synced");
      // Verify the .prompt.md extension was used for the path
      expect(adapter.commandDetails[0]!.path).toContain(".prompt.md");
    });

    it("detects drifted copilot commands with .prompt.md extension", async () => {
      const tmpDir = await makeTmpDir();
      const originalContent = "Deploy the app\n";
      const modifiedContent = "Deploy to staging\n";
      await mkdir(path.join(tmpDir, ".github", "prompts"), { recursive: true });
      await writeFile(path.join(tmpDir, ".github", "prompts", "deploy.prompt.md"), modifiedContent);

      const manifest: InstallManifest = {
        version: 1,
        installs: [{
          stack: "my-stack",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            copilot: {
              commands: { deploy: { hash: computeHash(originalContent) } },
            },
          },
        }],
      };
      await writeManifest(tmpDir, manifest);

      const result = await computeStatus(tmpDir);
      const adapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot")!;
      expect(adapter.state).toBe("drifted");
      expect(adapter.commandDetails[0]!.state).toBe("drifted");
    });

    it("--verbose shows command names and paths", async () => {
      const tmpDir = await makeTmpDir();
      const commandContent = "Review the code: $ARGUMENTS\n";
      await mkdir(path.join(tmpDir, ".claude", "commands"), { recursive: true });
      await writeFile(path.join(tmpDir, ".claude", "commands", "review.md"), commandContent);

      const manifest: InstallManifest = {
        version: 1,
        installs: [{
          stack: "my-stack",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": {
              commands: { review: { hash: computeHash(commandContent) } },
            },
          },
        }],
      };
      await writeManifest(tmpDir, manifest);

      const output = await captureOutput(() => statusCommand(tmpDir, { verbose: true }));
      expect(output).toContain("review");
      expect(output).toContain("command");
      expect(output).toContain(".claude/commands/review.md");
    });

    it("formatAdapterSummary includes command count in output", async () => {
      const tmpDir = await makeTmpDir();
      const commandContent = "Run tests\n";
      await mkdir(path.join(tmpDir, ".claude", "commands"), { recursive: true });
      await writeFile(path.join(tmpDir, ".claude", "commands", "test.md"), commandContent);

      const manifest: InstallManifest = {
        version: 1,
        installs: [{
          stack: "my-stack",
          stackVersion: "1.0.0",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": {
              commands: { test: { hash: computeHash(commandContent) } },
            },
          },
        }],
      };
      await writeManifest(tmpDir, manifest);

      // Default (non-verbose) output also shows summary line with command count
      const output = await captureOutput(() => statusCommand(tmpDir));
      expect(output).toContain("command");
    });
  });

  it("finds cursor rules at unprefixed path when rule- prefixed path does not exist", async () => {
    const dir = await makeTmpDir();

    // Rule written to unprefixed path (as BUG 24 dedup fix does)
    const rulesDir = path.join(dir, ".cursor", "rules");
    await mkdir(rulesDir, { recursive: true });
    const ruleContent = "---\ndescription: Testing conventions\nglobs:\n  - \"**/*.test.ts\"\n---\n\nUse vitest.\n";
    await writeFile(path.join(rulesDir, "testing.mdc"), ruleContent);
    await writeFile(path.join(dir, ".cursorrules"), "");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          cursor: {
            rules: { testing: { hash: computeHash(ruleContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const cursorAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "cursor");
    expect(cursorAdapter).toBeDefined();
    const ruleDetail = cursorAdapter!.ruleDetails?.find((r) => r.name === "testing");
    expect(ruleDetail).toBeDefined();
    expect(ruleDetail!.state).toBe("synced");
  });

  it("finds copilot rules at unprefixed path when rule- prefixed path does not exist", async () => {
    const dir = await makeTmpDir();

    // Rule written to unprefixed path (as BUG 24 dedup fix does)
    const instDir = path.join(dir, ".github", "instructions");
    await mkdir(instDir, { recursive: true });
    const ruleContent = "---\napplyTo: \"**/*.test.ts\"\n---\n\nUse vitest.\n";
    await writeFile(path.join(instDir, "testing.instructions.md"), ruleContent);
    await writeFile(path.join(dir, ".github", "copilot-instructions.md"), "# Test");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "my-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          copilot: {
            rules: { testing: { hash: computeHash(ruleContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await computeStatus(dir);
    const copilotAdapter = result.stacks[0]!.adapters.find((a) => a.adapterId === "copilot");
    expect(copilotAdapter).toBeDefined();
    const ruleDetail = copilotAdapter!.ruleDetails?.find((r) => r.name === "testing");
    expect(ruleDetail).toBeDefined();
    expect(ruleDetail!.state).toBe("synced");
  });
});
