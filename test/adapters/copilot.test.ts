import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os, { tmpdir } from "node:os";
import { copilotAdapter, skillToInstructionsMd, agentToGitHubAgent, ruleToInstructionsMd } from "../../src/adapters/copilot.js";
import { readStack } from "../../src/core/stack.js";

const VALID_STACK = path.join(import.meta.dirname, "../__fixtures__/stacks/valid-stack");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "copilot-test-"));
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

  it("drops the model field when translating to GitHub .agent.md", () => {
    const content = "---\nname: coder\ndescription: Coding agent\nmodel: claude-opus-4-5\ntools:\n  - Write\n---\n\nWrite code.\n";
    const result = agentToGitHubAgent(content);
    expect(result).toContain("name: coder");
    expect(result).toContain("description: Coding agent");
    // model must be stripped — Copilot doesn't support per-agent model selection
    expect(result).not.toContain("model:");
    expect(result).not.toContain("claude-opus");
    expect(result).toContain("Write code.");
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

  it("reads plain .md agents from .github/agents/", async () => {
    const agentsDir = path.join(tmpDir, ".github", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "data.md"),
      "---\nname: data\ndescription: Data analysis agent\ntools:\n  - read\n  - search\n---\n\nAnalyze data.\n",
    );
    await writeFile(
      path.join(agentsDir, "reviewer.agent.md"),
      "---\nname: reviewer\ndescription: Security reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );
    const config = await copilotAdapter.read(tmpDir);
    expect(config.agents).toHaveLength(2);
    const names = config.agents.map((a) => a.name).sort();
    expect(names).toEqual(["data", "reviewer"]);
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

  it("dry-run write returns dryRunEntries for agents, not actual files", async () => {
    const bundle = await readStack(VALID_STACK);
    // Ensure the bundle has the reviewer agent from the valid-stack fixture
    expect(bundle.agents.length).toBeGreaterThan(0);

    await mkdir(path.join(tmpDir, ".github"), { recursive: true });
    await writeFile(path.join(tmpDir, ".github", "copilot-instructions.md"), "# Test");

    const result = await copilotAdapter.write(tmpDir, bundle, { dryRun: true });

    // No files should have been written
    expect(result.filesWritten).toHaveLength(0);
    // dry-run entries must be present
    expect(result.dryRunEntries).toBeDefined();
    // There should be an entry for the agent file
    const agentEntry = result.dryRunEntries!.find((e) => e.file.includes(".agent.md"));
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.action).toMatch(/create|modify/);

    // Verify no agent file was actually created on disk
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(tmpDir, ".github", "agents", "reviewer.agent.md"))).toBe(false);
  });
});

describe("copilot rules", () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("reads .instructions.md files as RuleEntry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-copilot-readrules-"));
    tmpDirs.push(dir);
    await mkdir(path.join(dir, ".github", "instructions"), { recursive: true });
    await writeFile(
      path.join(dir, ".github", "instructions", "lint.instructions.md"),
      '---\napplyTo: "**/*.ts"\n---\n\nRun eslint.\n',
    );

    const config = await copilotAdapter.read(dir);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe("lint");
    expect(config.rules[0].frontmatter.globs).toEqual(["**/*.ts"]);
  });

  it("rule content uses portable globs (not applyTo) for cross-adapter translation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-copilot-globs-roundtrip-"));
    tmpDirs.push(dir);
    await mkdir(path.join(dir, ".github", "instructions"), { recursive: true });
    await writeFile(
      path.join(dir, ".github", "instructions", "cli.instructions.md"),
      '---\napplyTo: "src/apm_cli/cli.py"\n---\n\nCLI rules.\n',
    );

    const config = await copilotAdapter.read(dir);
    const rule = config.rules[0]!;
    // Frontmatter should have globs
    expect(rule.frontmatter.globs).toEqual(["src/apm_cli/cli.py"]);
    // Content should contain globs (not applyTo) so ruleToClaudeFormat sees them
    expect(rule.content).toContain("globs:");
    expect(rule.content).not.toContain("applyTo");

    // Verify Claude Code translation picks up the globs as paths
    const { ruleToClaudeFormat } = await import("../../src/adapters/claude-code.js");
    const claudeRule = ruleToClaudeFormat(rule.content);
    expect(claudeRule).toContain("paths:");
    expect(claudeRule).toContain("src/apm_cli/cli.py");
  });

  it("reads .instructions.md from subdirectories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-copilot-subrules-"));
    tmpDirs.push(dir);
    const instDir = path.join(dir, ".github", "instructions");
    await mkdir(path.join(instDir, "review-guide"), { recursive: true });
    await writeFile(
      path.join(instDir, "lint.instructions.md"),
      '---\napplyTo: "**/*.ts"\n---\n\nRun eslint.\n',
    );
    await writeFile(
      path.join(instDir, "review-guide", "frontend.instructions.md"),
      '---\napplyTo: "src/**"\n---\n\nFrontend review rules.\n',
    );
    await writeFile(
      path.join(instDir, "review-guide", "server.instructions.md"),
      '---\napplyTo: "packages/server/**"\n---\n\nServer review rules.\n',
    );

    const config = await copilotAdapter.read(dir);
    expect(config.rules).toHaveLength(3);
    const names = config.rules.map((r) => r.name).sort();
    expect(names).toEqual(["lint", "review-guide-frontend", "review-guide-server"]);
  });

  it("writes rules with rule- prefix", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-copilot-writerules-"));
    tmpDirs.push(target);
    await mkdir(path.join(target, ".github"), { recursive: true });

    const bundle = await readStack(
      path.resolve("test/__fixtures__/stacks/valid-stack"),
    );

    await copilotAdapter.write(target, bundle, {});

    const testingRule = await readFile(
      path.join(target, ".github", "instructions", "rule-testing.instructions.md"), "utf-8",
    );
    expect(testingRule).toContain("**/*.test.ts, **/*.spec.ts");
    expect(testingRule).toContain("vitest");

    const securityRule = await readFile(
      path.join(target, ".github", "instructions", "rule-security.instructions.md"), "utf-8",
    );
    expect(securityRule).toContain("applyTo:");
    expect(securityRule).toContain("**");
    expect(securityRule).toContain("sanitize");
  });
});
