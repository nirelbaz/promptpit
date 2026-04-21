import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadTrust, saveTrust, hashScript, classifyScript, trustSource, isTrusted, forgetSource } from "../../src/core/trust.js";

let home: string;
beforeEach(() => { home = mkdtempSync(path.join(tmpdir(), "pit-trust-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("trust", () => {
  it("hashScript returns sha256:<64hex>", () => {
    expect(hashScript("echo hi\n")).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("classifyScript enforces 256KB preview cap + 1MB hard cap", () => {
    const small = "hi";
    const medium = "x".repeat(300 * 1024);
    const huge   = "x".repeat(2 * 1024 * 1024);
    expect(classifyScript(small).category).toBe("previewable");
    expect(classifyScript(medium).category).toBe("too-large-to-preview");
    expect(classifyScript(huge).category).toBe("too-large-to-run");
  });

  it("isTrusted returns false on empty trust store", async () => {
    const trust = await loadTrust(home);
    expect(isTrusted(trust, "github:org/stack", "preinstall", hashScript("a"))).toBe(false);
  });

  it("trustSource + saveTrust + isTrusted round-trips", async () => {
    let trust = await loadTrust(home);
    const hash = hashScript("echo build\n");
    trust = trustSource(trust, "github:org/stack", { preinstall: hash });
    await saveTrust(home, trust);
    const reloaded = await loadTrust(home);
    expect(isTrusted(reloaded, "github:org/stack", "preinstall", hash)).toBe(true);
    expect(isTrusted(reloaded, "github:org/stack", "preinstall", hashScript("different"))).toBe(false);
  });

  it("does not create the file on load (lazy)", async () => {
    await loadTrust(home);
    expect(() => readFileSync(path.join(home, ".promptpit/trust.json"))).toThrow();
  });

  it("falls back to empty trust on corrupt file", async () => {
    mkdirSync(path.join(home, ".promptpit"), { recursive: true });
    const p = path.join(home, ".promptpit/trust.json");
    writeFileSync(p, "NOT JSON", { flag: "w" });
    const trust = await loadTrust(home, { silent: true });
    expect(trust.trusted).toEqual({});
    expect(readFileSync(p, "utf-8")).toBe("NOT JSON");
  });

  it("classifyScript categorizes real fixture scripts correctly", () => {
    const big = readFileSync(path.resolve(__dirname, "../__fixtures__/trust-script-large/big.sh"), "utf-8");
    const huge = readFileSync(path.resolve(__dirname, "../__fixtures__/trust-script-large/huge.sh"), "utf-8");
    expect(classifyScript(big).category).toBe("too-large-to-preview");
    expect(classifyScript(huge).category).toBe("too-large-to-run");
  });

  it("forgetSource removes a source, leaving others intact", async () => {
    let trust = await loadTrust(home);
    trust = trustSource(trust, "github:a/stack", { preinstall: hashScript("a") });
    trust = trustSource(trust, "github:b/stack", { postinstall: hashScript("b") });
    trust = forgetSource(trust, "github:a/stack");
    expect(trust.trusted["github:a/stack"]).toBeUndefined();
    expect(trust.trusted["github:b/stack"]).toBeDefined();
  });
});
