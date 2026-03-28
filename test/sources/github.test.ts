import { describe, it, expect } from "vitest";
import { parseGitHubSource } from "../../src/sources/github.js";

describe("parseGitHubSource", () => {
  it("parses github:owner/repo", () => {
    const result = parseGitHubSource("github:garrytan/gstack");
    expect(result).toEqual({
      owner: "garrytan",
      repo: "gstack",
      ref: undefined,
    });
  });

  it("parses github:owner/repo@tag", () => {
    const result = parseGitHubSource("github:user/repo@v2.0.0");
    expect(result).toEqual({ owner: "user", repo: "repo", ref: "v2.0.0" });
  });

  it("returns null for local paths", () => {
    expect(parseGitHubSource("./local/path")).toBeNull();
    expect(parseGitHubSource("/absolute/path")).toBeNull();
    expect(parseGitHubSource("relative/path")).toBeNull();
  });
});
