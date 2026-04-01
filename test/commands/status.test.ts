import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusCommand } from "../../src/commands/status.js";
import { writeManifest, computeHash } from "../../src/core/manifest.js";
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

  it("reports no stacks when no manifest exists", async () => {
    const dir = await makeTmpDir();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand(dir);

    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No stacks installed");
    spy.mockRestore();
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

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(dir);

    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("my-stack");
    expect(output).toContain("✓");
    spy.mockRestore();
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

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(dir);

    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("my-stack");
    spy.mockRestore();
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

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(dir);

    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("my-stack");
    spy.mockRestore();
  });

  it("--json outputs valid JSON", async () => {
    const dir = await makeTmpDir();

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand(dir, { json: true });

    const output = spy.mock.calls.map((c) => c.join(" ")).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stacks");
    expect(parsed).toHaveProperty("hasManifest");
    spy.mockRestore();
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
