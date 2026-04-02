import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkCommand } from "../../src/commands/check.js";
import { writeManifest, computeHash } from "../../src/core/manifest.js";
import type { InstallManifest } from "../../src/shared/schema.js";

describe("pit check", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-check-"));
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

  /** Helper: write a minimal .promptpit/stack.json */
  async function writeStackJson(
    dir: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const stackDir = path.join(dir, ".promptpit");
    await mkdir(stackDir, { recursive: true });
    const stack = {
      name: "test-stack",
      version: "1.0.0",
      ...overrides,
    };
    await writeFile(path.join(stackDir, "stack.json"), JSON.stringify(stack));
  }

  /** Helper: write a skill into the .promptpit bundle */
  async function writeStackSkill(dir: string, name: string, content: string): Promise<void> {
    const skillDir = path.join(dir, ".promptpit", "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), content);
  }

  /** Helper: write mcp.json into the .promptpit bundle */
  async function writeStackMcp(dir: string, servers: Record<string, unknown>): Promise<void> {
    const stackDir = path.join(dir, ".promptpit");
    await mkdir(stackDir, { recursive: true });
    await writeFile(path.join(stackDir, "mcp.json"), JSON.stringify(servers));
  }

  /** Helper: write a rule into the .promptpit bundle */
  async function writeStackRule(dir: string, name: string, content: string): Promise<void> {
    const rulesDir = path.join(dir, ".promptpit", "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(rulesDir, `${name}.md`), content);
  }

  // --- Exit code tests ---

  it("exits 0 when no stack.json and no manifest (nothing to check)", async () => {
    const dir = await makeTmpDir();
    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(true);
  });

  it("exits 0 when everything is synced", async () => {
    const dir = await makeTmpDir();
    const skillContent = "---\nname: security\ndescription: sec\n---\nrules";

    // Write stack bundle
    await writeStackJson(dir, { skills: ["skills/security"] });
    await writeStackSkill(dir, "security", skillContent);

    // Write installed skill on disk
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skillContent);

    // Write manifest matching the stack
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
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

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(true);
  });

  // --- Freshness tests ---

  it("fails when stack has a skill not in installed.json", async () => {
    const dir = await makeTmpDir();
    const skillContent = "---\nname: security\ndescription: sec\n---\nrules";

    await writeStackJson(dir, { skills: ["skills/security"] });
    await writeStackSkill(dir, "security", skillContent);

    // Manifest exists but has no skills
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: { "claude-code": {} },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues.length).toBeGreaterThan(0);
    expect(result.freshness.issues[0]!.message).toContain("security");
  });

  it("fails when installed version differs from stack version", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir, { version: "2.0.0" });

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {},
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues[0]!.message).toContain("version");
  });

  it("fails when stack exists but was never installed", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir);
    // No installed.json at all

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues[0]!.message).toContain("never been installed");
  });

  it("fails when stack has an agent not in installed.json", async () => {
    const dir = await makeTmpDir();
    const agentContent = "---\nname: reviewer\ndescription: Reviews code carefully\n---\nReview code.";

    await writeStackJson(dir);
    // Write agent into the stack bundle at .promptpit/agents/reviewer.md
    const agentDir = path.join(dir, ".promptpit", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "reviewer.md"), agentContent);

    // Manifest exists but has no agents
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: { "claude-code": {} },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues.some((i) => i.message.includes("reviewer"))).toBe(true);
  });

  it("fails when stack has a rule not in installed.json", async () => {
    const dir = await makeTmpDir();
    const ruleContent = "---\nname: linting\ndescription: Linting rules\nalwaysApply: true\n---\n\nNo unused vars.";

    await writeStackJson(dir);
    await writeStackRule(dir, "linting", ruleContent);

    // Manifest exists but has no rules recorded
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: { "claude-code": {} },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues.some((i) => i.message.includes("linting"))).toBe(true);
  });

  it("fails when stack has MCP server not in installed.json", async () => {
    const dir = await makeTmpDir();
    const mcpServers = { "my-server": { command: "node", args: ["s.js"] } };

    await writeStackJson(dir);
    await writeStackMcp(dir, mcpServers);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: { "mcp-standard": {} },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.freshness.pass).toBe(false);
    expect(result.freshness.issues.some((i) => i.message.includes("my-server"))).toBe(true);
  });

  // --- Drift tests ---

  it("fails when a skill file is deleted", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir, { skills: ["skills/security"] });
    await writeStackSkill(dir, "security", "content");

    // Manifest says skill exists, but no file on disk
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
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

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.drift.pass).toBe(false);
    expect(result.drift.issues.some((i) => i.type === "deleted")).toBe(true);
  });

  it("fails when instructions have drifted", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir);

    // CLAUDE.md with markers but different content
    const { insertMarkers } = await import("../../src/shared/markers.js");
    const claudeMd = insertMarkers("", "modified instructions", "test-stack", "1.0.0", "claude-code");
    await writeFile(path.join(dir, "CLAUDE.md"), claudeMd);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: computeHash("original instructions") },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.drift.pass).toBe(false);
    expect(result.drift.issues.some((i) => i.type === "drifted" && i.artifact === "instructions")).toBe(true);
  });

  it("fails when MCP server config drifted", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir);

    // .mcp.json with different config than recorded hash
    const mcpConfig = { mcpServers: { "my-server": { command: "node", args: ["changed.js"] } } };
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify(mcpConfig));

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "mcp-standard": {
            mcp: { "my-server": { hash: "sha256:original-hash" } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(false);
    expect(result.drift.pass).toBe(false);
  });

  // --- Edge cases ---

  it("skips freshness when no stack.json exists (remote-only install)", async () => {
    const dir = await makeTmpDir();
    const skillContent = "skill content";

    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skillContent);

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "remote-stack",
        stackVersion: "1.0.0",
        source: "github:acme/stack",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: computeHash(skillContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const result = await checkCommand(dir, {});
    expect(result.pass).toBe(true);
    expect(result.freshness.skipped).toBe(true);
  });

  // --- JSON output ---

  it("--json produces valid JSON with correct structure", async () => {
    const dir = await makeTmpDir();
    await writeStackJson(dir);

    const output = await captureOutput(() =>
      checkCommand(dir, { json: true }).then(() => {}),
    );
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("pass");
    expect(parsed).toHaveProperty("freshness");
    expect(parsed).toHaveProperty("drift");
    expect(parsed.freshness).toHaveProperty("pass");
    expect(parsed.drift).toHaveProperty("pass");
  });
});
