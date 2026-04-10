import { describe, it, expect } from "vitest";
import { stackManifestSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema scripts field", () => {
  const base = { name: "test", version: "1.0.0" };

  it("accepts manifest without scripts", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts manifest with preinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with postinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with both scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo prep", postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scripts?.preinstall).toBe("echo prep");
      expect(result.data.scripts?.postinstall).toBe("./setup.sh");
    }
  });

  it("rejects empty string scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string script values", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: 42 },
    });
    expect(result.success).toBe(false);
  });
});
