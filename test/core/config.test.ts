import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, addRecentTarget, addRecentSource } from "../../src/core/config.js";

let home: string;

beforeEach(() => { home = mkdtempSync(path.join(tmpdir(), "pit-cfg-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("config", () => {
  it("returns defaults when file is missing", async () => {
    const cfg = await loadConfig(home);
    expect(cfg.version).toBe(1);
    expect(cfg.scan.defaultDepth).toBe(5);
    expect(cfg.ui.showGlobalRow).toBe(true);
  });

  it("does not create the file on load (lazy)", async () => {
    await loadConfig(home);
    expect(() => readFileSync(path.join(home, ".promptpit/config.json"))).toThrow();
  });

  it("writes the file atomically on saveConfig", async () => {
    const cfg = await loadConfig(home);
    cfg.ui.offline = true;
    await saveConfig(home, cfg);
    const raw = readFileSync(path.join(home, ".promptpit/config.json"), "utf-8");
    expect(JSON.parse(raw).ui.offline).toBe(true);
  });

  it("falls back to defaults on corrupt file (in-memory only)", async () => {
    mkdirSync(path.join(home, ".promptpit"), { recursive: true });
    writeFileSync(path.join(home, ".promptpit/config.json"), "NOT JSON", { flag: "w" });
    const cfg = await loadConfig(home, { silent: true });
    expect(cfg.ui.showGlobalRow).toBe(true);
    // corrupt file not overwritten
    expect(readFileSync(path.join(home, ".promptpit/config.json"), "utf-8")).toBe("NOT JSON");
  });

  it("addRecentTarget trims to 20 entries and dedupes", async () => {
    let cfg = await loadConfig(home);
    for (let i = 0; i < 25; i++) cfg = addRecentTarget(cfg, `/p/${i}`);
    expect(cfg.recents.targetPaths.length).toBe(20);
    expect(cfg.recents.targetPaths[0]).toBe("/p/24");
    cfg = addRecentTarget(cfg, "/p/24");
    expect(cfg.recents.targetPaths.filter((p) => p === "/p/24").length).toBe(1);
  });

  it("addRecentSource trims to 20 entries and dedupes", async () => {
    let cfg = await loadConfig(home);
    for (let i = 0; i < 25; i++) cfg = addRecentSource(cfg, `github:org/repo-${i}`);
    expect(cfg.recents.sources.length).toBe(20);
    expect(cfg.recents.sources[0]).toBe("github:org/repo-24");
    cfg = addRecentSource(cfg, "github:org/repo-24");
    expect(cfg.recents.sources.filter((s) => s === "github:org/repo-24").length).toBe(1);
  });

  it("falls back to defaults when JSON is valid but schema fails (no overwrite)", async () => {
    mkdirSync(path.join(home, ".promptpit"), { recursive: true });
    writeFileSync(path.join(home, ".promptpit/config.json"), '{"version": 999, "junk": true}', { flag: "w" });
    const cfg = await loadConfig(home, { silent: true });
    expect(cfg.version).toBe(1);
    expect(cfg.ui.showGlobalRow).toBe(true);
    expect(readFileSync(path.join(home, ".promptpit/config.json"), "utf-8")).toBe('{"version": 999, "junk": true}');
  });
});
