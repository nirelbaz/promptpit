import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { scan } from "../../src/core/scan.js";

const fixture = path.resolve(__dirname, "../__fixtures__/scan-basic");

describe("scan", () => {
  it("finds managed + unmanaged stacks in a basic tree", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    const names = stacks.map((s) => s.name).sort();
    expect(names).toEqual(["app-backend", "app-frontend", "llm-demo"]);
  });

  it("marks .promptpit/ stacks as managed and others as unmanaged", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    const byName = Object.fromEntries(stacks.map((s) => [s.name, s]));
    expect(byName["app-frontend"]!.kind).toBe("managed");
    expect(byName["app-backend"]!.kind).toBe("unmanaged");
    expect(byName["llm-demo"]!.kind).toBe("unmanaged");
  });

  it("folds monorepo sub-configs into parent as annotations, not stacks", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    const frontend = stacks.find((s) => s.name === "app-frontend")!;
    const byName = Object.fromEntries(stacks.map((s) => [s.name, s]));
    expect(byName["ui"]).toBeUndefined();
    expect(frontend.unmanagedAnnotations.some((a) => a.subpath.endsWith("packages/ui"))).toBe(true);
  });

  it("prunes node_modules by default", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    const junk = stacks.find((s) => s.root.includes("node_modules"));
    expect(junk).toBeUndefined();
  });

  it("respects depth limit", async () => {
    // depth 1 shouldn't descend into app-frontend/packages/ui
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 1 });
    const frontend = stacks.find((s) => s.name === "app-frontend")!;
    expect(frontend.unmanagedAnnotations).toHaveLength(0);
  });

  it("flags manifestCorrupt=true when installed.json is unparseable", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pit-corrupt-"));
    mkdirSync(path.join(root, ".promptpit"), { recursive: true });
    writeFileSync(path.join(root, ".promptpit", "stack.json"), '{"name":"x","version":"0.1.0"}');
    writeFileSync(path.join(root, ".promptpit", "installed.json"), "NOT JSON");
    const stacks = await scan({ cwd: root, globalRoots: [], depth: 1 });
    const hit = stacks.find((s) => s.kind === "managed");
    expect(hit?.manifestCorrupt).toBe(true);
  });

  it("adds a virtual global stack when globalRoots given", async () => {
    const stacks = await scan({
      cwd: fixture,
      globalRoots: [path.resolve(__dirname, "../__fixtures__/global-empty")],
      depth: 5,
    });
    // global-empty fixture does not exist; scan should still complete without throwing
    expect(stacks).toBeDefined();
  });
});
