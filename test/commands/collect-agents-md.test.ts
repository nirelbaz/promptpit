import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectStack } from "../../src/commands/collect.js";

describe("collect: agents-md fallback logic", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-collect-agents-"));
    outputDir = path.join(tmpDir, ".promptpit");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads AGENTS.md when it is the only adapter detected", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Instructions\n\nUse strict mode.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("Use strict mode.");
  });

  it("excludes AGENTS.md when claude-code is also detected", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# AGENTS instructions\n\nFrom AGENTS.md.\n",
    );
    await writeFile(
      path.join(tmpDir, "CLAUDE.md"),
      "# CLAUDE instructions\n\nFrom CLAUDE.md.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("From CLAUDE.md.");
    expect(agentMd).not.toContain("From AGENTS.md.");
  });
});
