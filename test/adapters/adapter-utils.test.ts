import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeWithMarkers } from "../../src/adapters/adapter-utils.js";

describe("writeWithMarkers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-markers-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates file with markers when no existing file", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "New instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("New instructions");
    expect(content).toContain("promptpit:end:my-stack");
  });

  it("inserts markers when existing file has no markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(filePath, "# Existing content\n\nKeep this.\n");
    const result = await writeWithMarkers(
      filePath,
      "Stack instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Existing content");
    expect(content).toContain("Keep this.");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("Stack instructions");
  });

  it("replaces marker content when existing file has markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(
      filePath,
      "# Header\n\n<!-- promptpit:start:my-stack:0.9.0:claude-code -->\nOld content\n<!-- promptpit:end:my-stack -->\n",
    );
    const result = await writeWithMarkers(
      filePath,
      "Updated content",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Header");
    expect(content).toContain("Updated content");
    expect(content).not.toContain("Old content");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
  });

  it("skips write when dryRun is true", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "Content",
      "my-stack",
      "1.0.0",
      "claude-code",
      true,
    );
    expect(result).toBeNull();
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();
  });

  it("handles empty content string", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack");
    expect(content).toContain("promptpit:end:my-stack");
  });
});
