import { describe, it, expect } from "vitest";
import {
  stripMarkerBlock,
  stripAllMarkerBlocks,
  insertMarkers,
} from "../../src/shared/markers.js";

describe("stripMarkerBlock", () => {
  it("removes a single stack's markers and content", () => {
    let content = "# Header\n\nProject content here.";
    content = insertMarkers(content, "installed stuff", "mystack", "1.0.0", "claude-code");

    const stripped = stripMarkerBlock(content, "mystack");
    expect(stripped).toContain("# Header");
    expect(stripped).toContain("Project content here.");
    expect(stripped).not.toContain("installed stuff");
    expect(stripped).not.toContain("promptpit:start");
  });

  it("strips only the target stack from multi-stack file", () => {
    let content = "";
    content = insertMarkers(content, "stack A content", "stackA", "1.0.0", "cc");
    content = insertMarkers(content, "stack B content", "stackB", "1.0.0", "cc");

    const stripped = stripMarkerBlock(content, "stackA");
    expect(stripped).not.toContain("stack A content");
    expect(stripped).toContain("stack B content");
  });

  it("returns content unchanged when no markers found", () => {
    const content = "just plain text with no markers";
    expect(stripMarkerBlock(content, "nonexistent")).toBe(content);
  });

  it("returns content unchanged with broken markers (start without end)", () => {
    const content = "before\n<!-- promptpit:start:s:1.0.0:cc -->\ncontent with no end";
    expect(stripMarkerBlock(content, "s")).toBe(content);
  });
});

describe("stripAllMarkerBlocks", () => {
  it("strips all marker blocks regardless of stack name", () => {
    let content = "# Native content";
    content = insertMarkers(content, "from stack A", "stackA", "1.0.0", "cc");
    content = insertMarkers(content, "from stack B", "stackB", "1.0.0", "cc");

    const stripped = stripAllMarkerBlocks(content);
    expect(stripped).toContain("# Native content");
    expect(stripped).not.toContain("from stack A");
    expect(stripped).not.toContain("from stack B");
    expect(stripped).not.toContain("promptpit:start");
  });

  it("returns content unchanged when no markers exist", () => {
    const content = "no markers here";
    expect(stripAllMarkerBlocks(content)).toBe(content);
  });
});
