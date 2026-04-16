import { describe, it, expect } from "vitest";
import { agentFileName, ruleFileNames, isSkillShared, isArtifactShared } from "../../src/core/artifact-ops.js";
import type { InstallManifest } from "../../src/shared/schema.js";

describe("agentFileName", () => {
  it("returns .toml for codex", () => {
    expect(agentFileName("codex", "my-agent")).toBe("my-agent.toml");
  });

  it("returns .agent.md for copilot", () => {
    expect(agentFileName("copilot", "my-agent")).toBe("my-agent.agent.md");
  });

  it("returns .md for claude-code", () => {
    expect(agentFileName("claude-code", "my-agent")).toBe("my-agent.md");
  });
});

describe("ruleFileNames", () => {
  it("returns .mdc variants for cursor", () => {
    const names = ruleFileNames("cursor", "my-rule");
    expect(names).toContain("my-rule.mdc");
    expect(names).toContain("rule-my-rule.mdc");
  });

  it("returns .instructions.md variants for copilot", () => {
    const names = ruleFileNames("copilot", "my-rule");
    expect(names).toContain("my-rule.instructions.md");
    expect(names).toContain("rule-my-rule.instructions.md");
  });

  it("returns .md variants for claude-code", () => {
    const names = ruleFileNames("claude-code", "my-rule");
    expect(names).toContain("my-rule.md");
    expect(names).toContain("rule-my-rule.md");
  });

  it("returns empty array for unknown adapter", () => {
    expect(ruleFileNames("unknown", "my-rule")).toEqual([]);
  });
});

describe("isSkillShared", () => {
  it("returns false when no other stack uses the skill", () => {
    const manifest: InstallManifest = {
      version: 1,
      installs: [
        { stack: "a", stackVersion: "1.0.0", installedAt: "", adapters: { cc: { skills: { shared: { hash: "h" } } } } },
      ],
    };
    expect(isSkillShared(manifest, "a", "shared")).toBe(false);
  });

  it("returns true when another stack uses the skill", () => {
    const manifest: InstallManifest = {
      version: 1,
      installs: [
        { stack: "a", stackVersion: "1.0.0", installedAt: "", adapters: { cc: { skills: { shared: { hash: "h" } } } } },
        { stack: "b", stackVersion: "1.0.0", installedAt: "", adapters: { cc: { skills: { shared: { hash: "h2" } } } } },
      ],
    };
    expect(isSkillShared(manifest, "a", "shared")).toBe(true);
  });
});

describe("isArtifactShared", () => {
  it("returns true when another stack uses the same MCP server", () => {
    const manifest: InstallManifest = {
      version: 1,
      installs: [
        { stack: "a", stackVersion: "1.0.0", installedAt: "", adapters: { cc: { mcp: { server1: { hash: "h" } } } } },
        { stack: "b", stackVersion: "1.0.0", installedAt: "", adapters: { cc: { mcp: { server1: { hash: "h2" } } } } },
      ],
    };
    expect(isArtifactShared(manifest, "a", "cc", "mcp", "server1")).toBe(true);
  });
});
