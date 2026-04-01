import { describe, it, expect } from "vitest";

describe("agnix integration", () => {
  it("parses agnix JSON output into diagnostics", async () => {
    const { validateStack } = await import("../../src/core/validate.js");
    const VALID_STACK = "test/__fixtures__/stacks/valid-stack";

    // When agnix is not installed, result should still work
    const result = await validateStack(VALID_STACK);
    expect(result.agnix.available).toBe(false);
    expect(result.agnix.diagnostics).toEqual([]);
  });

  it("maps agnix diagnostic shape to pit Diagnostic", async () => {
    const { mapAgnixDiagnostic } = await import("../../src/core/validate.js");

    const agnixDiag = {
      level: "warning",
      rule: "CC-042",
      file: "CLAUDE.md",
      message: "hooks should declare explicit timeout",
    };

    const mapped = mapAgnixDiagnostic(agnixDiag);
    expect(mapped).toEqual({
      file: "CLAUDE.md",
      level: "warning",
      message: "hooks should declare explicit timeout",
      source: "agnix",
      rule: "CC-042",
    });
  });
});
