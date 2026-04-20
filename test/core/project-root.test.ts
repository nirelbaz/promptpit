import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectProjectRoot } from "../../src/core/scan.js";

function tmpTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "pit-root-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("detectProjectRoot", () => {
  it("returns the dir that contains package.json", () => {
    const root = tmpTree({ "package.json": "{}", "src/a.ts": "" });
    expect(detectProjectRoot(path.join(root, "src"))).toBe(root);
  });
  it("returns the dir that contains .git", () => {
    const root = tmpTree({ ".git/HEAD": "", "deep/b.ts": "" });
    expect(detectProjectRoot(path.join(root, "deep"))).toBe(root);
  });
  it("returns .promptpit parent when present", () => {
    const root = tmpTree({ ".promptpit/stack.json": "{}", "any/c.ts": "" });
    expect(detectProjectRoot(path.join(root, "any"))).toBe(root);
  });
  it("falls back to the input dir when no marker found", () => {
    const root = tmpTree({ "loose/file.txt": "hi" });
    expect(detectProjectRoot(path.join(root, "loose"))).toBe(path.join(root, "loose"));
  });
});
