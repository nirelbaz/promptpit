import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installStack } from "../../src/commands/install.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("install: agents-md always-write logic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-install-agents-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates AGENTS.md even when no AGENTS.md exists in target", async () => {
    // Target has CLAUDE.md but no AGENTS.md
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Existing");

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("promptpit:start:test-stack");
    expect(agentsMd).toContain("promptpit:end:test-stack");
  });

  it("writes to AGENTS.md when it already exists", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Pre-existing content\n",
    );

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("# Pre-existing content");
    expect(agentsMd).toContain("promptpit:start:test-stack");
  });

  it("does not duplicate agents-md when AGENTS.md already detected", async () => {
    // Both CLAUDE.md and AGENTS.md exist — agents-md is detected AND injected
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "# Claude");
    await writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents");

    await installStack(VALID_STACK, tmpDir, {});

    const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    const startCount = (
      agentsMd.match(/promptpit:start:test-stack/g) || []
    ).length;
    expect(startCount).toBe(1);
  });
});
