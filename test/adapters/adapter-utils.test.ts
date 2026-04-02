import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeWithMarkers, readAgentsFromDir, formatAgentsInlineSection } from "../../src/adapters/adapter-utils.js";
import type { AgentEntry } from "../../src/shared/schema.js";

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
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(false);
    expect(result.content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(result.content).toContain("New instructions");
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
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(true);
    expect(result.content).toContain("# Existing content");
    expect(result.content).toContain("Stack instructions");
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
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(true);
    expect(result.oldContent).toContain("Old content");
    expect(result.content).toContain("Updated content");
    expect(result.content).not.toContain("Old content");
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
    expect(result.written).toBeNull();
    expect(result.existed).toBe(false);
    expect(result.content).toContain("promptpit:start:my-stack");
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();
  });

  it("returns oldContent for verbose dry-run diffs", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(filePath, "# Old\n");
    const result = await writeWithMarkers(
      filePath,
      "new content",
      "s",
      "1.0",
      "a",
      true,
    );
    expect(result.written).toBeNull();
    expect(result.existed).toBe(true);
    expect(result.oldContent).toBe("# Old\n");
    expect(result.content).toContain("new content");
    // File should not be modified
    const onDisk = await readFile(filePath, "utf-8");
    expect(onDisk).toBe("# Old\n");
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
    expect(result.written).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack");
    expect(content).toContain("promptpit:end:my-stack");
  });
});

describe("readAgentsFromDir", () => {
  it("reads agent files from a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(
      path.join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
    );
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("reviewer");
    expect(agents[0]!.path).toBe("agents/reviewer");
    expect(agents[0]!.frontmatter.description).toBe("Code review agent");
    expect(agents[0]!.frontmatter.tools).toEqual(["Read", "Grep"]);
    expect(agents[0]!.content).toContain("Review code carefully.");
    await rm(dir, { recursive: true });
  });

  it("returns empty array for missing directory", async () => {
    const agents = await readAgentsFromDir("/tmp/nonexistent-agents-dir-" + Date.now());
    expect(agents).toEqual([]);
  });

  it("skips files with invalid frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(path.join(dir, "bad.md"), "---\nname: bad\n---\n\nNo description.\n");
    const agents = await readAgentsFromDir(dir);
    expect(agents).toEqual([]);
    await rm(dir, { recursive: true });
  });
});

describe("formatAgentsInlineSection", () => {
  it("formats agents as markdown section", () => {
    const agents: AgentEntry[] = [
      {
        name: "reviewer",
        path: "agents/reviewer",
        frontmatter: { name: "reviewer", description: "Code review agent", tools: ["Read", "Grep"] },
        content: "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("## Custom Agents");
    expect(result).toContain("### reviewer");
    expect(result).toContain("Code review agent");
    expect(result).toContain("Tools: Read, Grep");
    expect(result).toContain("Review code carefully.");
  });

  it("formats agent without tools", () => {
    const agents: AgentEntry[] = [
      {
        name: "helper",
        path: "agents/helper",
        frontmatter: { name: "helper", description: "General helper" },
        content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("### helper");
    expect(result).toContain("General helper");
    expect(result).not.toContain("Tools:");
    expect(result).toContain("Help with tasks.");
  });

  it("returns empty string for empty array", () => {
    const result = formatAgentsInlineSection([]);
    expect(result).toBe("");
  });
});
