import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { lsCommand } from "../../src/commands/ls.js";

const fixture = path.resolve(__dirname, "../__fixtures__/scan-basic");

beforeEach(() => vi.restoreAllMocks());

describe("pit ls", () => {
  it("default scope prints managed + unmanaged + (empty) global", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lsCommand(fixture, { scope: "current", global: false });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toMatch(/app-frontend/);
    expect(out).toMatch(/app-backend/);
    expect(out).toMatch(/llm-demo/);
  });

  it("--json outputs ScannedStack[]", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lsCommand(fixture, { json: true, scope: "current", global: false });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((s: { name: string }) => s.name === "app-frontend")).toBe(true);
  });

  it("--managed filters to managed only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lsCommand(fixture, { managed: true, scope: "current", global: false });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toMatch(/app-frontend/);
    expect(out).not.toMatch(/app-backend/);
  });

  it("--unmanaged filters to unmanaged only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lsCommand(fixture, { unmanaged: true, scope: "current", global: false });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).not.toMatch(/app-frontend/);
    expect(out).toMatch(/app-backend/);
  });

  it("rejects --managed + --unmanaged", async () => {
    await expect(lsCommand(fixture, { managed: true, unmanaged: true, scope: "current", global: false }))
      .rejects.toThrow(/mutually exclusive/);
  });

  it("--scope global skips current-tree walk entirely", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lsCommand(fixture, { scope: "global", global: true });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    // None of the current-tree stacks should appear — only global (or empty).
    expect(out).not.toMatch(/app-frontend/);
    expect(out).not.toMatch(/app-backend/);
    expect(out).not.toMatch(/llm-demo/);
  });

  it("prints no-match notice when filters eliminate all results (not onboarding)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // scan-basic's managed stack has no drift, so --managed + --drifted yields zero.
    const code = await lsCommand(fixture, {
      managed: true,
      drifted: true,
      scope: "current",
      global: false,
    });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(code).toBe(0);
    expect(out).toMatch(/No stacks match the active filters/);
    expect(out).not.toMatch(/pit init/);
  });

  it("--short with active filters and zero matches writes to stderr", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await lsCommand(fixture, {
      managed: true,
      drifted: true,
      short: true,
      scope: "current",
      global: false,
    });
    expect(code).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith("No stacks match the active filters.");
  });
});
