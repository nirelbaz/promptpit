import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectUnsupportedTools } from "../../src/core/scan.js";

function makeTmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("detectUnsupportedTools", () => {
  it("surfaces .windsurf when a rules dir exists", async () => {
    const root = makeTmp("pit-unsup-windsurf-");
    mkdirSync(path.join(root, ".windsurf", "rules"), { recursive: true });
    writeFileSync(path.join(root, ".windsurf", "rules", "foo.md"), "rule");
    const found = await detectUnsupportedTools(root);
    expect(found).toEqual([".windsurf"]);
  });

  it("returns all matches in the checklist order when multiple tools are present", async () => {
    const root = makeTmp("pit-unsup-multi-");
    mkdirSync(path.join(root, ".gemini"), { recursive: true });
    mkdirSync(path.join(root, ".trae"), { recursive: true });
    const found = await detectUnsupportedTools(root);
    // The helper iterates the known list in its declaration order; both .gemini
    // and .trae are in that list, and both should surface.
    expect(found).toContain(".gemini");
    expect(found).toContain(".trae");
    expect(found.length).toBe(2);
  });

  it("returns [] for an empty directory", async () => {
    const root = makeTmp("pit-unsup-empty-");
    const found = await detectUnsupportedTools(root);
    expect(found).toEqual([]);
  });

  it("ignores directories not on the known unsupported list", async () => {
    const root = makeTmp("pit-unsup-unknown-");
    mkdirSync(path.join(root, ".unknownai"), { recursive: true });
    const found = await detectUnsupportedTools(root);
    expect(found).toEqual([]);
  });
});
