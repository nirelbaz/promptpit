import { describe, it, expect } from "vitest";
import { ACTION_HINTS, hintFor, optionsForMenu } from "../../src/tui/action-hints.js";

describe("action-hints", () => {
  it("exposes a hint for every known action key", () => {
    const keys = Object.keys(ACTION_HINTS);
    expect(keys).toContain("install-from");
    expect(keys).toContain("install-to");
    expect(keys).toContain("adapt");
    expect(keys).toContain("update");
    expect(keys).toContain("status-diff");
    expect(keys).toContain("collect-drift");
    expect(keys).toContain("artifacts");
    expect(keys).toContain("validate");
    expect(keys).toContain("uninstall");
    expect(keys).toContain("open");
    expect(keys).toContain("delete-bundle");
    expect(keys).toContain("back");
  });

  it("hintFor returns the hint string for a known key", () => {
    expect(hintFor("install-from")).toMatch(/pull a stack into this location/);
  });

  it("optionsForMenu('managed') leads with wired actions (status-diff, validate, open)", () => {
    // Until the install/update wizards ship, the menu leads with actions
    // that actually work so first-time users don't land on a disabled row.
    // Restore spec §8 ordering once Chunk 2 wires install verbs.
    const values = optionsForMenu("managed").map((o) => o.value);
    expect(values.slice(0, 3)).toEqual(["status-diff", "validate", "open"]);
    expect(values[values.length - 1]).toBe("back");
  });

  it("optionsForMenu('unmanaged') omits delete-bundle, update, and artifacts", () => {
    const opts = optionsForMenu("unmanaged");
    const values = opts.map((o) => o.value);
    expect(values).not.toContain("delete-bundle");
    expect(values).not.toContain("update");
    expect(values).not.toContain("artifacts");
  });

  it("optionsForMenu('global') keeps the list small and back-terminated", () => {
    const opts = optionsForMenu("global");
    expect(opts.map((o) => o.value)).toEqual(["open", "install-from", "artifacts", "back"]);
  });
});
