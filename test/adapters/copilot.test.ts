import { describe, it, expect } from "vitest";
import { copilotAdapter, skillToInstructionsMd } from "../../src/adapters/copilot.js";

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
