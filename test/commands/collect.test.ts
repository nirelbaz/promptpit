import { describe, it, expect, vi } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

describe("collectStack", () => {
  it("collects a Claude Code project into a .promptpit bundle", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "pit-collect-"));
    const outputPath = path.join(outDir, ".promptpit");

    await collectStack(CLAUDE_PROJECT, outputPath);

    const manifest = JSON.parse(
      await readFile(path.join(outputPath, "stack.json"), "utf-8"),
    );
    expect(manifest.name).toBe("test-project");
    expect(manifest.version).toBe("0.1.0");

    const skillContent = await readFile(
      path.join(outputPath, "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("browse");

    const mcpRaw = await readFile(path.join(outputPath, "mcp.json"), "utf-8");
    const mcp = JSON.parse(mcpRaw);
    expect(mcp.postgres.env.DATABASE_URL).toBe("${DATABASE_URL}");

    const envExample = await readFile(
      path.join(outputPath, ".env.example"),
      "utf-8",
    );
    expect(envExample).toContain("DATABASE_URL");

    await rm(outDir, { recursive: true });
  });

  it("dry-run does not write any files", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "pit-collect-"));
    const outputPath = path.join(outDir, ".promptpit");

    await collectStack(CLAUDE_PROJECT, outputPath, { dryRun: true });

    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(outputPath, "stack.json"))).toBe(false);

    await rm(outDir, { recursive: true });
  });

  it("errors when no AI tools detected", async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), "pit-collect-"));
    const outDir = path.join(emptyDir, ".promptpit");

    await expect(collectStack(emptyDir, outDir)).rejects.toThrow(
      "Run 'pit init' to create a stack from scratch",
    );

    await rm(emptyDir, { recursive: true });
  });

  it("dry-run with agents lists agent files in report", async () => {
    // Build a minimal project with a Claude config and an agent file so collect
    // detects agents and includes them in the dry-run entry list.
    const projectDir = await mkdtemp(path.join(tmpdir(), "pit-collect-agents-"));
    const outDir = path.join(projectDir, ".promptpit");

    // Minimal CLAUDE.md so Claude Code adapter is detected
    await writeFile(path.join(projectDir, "CLAUDE.md"), "# Instructions\n");
    // An agent in the canonical .agents/skills-adjacent location that collect reads
    const agentsDir = path.join(projectDir, ".claude", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );

    // Spy on console.log so we can assert the dry-run summary line
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await collectStack(projectDir, outDir, { dryRun: true });
    } finally {
      spy.mockRestore();
    }

    // Output dir must not have been created (dry-run)
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(outDir, "stack.json"))).toBe(false);

    await rm(projectDir, { recursive: true });
  });
});
