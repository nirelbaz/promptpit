import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readManifest,
  writeManifest,
  upsertInstall,
  computeHash,
  normalizeForHash,
  emptyManifest,
} from "../../src/core/manifest.js";
import type { InstallManifest, InstallEntry } from "../../src/shared/schema.js";

describe("manifest", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-manifest-"));
    tmpDirs.push(dir);
    return dir;
  }

  const sampleEntry: InstallEntry = {
    stack: "my-stack",
    stackVersion: "1.0.0",
    source: "github:team/stack",
    installedAt: "2026-03-31T10:00:00Z",
    adapters: {
      "claude-code": {
        instructions: { hash: "sha256:abc123" },
        skills: { security: { hash: "sha256:def456" } },
      },
    },
  };

  describe("readManifest", () => {
    it("returns empty manifest when file doesn't exist", async () => {
      const dir = await makeTmpDir();
      const manifest = await readManifest(dir);
      expect(manifest.version).toBe(1);
      expect(manifest.installs).toEqual([]);
    });

    it("reads valid manifest", async () => {
      const dir = await makeTmpDir();
      const manifestDir = path.join(dir, ".promptpit");
      await mkdir(manifestDir, { recursive: true });
      const data: InstallManifest = {
        version: 1,
        installs: [sampleEntry],
      };
      await writeFile(
        path.join(manifestDir, "installed.json"),
        JSON.stringify(data),
      );

      const manifest = await readManifest(dir);
      expect(manifest.installs).toHaveLength(1);
      expect(manifest.installs[0]!.stack).toBe("my-stack");
    });

    it("throws on invalid JSON", async () => {
      const dir = await makeTmpDir();
      const manifestDir = path.join(dir, ".promptpit");
      await mkdir(manifestDir, { recursive: true });
      await writeFile(
        path.join(manifestDir, "installed.json"),
        "not json at all",
      );

      await expect(readManifest(dir)).rejects.toThrow("invalid JSON");
    });

    it("throws on invalid schema", async () => {
      const dir = await makeTmpDir();
      const manifestDir = path.join(dir, ".promptpit");
      await mkdir(manifestDir, { recursive: true });
      await writeFile(
        path.join(manifestDir, "installed.json"),
        JSON.stringify({ version: 99, installs: [] }),
      );

      await expect(readManifest(dir)).rejects.toThrow("Invalid manifest");
    });
  });

  describe("writeManifest", () => {
    it("writes manifest atomically (via temp + rename)", async () => {
      const dir = await makeTmpDir();
      const manifest: InstallManifest = {
        version: 1,
        installs: [sampleEntry],
      };

      await writeManifest(dir, manifest);

      const content = await readFile(
        path.join(dir, ".promptpit", "installed.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.installs[0].stack).toBe("my-stack");
    });

    it("no .tmp file remains after write", async () => {
      const dir = await makeTmpDir();
      await writeManifest(dir, emptyManifest());

      const { readdir } = await import("node:fs/promises");
      const files = await readdir(path.join(dir, ".promptpit"));
      expect(files).not.toContain("installed.json.tmp");
    });
  });

  describe("upsertInstall", () => {
    it("appends new stack", () => {
      const manifest = emptyManifest();
      const updated = upsertInstall(manifest, sampleEntry);
      expect(updated.installs).toHaveLength(1);
    });

    it("replaces same stack name", () => {
      const manifest: InstallManifest = {
        version: 1,
        installs: [sampleEntry],
      };
      const newEntry = { ...sampleEntry, stackVersion: "2.0.0" };
      const updated = upsertInstall(manifest, newEntry);
      expect(updated.installs).toHaveLength(1);
      expect(updated.installs[0]!.stackVersion).toBe("2.0.0");
    });

    it("keeps different stack names as separate entries", () => {
      const manifest: InstallManifest = {
        version: 1,
        installs: [sampleEntry],
      };
      const otherEntry = { ...sampleEntry, stack: "other-stack" };
      const updated = upsertInstall(manifest, otherEntry);
      expect(updated.installs).toHaveLength(2);
    });
  });

  describe("computeHash", () => {
    it("returns sha256 prefixed hash", () => {
      const hash = computeHash("hello world");
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("produces consistent hashes", () => {
      expect(computeHash("test")).toBe(computeHash("test"));
    });

    it("produces different hashes for different content", () => {
      expect(computeHash("a")).not.toBe(computeHash("b"));
    });
  });

  describe("normalizeForHash", () => {
    it("trims and collapses whitespace", () => {
      expect(normalizeForHash("  hello   world  ")).toBe("hello world");
    });

    it("treats different whitespace as equivalent", () => {
      const a = normalizeForHash("hello\n\nworld");
      const b = normalizeForHash("hello  world");
      expect(a).toBe(b);
    });
  });
});
