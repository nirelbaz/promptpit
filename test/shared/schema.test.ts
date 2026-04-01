import { describe, it, expect } from "vitest";
import { stackManifestSchema, skillFrontmatterSchema, mcpServerSchema, mcpConfigSchema } from "../../src/shared/schema.js";

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

  it("rejects names with unsafe characters", () => {
    const bad = { name: "../../etc/passwd", version: "1.0.0" };
    const result = stackManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts scoped npm-style names", () => {
    const valid = { name: "@scope/my-stack", version: "1.0.0" };
    const result = stackManifestSchema.safeParse(valid);
    expect(result.success).toBe(true);
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

describe("mcpServerSchema", () => {
  it("validates a stdio server with command", () => {
    const server = { command: "npx", args: ["-y", "@context7/mcp"] };
    expect(mcpServerSchema.safeParse(server).success).toBe(true);
  });

  it("validates an HTTP remote server with url only", () => {
    const server = { url: "https://api.example.com/mcp" };
    expect(mcpServerSchema.safeParse(server).success).toBe(true);
  });

  it("validates an HTTP remote server with serverUrl only", () => {
    const server = { serverUrl: "https://api.example.com/mcp" };
    expect(mcpServerSchema.safeParse(server).success).toBe(true);
  });

  it("validates a server with command, args, and env", () => {
    const server = { command: "npx", args: ["-y", "pkg"], env: { API_KEY: "test" } };
    expect(mcpServerSchema.safeParse(server).success).toBe(true);
  });

  it("rejects an empty server (no command, no url)", () => {
    const server = {};
    expect(mcpServerSchema.safeParse(server).success).toBe(false);
  });

  it("preserves unknown fields via passthrough", () => {
    const server = { command: "npx", type: "stdio", customField: true };
    const result = mcpServerSchema.safeParse(server);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty("type", "stdio");
      expect(result.data).toHaveProperty("customField", true);
    }
  });
});

describe("mcpConfigSchema", () => {
  it("validates a mix of stdio and HTTP remote servers", () => {
    const config = {
      context7: { command: "npx", args: ["-y", "@context7/mcp"] },
      "remote-api": { url: "https://api.example.com/mcp" },
    };
    const result = mcpConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects config with invalid env type", () => {
    const config = { bad: { command: "npx", env: { KEY: 123 } } };
    const result = mcpConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
