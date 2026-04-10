import { describe, it, expect } from "vitest";
import { buildExpectedContent } from "../../src/core/reconcile.js";
import { ruleToMdc } from "../../src/adapters/cursor.js";
import { buildInlineContent } from "../../src/adapters/adapter-utils.js";
import type { StackBundle, SkillEntry, AgentEntry, RuleEntry, CommandEntry, McpConfig } from "../../src/shared/schema.js";

// Minimal ContentBundle factory
function makeBundle(overrides: Partial<Pick<StackBundle, "agentInstructions" | "skills" | "agents" | "rules" | "commands" | "mcpServers">> = {}) {
  return {
    agentInstructions: overrides.agentInstructions ?? "",
    skills: overrides.skills ?? [],
    agents: overrides.agents ?? [],
    rules: overrides.rules ?? [],
    commands: overrides.commands ?? [],
    mcpServers: overrides.mcpServers ?? {},
  };
}

describe("buildExpectedContent", () => {
  it("returns skill content from bundle", () => {
    const skill: SkillEntry = {
      name: "security",
      path: "skills/security",
      frontmatter: { name: "security", description: "Security skill" },
      content: "---\nname: security\ndescription: Security skill\n---\n\nSecurity instructions here.\n",
    };
    const bundle = makeBundle({ skills: [skill] });

    const result = buildExpectedContent(bundle, "claude-code", "skill", "security");
    expect(result).toBe(skill.content);
  });

  it("returns translated rule content for cursor adapter", () => {
    const ruleContent = "---\nname: no-console\ndescription: Disallow console.log\nglobs:\n  - \"*.ts\"\nalwaysApply: false\n---\n\nDo not use console.log in production code.\n";
    const rule: RuleEntry = {
      name: "no-console",
      path: "rules/no-console",
      frontmatter: { name: "no-console", description: "Disallow console.log", globs: ["*.ts"], alwaysApply: false },
      content: ruleContent,
    };
    const bundle = makeBundle({ rules: [rule] });

    const result = buildExpectedContent(bundle, "cursor", "rule", "no-console");
    const expected = ruleToMdc(ruleContent);
    expect(result).toBe(expected);
  });

  it("returns instructions with inline agents for inline-agent adapters", () => {
    const agent: AgentEntry = {
      name: "reviewer",
      path: "agents/reviewer",
      frontmatter: { name: "reviewer", description: "Code reviewer agent" },
      content: "---\nname: reviewer\ndescription: Code reviewer agent\n---\n\nReview all code changes.\n",
    };
    const bundle = makeBundle({
      agentInstructions: "Base instructions for the project.",
      agents: [agent],
    });

    // cursor has agents: "inline"
    const result = buildExpectedContent(bundle, "cursor", "instructions", "instructions");
    const expected = buildInlineContent("Base instructions for the project.", [agent])?.trim() ?? null;
    expect(result).toBe(expected);
  });

  it("returns null for unknown artifact name", () => {
    const bundle = makeBundle();

    expect(buildExpectedContent(bundle, "claude-code", "skill", "nonexistent")).toBeNull();
    expect(buildExpectedContent(bundle, "claude-code", "agent", "nonexistent")).toBeNull();
    expect(buildExpectedContent(bundle, "claude-code", "rule", "nonexistent")).toBeNull();
    expect(buildExpectedContent(bundle, "claude-code", "command", "nonexistent")).toBeNull();
    expect(buildExpectedContent(bundle, "claude-code", "mcp", "nonexistent")).toBeNull();
  });

  it("returns MCP server config as sorted JSON", () => {
    const mcpServers: McpConfig = {
      "my-server": {
        command: "npx",
        args: ["-y", "my-mcp-server"],
        env: { Z_VAR: "z", A_VAR: "a" },
      },
    };
    const bundle = makeBundle({ mcpServers });

    const result = buildExpectedContent(bundle, "claude-code", "mcp", "my-server");
    // Keys should be sorted: args, command, env; env keys sorted: A_VAR, Z_VAR
    const parsed = JSON.parse(result!);
    const keys = Object.keys(parsed);
    expect(keys).toEqual(["args", "command", "env"]);
    const envKeys = Object.keys(parsed.env);
    expect(envKeys).toEqual(["A_VAR", "Z_VAR"]);
  });

  it("returns plain instructions for non-inline-agent adapters", () => {
    const bundle = makeBundle({
      agentInstructions: "Project instructions.",
    });

    // claude-code has agents: "native", not "inline"
    const result = buildExpectedContent(bundle, "claude-code", "instructions", "instructions");
    expect(result).toBe("Project instructions.");
  });

  it("returns null for instructions when agentInstructions is empty", () => {
    const bundle = makeBundle({ agentInstructions: "" });

    const result = buildExpectedContent(bundle, "claude-code", "instructions", "instructions");
    expect(result).toBeNull();
  });

  it("returns command content from bundle", () => {
    const command: CommandEntry = {
      name: "deploy",
      path: "commands/deploy",
      content: "Deploy the application to production.\n",
    };
    const bundle = makeBundle({ commands: [command] });

    const result = buildExpectedContent(bundle, "claude-code", "command", "deploy");
    expect(result).toBe(command.content);
  });
});
