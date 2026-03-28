import { describe, it, expect } from "vitest";
import { stackManifestSchema, skillFrontmatterSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema", () => {
  it("validates a complete stack manifest", () => {
    const valid = {
      name: "my-stack",
      version: "1.0.0",
      description: "A test stack",
    };
    const result = stackManifestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires name and version", () => {
    const missing = { description: "no name or version" };
    const result = stackManifestSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it("rejects invalid semver", () => {
    const bad = { name: "test", version: "not-semver" };
    const result = stackManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects semver with leading zeros", () => {
    const bad = { name: "test", version: "01.0.0" };
    const result = stackManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const full = {
      name: "my-stack",
      version: "1.0.0",
      description: "desc",
      license: "MIT",
      author: "test",
      skills: ["skills/foo"],
      tags: ["ai", "testing"],
      compatibility: ["claude-code", "cursor"],
    };
    const result = stackManifestSchema.safeParse(full);
    expect(result.success).toBe(true);
  });
});

describe("skillFrontmatterSchema", () => {
  it("validates minimal skill frontmatter", () => {
    const valid = { name: "my-skill", description: "Does things" };
    const result = skillFrontmatterSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires name and description", () => {
    const missing = { name: "no-desc" };
    const result = skillFrontmatterSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });
});
