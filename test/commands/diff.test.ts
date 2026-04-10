import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { diffCommand, computeDiff } from "../../src/commands/diff.js";
import { writeManifest, computeHash, computeMcpServerHash } from "../../src/core/manifest.js";
import { insertMarkers } from "../../src/shared/markers.js";
import type { InstallManifest } from "../../src/shared/schema.js";

describe("pit diff", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-diff-"));
    tmpDirs.push(dir);
    return dir;
  }

  async function captureOutput(fn: () => Promise<unknown>): Promise<string> {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await fn();
      return spy.mock.calls.map((c) => c.join(" ")).join("\n");
    } finally {
      spy.mockRestore();
    }
  }

  /** Write .promptpit/stack.json and optional skill/instruction files. */
  async function setupStack(
    dir: string,
    opts: {
      instructions?: string;
      skills?: Array<{ name: string; content: string }>;
    },
  ): Promise<void> {
    const ppDir = path.join(dir, ".promptpit");
    await mkdir(ppDir, { recursive: true });

    const stackJson = {
      name: "test-stack",
      version: "1.0.0",
      description: "test",
    };
    await writeFile(path.join(ppDir, "stack.json"), JSON.stringify(stackJson));

    if (opts.instructions) {
      const frontmatter = "---\nname: test-stack\ndescription: test\n---\n\n";
      await writeFile(
        path.join(ppDir, "agent.promptpit.md"),
        frontmatter + opts.instructions,
      );
    }

    if (opts.skills) {
      for (const skill of opts.skills) {
        const skillDir = path.join(ppDir, "skills", skill.name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
      }
    }
  }

  it("prints 'all in sync' when no drift", async () => {
    const dir = await makeTmpDir();
    const skillContent = "---\nname: security\ndescription: sec\n---\noriginal rules";
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skillContent);

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

    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("All artifacts in sync");
  });

  it("shows unified diff for drifted skill", async () => {
    const dir = await makeTmpDir();
    const originalContent = "---\nname: security\ndescription: sec\n---\noriginal rules";
    const modifiedContent = "---\nname: security\ndescription: sec\n---\nmodified rules";

    // Install modified content on disk
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), modifiedContent);

    // Set up source stack with original content
    await setupStack(dir, {
      skills: [{ name: "security", content: originalContent }],
    });

    // Manifest records original hash (so reconcile detects drift)
    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: computeHash(originalContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("-original rules");
    expect(output).toContain("+modified rules");
  });

  it("shows note for deleted artifact", async () => {
    const dir = await makeTmpDir();

    // No skill file on disk — it's been deleted
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

    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("deleted");
    expect(output).toContain("pit install");
  });

  it("filters by --type", async () => {
    const dir = await makeTmpDir();

    // Set up drifted skill
    const originalSkill = "---\nname: security\ndescription: sec\n---\noriginal";
    const modifiedSkill = "---\nname: security\ndescription: sec\n---\nmodified";
    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), modifiedSkill);

    // Set up drifted instructions
    const originalInstr = "Be helpful";
    const modifiedInstr = "Be very helpful";
    const claudeMd = insertMarkers("", modifiedInstr, "test-stack", "1.0.0", "claude-code");
    await writeFile(path.join(dir, "CLAUDE.md"), claudeMd);

    await setupStack(dir, {
      instructions: originalInstr,
      skills: [{ name: "security", content: originalSkill }],
    });

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: computeHash(originalInstr) },
            skills: { security: { hash: computeHash(originalSkill) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => diffCommand(dir, { type: "skill" }));
    expect(output).toContain("security");
    expect(output).not.toContain("instructions");
  });

  it("filters by artifact name", async () => {
    const dir = await makeTmpDir();

    // Two drifted skills
    const originalAlpha = "---\nname: alpha\ndescription: a\n---\nalpha original";
    const modifiedAlpha = "---\nname: alpha\ndescription: a\n---\nalpha modified";
    const originalBeta = "---\nname: beta\ndescription: b\n---\nbeta original";
    const modifiedBeta = "---\nname: beta\ndescription: b\n---\nbeta modified";

    const alphaDir = path.join(dir, ".agents", "skills", "alpha");
    const betaDir = path.join(dir, ".agents", "skills", "beta");
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });
    await writeFile(path.join(alphaDir, "SKILL.md"), modifiedAlpha);
    await writeFile(path.join(betaDir, "SKILL.md"), modifiedBeta);

    await setupStack(dir, {
      skills: [
        { name: "alpha", content: originalAlpha },
        { name: "beta", content: originalBeta },
      ],
    });

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: {
              alpha: { hash: computeHash(originalAlpha) },
              beta: { hash: computeHash(originalBeta) },
            },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => diffCommand(dir, { name: "alpha" }));
    expect(output).toContain("alpha");
    expect(output).not.toContain("beta");
  });

  it("--json outputs valid JSON with diff strings", async () => {
    const dir = await makeTmpDir();
    const originalContent = "---\nname: security\ndescription: sec\n---\noriginal rules";
    const modifiedContent = "---\nname: security\ndescription: sec\n---\nmodified rules";

    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), modifiedContent);

    await setupStack(dir, {
      skills: [{ name: "security", content: originalContent }],
    });

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { security: { hash: computeHash(originalContent) } },
          },
        },
      }],
    };
    await writeManifest(dir, manifest);

    const output = await captureOutput(() => diffCommand(dir, { json: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stacks");
    expect(parsed).toHaveProperty("hasDrift", true);
    expect(parsed).toHaveProperty("hasManifest", true);
    // Find the drifted artifact's diff string
    const artifact = parsed.stacks[0].adapters[0].artifacts[0];
    expect(artifact.diff).toBeDefined();
    expect(artifact.diff).toContain("-original rules");
    expect(artifact.diff).toContain("+modified rules");
  });

  it("reports no stacks when nothing installed", async () => {
    const dir = await makeTmpDir();
    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("No stacks installed");
  });

  it("shows note for removed-by-user artifact", async () => {
    const dir = await makeTmpDir();
    const instrContent = "Be helpful";

    await setupStack(dir, { instructions: instrContent });

    // Write a CLAUDE.md WITHOUT markers — simulates user stripping them
    await writeFile(path.join(dir, "CLAUDE.md"), "User's own content, markers removed");

    await writeManifest(dir, {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            instructions: { hash: computeHash(instrContent.trim()) },
          },
        },
      }],
    });

    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("removed by user");
  });

  it("filters by --adapter", async () => {
    const dir = await makeTmpDir();
    const skillContent = "skill content";

    await setupStack(dir, { skills: [{ name: "sec", content: skillContent }] });

    // Install with both claude-code and standards adapters tracking the skill
    const skillDir = path.join(dir, ".agents", "skills", "sec");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "modified skill");

    await writeManifest(dir, {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { sec: { hash: computeHash(skillContent) } },
          },
          "standards": {
            skills: { sec: { hash: computeHash(skillContent) } },
          },
        },
      }],
    });

    const output = await captureOutput(() => diffCommand(dir, { adapter: "standards" }));
    expect(output).toContain("standards");
    expect(output).not.toContain("claude-code");
  });

  it("shows diff for drifted MCP server", async () => {
    const dir = await makeTmpDir();
    const originalServer = { command: "node", args: ["server.js"] } as Record<string, unknown>;
    const modifiedServer = { command: "node", args: ["server.js", "--debug"] };

    // Setup stack with MCP
    const ppDir = path.join(dir, ".promptpit");
    await mkdir(ppDir, { recursive: true });
    await writeFile(path.join(ppDir, "stack.json"), JSON.stringify({
      name: "test-stack", version: "1.0.0", description: "test",
    }));
    await writeFile(path.join(ppDir, "mcp.json"), JSON.stringify({ myserver: originalServer }));

    // Write modified .mcp.json (standards adapter reads from root .mcp.json with mcpServers key)
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: { myserver: modifiedServer },
    }));

    await writeManifest(dir, {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "standards": {
            mcp: { myserver: { hash: computeMcpServerHash(originalServer) } },
          },
        },
      }],
    });

    const output = await captureOutput(() => diffCommand(dir, {}));
    expect(output).toContain("myserver");
    expect(output).toContain("--debug");
  });

  it("--json outputs valid JSON when all synced", async () => {
    const dir = await makeTmpDir();
    const skillContent = "---\nname: sec\ndescription: sec\n---\nrules";

    await setupStack(dir, { skills: [{ name: "sec", content: skillContent }] });

    const skillDir = path.join(dir, ".agents", "skills", "sec");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skillContent);

    await writeManifest(dir, {
      version: 1,
      installs: [{
        stack: "test-stack",
        stackVersion: "1.0.0",
        installedAt: new Date().toISOString(),
        adapters: {
          "claude-code": {
            skills: { sec: { hash: computeHash(skillContent) } },
          },
        },
      }],
    });

    const output = await captureOutput(() => diffCommand(dir, { json: true }));
    const parsed = JSON.parse(output);
    expect(parsed.hasDrift).toBe(false);
    // Stack exists but no adapters have drifted artifacts
    expect(parsed.stacks[0].adapters).toEqual([]);
  });

  it("hasDrift is true when drifted artifacts found", async () => {
    const dir = await makeTmpDir();

    const skillDir = path.join(dir, ".agents", "skills", "security");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "modified content");

    const manifest: InstallManifest = {
      version: 1,
      installs: [{
        stack: "test-stack",
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

    const result = await computeDiff(dir, {});
    expect(result.hasDrift).toBe(true);
  });
});
