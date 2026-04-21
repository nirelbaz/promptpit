import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { lsCommand } from "../../src/commands/ls.js";
import { computeHash } from "../../src/core/manifest.js";

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

  it("--short prints one line per stack containing name and root", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await lsCommand(fixture, { short: true, scope: "current", global: false });
    expect(code).toBe(0);
    const lines = log.mock.calls.map((c) => String(c[0]));
    // One line per discovered stack (3 in scan-basic).
    expect(lines.length).toBe(3);
    for (const name of ["app-frontend", "app-backend", "llm-demo"]) {
      const hit = lines.find((l) => l.includes(name));
      expect(hit, `expected line for ${name}`).toBeDefined();
      expect(hit!).toContain(path.join(fixture, name));
    }
  });

  it("--short --managed prints only the managed stack's one-liner", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await lsCommand(fixture, {
      short: true,
      managed: true,
      scope: "current",
      global: false,
    });
    expect(code).toBe(0);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("app-frontend");
    // The managed-only one-liner encodes version per ls.ts:69.
    expect(lines[0]).toMatch(/· v\d/);
  });

  it("--strict returns exit code 1 when a stack is drifted", async () => {
    // Build a managed stack with a cursor rule whose on-disk content does NOT
    // match the hash recorded in installed.json, forcing reconcile to report
    // drift. Mirrors the per-adapter-drift fixture in scan.test.ts.
    const root = mkdtempSync(path.join(tmpdir(), "pit-ls-strict-drift-"));
    mkdirSync(path.join(root, ".promptpit"), { recursive: true });
    mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });

    writeFileSync(
      path.join(root, ".promptpit", "stack.json"),
      JSON.stringify({ name: "drift-stack", version: "0.1.0" }),
    );
    writeFileSync(path.join(root, ".cursor", "rules", "style.mdc"), "# on-disk content\n");
    const manifest = {
      version: 1,
      installs: [
        {
          stack: "drift-stack",
          stackVersion: "0.1.0",
          installedAt: new Date().toISOString(),
          adapters: {
            cursor: { rules: { style: { hash: computeHash("# original content\n") } } },
          },
        },
      ],
    };
    writeFileSync(path.join(root, ".promptpit", "installed.json"), JSON.stringify(manifest));

    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await lsCommand(root, { strict: true, scope: "current", global: false });
    expect(code).toBe(1);
  });
});
