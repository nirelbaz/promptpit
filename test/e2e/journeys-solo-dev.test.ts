import { describe, it, expect } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { statusCommand } from "../../src/commands/status.js";
import { initCommand, type Prompter } from "../../src/commands/init.js";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { useTmpDirs, captureJson } from "./helpers.js";

const CLAUDE_PROJECT = path.resolve("test/__fixtures__/claude-project");

/** Fake prompter that returns canned answers in order. */
function fakePrompter(answers: string[]): Prompter {
  let idx = 0;
  return {
    question: async () => {
      if (idx >= answers.length) {
        throw new Error(`Unexpected prompt at index ${idx} — add more answers to fakePrompter`);
      }
      return answers[idx++];
    },
    close: () => {},
  };
}

describe("E2E: Solo Dev journeys", () => {
  const { makeTmpDir } = useTmpDirs("pit-solo-");

  it("Journey 2: install adds a new adapter without touching existing ones", async () => {
    // Set up: collect from Claude project
    const collectDir = await makeTmpDir("j2-collect-");
    const bundleDir = path.join(collectDir, ".promptpit");
    await collectStack(CLAUDE_PROJECT, bundleDir);

    // Install into a project that already has CLAUDE.md (simulates Claude Code present)
    const targetDir = await makeTmpDir("j2-target-");
    await writeFile(path.join(targetDir, "CLAUDE.md"), "# My project\n");
    await installStack(bundleDir, targetDir, {});

    // Record the CLAUDE.md content after first install
    const claudeMdAfterFirst = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );

    // Re-install — Claude Code content should be unchanged (idempotent)
    await installStack(bundleDir, targetDir, {});

    const claudeMdAfterSecond = await readFile(
      path.join(targetDir, "CLAUDE.md"),
      "utf-8",
    );

    // CLAUDE.md should be identical (idempotent re-install)
    expect(claudeMdAfterSecond).toBe(claudeMdAfterFirst);

    // Status should show all adapters synced
    const result = await captureJson(() =>
      statusCommand(targetDir, { json: true }),
    );
    const stacks = result.stacks as Array<{
      overallState: string;
      adapters: Array<{ adapterId: string; state: string }>;
    }>;
    expect(stacks[0]!.overallState).toBe("synced");
  });

  it("Journey 25: collect on empty project throws descriptive error", async () => {
    const emptyDir = await makeTmpDir("j25-empty-");

    const bundleDir = path.join(emptyDir, ".promptpit");

    // Should throw with a helpful message — not crash with unhandled error
    await expect(collectStack(emptyDir, bundleDir)).rejects.toThrow(
      "No AI tool configs found",
    );
  });

  it("Journey 29: init scaffolds a valid stack skeleton", async () => {
    const projectDir = await makeTmpDir("j29-init-");

    const prompter = fakePrompter([
      "my-new-stack",  // name
      "1.0.0",         // version
      "A test stack",  // description
      "Test Author",   // author
      "y",             // include instructions?
      "n",             // include MCP?
      "n",             // include .env?
    ]);

    await initCommand(projectDir, {}, prompter);

    // Verify .promptpit/ was created with stack.json
    const stackJson = JSON.parse(
      await readFile(
        path.join(projectDir, ".promptpit", "stack.json"),
        "utf-8",
      ),
    );
    expect(stackJson.name).toBe("my-new-stack");
    expect(stackJson.version).toBe("1.0.0");
    expect(stackJson.description).toBe("A test stack");
    expect(stackJson.author).toBe("Test Author");

    // Verify agent.promptpit.md was created (since we said "y" to instructions)
    const instructions = await readFile(
      path.join(projectDir, ".promptpit", "agent.promptpit.md"),
      "utf-8",
    );
    expect(instructions).toContain("name: my-new-stack");
    expect(instructions).toContain("# Agent Instructions");

    // Verify skills/.gitkeep was created
    const gitkeep = await readFile(
      path.join(projectDir, ".promptpit", "skills", ".gitkeep"),
      "utf-8",
    );
    expect(gitkeep).toBe("");
  });
});
