import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { copilotAdapter, skillToInstructionsMd, agentToGitHubAgent } from "../../src/adapters/copilot.js";
import { readStack } from "../../src/core/stack.js";

const VALID_STACK = path.join(import.meta.dirname, "../__fixtures__/stacks/valid-stack");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await (await import("node:fs/promises")).mkdtemp(path.join(os.tmpdir(), "copilot-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("copilotAdapter", () => {
  it("has correct id and displayName", () => {
    expect(copilotAdapter.id).toBe("copilot");
    expect(copilotAdapter.displayName).toBe("GitHub Copilot");
  });

  it("capabilities are correct", () => {
    expect(copilotAdapter.capabilities.skillLinkStrategy).toBe("translate-copy");
    expect(copilotAdapter.capabilities.rules).toBe(true);
    expect(copilotAdapter.capabilities.agentsmd).toBe(true);
    expect(copilotAdapter.capabilities.mcpRemote).toBe(true);
  });
});

describe("skillToInstructionsMd", () => {
  it("converts SKILL.md to .instructions.md with applyTo frontmatter", () => {
    const skillMd = `---
name: browse
description: Headless browser for QA
user-invocable: true
---

# Browse Skill

Navigate pages and take screenshots.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).toContain('applyTo: "**"');
    expect(result).toContain("Navigate pages and take screenshots.");
    expect(result).not.toContain("name: browse");
  });

  it("maps context globs to applyTo", () => {
    const skillMd = `---
name: test-rules
description: Testing rules
context:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

Use vitest for all tests.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).toContain('applyTo: "**/*.test.ts, **/*.spec.ts"');
    expect(result).toContain("Use vitest for all tests.");
  });

  it("strips original frontmatter from output", () => {
    const skillMd = `---
name: my-skill
description: A test skill
allowed-tools:
  - Read
  - Grep
---

Content here.`;

    const result = skillToInstructionsMd(skillMd);
    expect(result).not.toContain("allowed-tools");
    expect(result).not.toContain("Read");
    expect(result).toContain("Content here.");
  });
});

describe("agent translation", () => {
  it("translates portable agent to GitHub .agent.md format", () => {
    const content = "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n  - Grep\n---\n\nReview code.\n";
    const result = agentToGitHubAgent(content);
    expect(result).toContain("name: reviewer");
    expect(result).toContain("description: Security reviewer");
    expect(result).toContain("tools:");
    expect(result).toContain("- Read");
    expect(result).not.toContain("model:");
    expect(result).toContain("Review code.");
  });
});

describe("agent read/write", () => {
  it("reads agents from .github/agents/", async () => {
    const agentsDir = path.join(tmpDir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "reviewer.agent.md"),
      "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );
    const config = await copilotAdapter.read(tmpDir);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.name).toBe("reviewer");
  });

  it("writes agents to .github/agents/ with .agent.md extension", async () => {
    const bundle = await readStack(VALID_STACK);
    await mkdir(path.join(tmpDir, ".github"), { recursive: true });
    await writeFile(path.join(tmpDir, ".github", "copilot-instructions.md"), "# Test");
    await copilotAdapter.write(tmpDir, bundle, {});
    const content = await readFile(
      path.join(tmpDir, ".github", "agents", "reviewer.agent.md"),
      "utf-8",
    );
    expect(content).toContain("reviewer");
    expect(content).toContain("security-focused code reviewer");
  });

  it("returns empty agents when no .github/agents/ exists", async () => {
    await mkdir(path.join(tmpDir, ".github"), { recursive: true });
    await writeFile(path.join(tmpDir, ".github", "copilot-instructions.md"), "# Test");
    const config = await copilotAdapter.read(tmpDir);
    expect(config.agents).toEqual([]);
  });
});
