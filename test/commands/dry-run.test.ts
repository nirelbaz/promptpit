import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { claudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { cursorAdapter } from "../../src/adapters/cursor.js";
import { standardsAdapter } from "../../src/adapters/standards.js";
import type { StackBundle } from "../../src/shared/schema.js";

const BUNDLE: StackBundle = {
  manifest: { name: "test", version: "1.0.0", skills: [], compatibility: [] },
  agentInstructions: "Use TypeScript.",
  skills: [
    {
      name: "my-skill",
      path: "skills/my-skill",
      frontmatter: { name: "my-skill", description: "test skill" },
      content: "---\nname: my-skill\ndescription: test skill\n---\n\nDo things.\n",
    },
  ],
  agents: [],
  rules: [],
  mcpServers: { postgres: { command: "npx", args: ["-y", "pg"] } },
  envExample: {},
};

describe("adapter dry-run entries", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("claude-code: returns dryRunEntries for new project", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-dr-cc-"));
    tmpDirs.push(dir);

    const result = await claudeCodeAdapter.write(dir, BUNDLE, { dryRun: true });

    expect(result.filesWritten).toHaveLength(0);
    expect(result.dryRunEntries).toBeDefined();
    expect(result.dryRunEntries!.length).toBeGreaterThanOrEqual(3);

    const instructions = result.dryRunEntries!.find((e) => e.file.includes("CLAUDE.md"));
    expect(instructions).toBeDefined();
    expect(instructions!.action).toBe("create");

    const skill = result.dryRunEntries!.find((e) => e.file.includes("my-skill"));
    expect(skill).toBeDefined();
    expect(skill!.action).toBe("create");

    const mcp = result.dryRunEntries!.find((e) => e.file.includes("settings.json"));
    expect(mcp).toBeDefined();
    expect(mcp!.action).toMatch(/create|modify/);
  });

  it("claude-code: marks modify when CLAUDE.md exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-dr-cc-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "CLAUDE.md"), "# Existing\n");

    const result = await claudeCodeAdapter.write(dir, BUNDLE, { dryRun: true });

    const instructions = result.dryRunEntries!.find((e) => e.file.includes("CLAUDE.md"));
    expect(instructions!.action).toBe("modify");
  });

  it("claude-code: includes content when verbose", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-dr-cc-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "CLAUDE.md"), "# Existing\n");

    const result = await claudeCodeAdapter.write(dir, BUNDLE, { dryRun: true, verbose: true });

    const instructions = result.dryRunEntries!.find((e) => e.file.includes("CLAUDE.md"));
    expect(instructions!.oldContent).toBe("# Existing\n");
    expect(instructions!.newContent).toContain("Use TypeScript");
  });

  it("standards: returns dryRunEntries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-dr-std-"));
    tmpDirs.push(dir);

    const result = await standardsAdapter.write(dir, BUNDLE, { dryRun: true });

    expect(result.dryRunEntries).toBeDefined();
    const agentsMd = result.dryRunEntries!.find((e) => e.file.includes("AGENTS.md"));
    expect(agentsMd).toBeDefined();
    expect(agentsMd!.action).toBe("create");

    const mcp = result.dryRunEntries!.find((e) => e.file.includes(".mcp.json"));
    expect(mcp).toBeDefined();
    expect(mcp!.detail).toContain("1 MCP server");
  });

  it("cursor: returns dryRunEntries for instructions, skills, and mcp", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-dr-cur-"));
    tmpDirs.push(dir);

    const result = await cursorAdapter.write(dir, BUNDLE, { dryRun: true });

    expect(result.dryRunEntries).toBeDefined();
    expect(result.dryRunEntries!.length).toBeGreaterThanOrEqual(3);

    const instructions = result.dryRunEntries!.find((e) => e.file.includes(".cursorrules"));
    expect(instructions).toBeDefined();

    const skill = result.dryRunEntries!.find((e) => e.file.includes("my-skill.mdc"));
    expect(skill).toBeDefined();

    const mcp = result.dryRunEntries!.find((e) => e.file.includes("mcp.json"));
    expect(mcp).toBeDefined();
  });
});
