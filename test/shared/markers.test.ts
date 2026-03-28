import { describe, it, expect } from "vitest";
import {
  createMarker,
  insertMarkers,
  replaceMarkerContent,
  extractMarkerContent,
  hasMarkers,
} from "../../src/shared/markers.js";

describe("createMarker", () => {
  it("creates start marker with adapter ID", () => {
    const marker = createMarker("start", "gstack", "2.1.0", "claude-code");
    expect(marker).toBe("<!-- promptpit:start:gstack:2.1.0:claude-code -->");
  });

  it("creates end marker", () => {
    const marker = createMarker("end", "gstack");
    expect(marker).toBe("<!-- promptpit:end:gstack -->");
  });
});

describe("insertMarkers", () => {
  it("appends marker block to empty content", () => {
    const result = insertMarkers("", "hello world", "mystack", "1.0.0", "claude-code");
    expect(result).toContain("<!-- promptpit:start:mystack:1.0.0:claude-code -->");
    expect(result).toContain("hello world");
    expect(result).toContain("<!-- promptpit:end:mystack -->");
  });

  it("appends marker block to existing content", () => {
    const existing = "# My existing config\n\nSome stuff here.";
    const result = insertMarkers(existing, "new content", "mystack", "1.0.0", "claude-code");
    expect(result).toContain("# My existing config");
    expect(result).toContain("new content");
  });
});

describe("replaceMarkerContent", () => {
  it("replaces content between existing markers", () => {
    const content = [
      "# Header",
      "<!-- promptpit:start:mystack:1.0.0:claude-code -->",
      "old content",
      "<!-- promptpit:end:mystack -->",
      "# Footer",
    ].join("\n");
    const result = replaceMarkerContent(content, "new content", "mystack", "2.0.0", "claude-code");
    expect(result).toContain("new content");
    expect(result).not.toContain("old content");
    expect(result).toContain("# Header");
    expect(result).toContain("# Footer");
    expect(result).toContain("2.0.0");
  });
});

describe("hasMarkers", () => {
  it("returns true when markers exist for stack", () => {
    const content = "<!-- promptpit:start:mystack:1.0.0:claude-code -->\nstuff\n<!-- promptpit:end:mystack -->";
    expect(hasMarkers(content, "mystack")).toBe(true);
  });

  it("returns false when no markers exist", () => {
    expect(hasMarkers("just plain text", "mystack")).toBe(false);
  });

  it("returns false for different stack name", () => {
    const content = "<!-- promptpit:start:other:1.0.0:claude-code -->\nstuff\n<!-- promptpit:end:other -->";
    expect(hasMarkers(content, "mystack")).toBe(false);
  });
});

describe("extractMarkerContent", () => {
  it("extracts content between markers", () => {
    const content = "before\n<!-- promptpit:start:s:1.0.0:cc -->\nhello\n<!-- promptpit:end:s -->\nafter";
    expect(extractMarkerContent(content, "s")).toBe("hello");
  });

  it("returns null when no markers found", () => {
    expect(extractMarkerContent("no markers here", "s")).toBeNull();
  });
});

describe("multiple stacks coexist", () => {
  it("handles two stacks in the same file", () => {
    let content = "";
    content = insertMarkers(content, "stack A content", "stackA", "1.0.0", "claude-code");
    content = insertMarkers(content, "stack B content", "stackB", "1.0.0", "claude-code");
    expect(hasMarkers(content, "stackA")).toBe(true);
    expect(hasMarkers(content, "stackB")).toBe(true);
    expect(extractMarkerContent(content, "stackA")).toBe("stack A content");
    expect(extractMarkerContent(content, "stackB")).toBe("stack B content");
  });

  it("replaces one stack without affecting the other", () => {
    let content = "";
    content = insertMarkers(content, "A old", "stackA", "1.0.0", "claude-code");
    content = insertMarkers(content, "B content", "stackB", "1.0.0", "claude-code");
    content = replaceMarkerContent(content, "A new", "stackA", "2.0.0", "claude-code");
    expect(extractMarkerContent(content, "stackA")).toBe("A new");
    expect(extractMarkerContent(content, "stackB")).toBe("B content");
  });
});

describe("broken markers", () => {
  it("does not corrupt file when start marker exists without end", () => {
    const content = "before\n<!-- promptpit:start:s:1.0.0:cc -->\ncontent with no end";
    const result = replaceMarkerContent(content, "new", "s", "2.0.0", "cc");
    expect(result).toBe(content);
  });
});
