import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { standardsAdapter } from "../../src/adapters/standards.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("Standards adapter dedup", () => {
  let tmpDir: string;
  let bundle: Awaited<ReturnType<typeof readStack>>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-std-dedup-"));
    bundle = await readStack(VALID_STACK);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("skips .mcp.json when skipMcp is true", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, { skipMcp: true });
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(result.filesWritten.every((f) => !f.endsWith(".mcp.json"))).toBe(true);
    // AGENTS.md should still be written
    const agents = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agents).toContain("promptpit:start:test-stack");
  });

  it("skips AGENTS.md when skipInstructions is true", async () => {
    await standardsAdapter.write(tmpDir, bundle, { skipInstructions: true });
    expect(existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
    // .mcp.json should still be written
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
  });

  it("writes 0 files when both skips are true", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipMcp: true,
      skipInstructions: true,
    });
    expect(result.filesWritten).toHaveLength(0);
  });

  it("writes both files when no skip flags set", async () => {
    await standardsAdapter.write(tmpDir, bundle, {});
    expect(existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
  });

  it("dry-run respects skipMcp", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipMcp: true,
      dryRun: true,
    });
    const mcpEntry = result.dryRunEntries?.find((e) => e.file.endsWith(".mcp.json"));
    expect(mcpEntry).toBeUndefined();
  });

  it("dry-run respects skipInstructions", async () => {
    const result = await standardsAdapter.write(tmpDir, bundle, {
      skipInstructions: true,
      dryRun: true,
    });
    const agentsEntry = result.dryRunEntries?.find((e) => e.file.endsWith("AGENTS.md"));
    expect(agentsEntry).toBeUndefined();
  });
});
