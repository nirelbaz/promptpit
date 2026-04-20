import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { standardsAdapter } from "../../src/adapters/standards.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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

describe("Standards adapter AGENT.md (singular) fallback", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pit-agent-singular-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects a stack with only AGENT.md (no AGENTS.md)", async () => {
    await writeFile(path.join(dir, "AGENT.md"), "# instructions\nhello\n");
    const result = await standardsAdapter.detect(dir);
    expect(result.detected).toBe(true);
    expect(result.configPaths.some((p) => p.endsWith("AGENT.md"))).toBe(true);
  });

  it("read() returns AGENT.md content when only singular exists", async () => {
    const body = "# singular instructions\ndetails\n";
    await writeFile(path.join(dir, "AGENT.md"), body);
    const cfg = await standardsAdapter.read(dir);
    expect(cfg.agentInstructions).toBe(body);
  });

  it("prefers AGENTS.md when both exist and warns about the other", async () => {
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    await writeFile(path.join(dir, "AGENTS.md"), "plural\n");
    await writeFile(path.join(dir, "AGENT.md"), "singular\n");
    const cfg = await standardsAdapter.read(dir);
    expect(cfg.agentInstructions).toBe("plural\n");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
