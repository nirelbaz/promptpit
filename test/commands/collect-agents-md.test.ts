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

  it("keeps both adapters when content differs (dedup by hash)", async () => {
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
    expect(agentMd).toContain("From AGENTS.md.");
  });

  it("deduplicates identical instructions from multiple adapters", async () => {
    const sharedContent = "# Shared instructions\n\nUse strict mode.\n";
    await writeFile(path.join(tmpDir, "AGENTS.md"), sharedContent);
    await writeFile(path.join(tmpDir, "CLAUDE.md"), sharedContent);

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    // Content appears once (deduped), not twice
    const matches = agentMd.match(/Use strict mode\./g) || [];
    expect(matches.length).toBe(1);
  });
});
