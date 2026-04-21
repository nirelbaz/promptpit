import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import { loadJsonFile, writeJsonAtomic } from "../../src/shared/utils.js";

const schema = z.object({
  version: z.literal(1),
  flag: z.boolean().default(false),
});

type Schema = z.infer<typeof schema>;
const defaults: Schema = { version: 1, flag: false };

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "pit-utils-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loadJsonFile", () => {
  it("returns schema-parsed defaults when the file is missing", async () => {
    const cfg = await loadJsonFile(path.join(home, "missing.json"), schema, defaults);
    expect(cfg).toEqual({ version: 1, flag: false });
  });

  it("falls back to defaults when JSON is valid but fails schema validation, leaving the file untouched", async () => {
    const filePath = path.join(home, "bad-schema.json");
    const raw = '{"bogus": true}';
    writeFileSync(filePath, raw, "utf-8");

    const cfg = await loadJsonFile(filePath, schema, defaults, { silent: true });
    expect(cfg).toEqual({ version: 1, flag: false });
    // Recovery is the user's call — the helper must not auto-overwrite.
    expect(readFileSync(filePath, "utf-8")).toBe(raw);
  });

  it("emits a warning to stderr by default on schema failure", async () => {
    const filePath = path.join(home, "warn.json");
    writeFileSync(filePath, '{"bogus": true}', "utf-8");
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await loadJsonFile(filePath, schema, defaults, { label: "warn.json" });
      const joined = spy.mock.calls.map((c) => String(c[0])).join("");
      expect(joined).toContain("warn.json");
      expect(joined).toMatch(/schema/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("stays quiet when silent: true on schema failure", async () => {
    const filePath = path.join(home, "silent.json");
    writeFileSync(filePath, '{"bogus": true}', "utf-8");
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await loadJsonFile(filePath, schema, defaults, { silent: true });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("emits a warning to stderr on invalid JSON unless silent", async () => {
    const filePath = path.join(home, "corrupt.json");
    writeFileSync(filePath, "NOT JSON", "utf-8");
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const cfg = await loadJsonFile(filePath, schema, defaults, { label: "corrupt.json" });
      expect(cfg).toEqual({ version: 1, flag: false });
      const joined = spy.mock.calls.map((c) => String(c[0])).join("");
      expect(joined).toContain("corrupt.json");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("writeJsonAtomic", () => {
  it("writes the file and leaves no .tmp leftover", async () => {
    const filePath = path.join(home, "nested", "out.json");
    await writeJsonAtomic(filePath, { version: 1, flag: true });

    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ version: 1, flag: true });

    const leftovers = readdirSync(path.dirname(filePath)).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites an existing file atomically", async () => {
    const filePath = path.join(home, "overwrite.json");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ version: 1, flag: false }), "utf-8");

    await writeJsonAtomic(filePath, { version: 1, flag: true });
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ version: 1, flag: true });
    const leftovers = readdirSync(home).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
