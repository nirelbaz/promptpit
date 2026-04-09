import { describe, it, expect } from "vitest";
import { stackManifestSchema, installManifestSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema extends fields", () => {
  const base = { name: "test", version: "1.0.0" };

  it("accepts stack without extends (backwards compat)", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts extends with github sources", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      extends: ["github:acme/base-stack@1.0.0", "github:acme/other"],
    });
    expect(result.success).toBe(true);
    expect(result.data!.extends).toEqual(["github:acme/base-stack@1.0.0", "github:acme/other"]);
  });

  it("accepts extends with local paths", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      extends: ["../shared/.promptpit"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty extends array", () => {
    const result = stackManifestSchema.safeParse({ ...base, extends: [] });
    expect(result.success).toBe(true);
  });

  it("rejects non-string extends entries", () => {
    const result = stackManifestSchema.safeParse({ ...base, extends: [123] });
    expect(result.success).toBe(false);
  });

  it("accepts instructionStrategy concatenate", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "concatenate",
    });
    expect(result.success).toBe(true);
  });

  it("accepts instructionStrategy override", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "override",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid instructionStrategy", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      instructionStrategy: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts stack without instructionStrategy", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data!.instructionStrategy).toBeUndefined();
  });
});

describe("installManifestSchema resolvedExtends", () => {
  it("accepts install entry with resolvedExtends", () => {
    const manifest = {
      version: 1,
      installs: [{
        stack: "test",
        stackVersion: "1.0.0",
        installedAt: "2026-04-09T00:00:00Z",
        adapters: {},
        resolvedExtends: [{
          source: "github:acme/base@1.0.0",
          version: "1.0.0",
          resolvedCommit: "abc123",
          resolvedAt: "2026-04-09T00:00:00Z",
        }],
      }],
    };
    const result = installManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("accepts install entry without resolvedExtends (backwards compat)", () => {
    const manifest = {
      version: 1,
      installs: [{
        stack: "test",
        stackVersion: "1.0.0",
        installedAt: "2026-04-09T00:00:00Z",
        adapters: {},
      }],
    };
    const result = installManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
