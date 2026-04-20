import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { scan } from "../../src/core/scan.js";
import { computeHash } from "../../src/core/manifest.js";

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

  it("counts real artifacts for each unmanagedAnnotation (not hardcoded zeros)", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    const frontend = stacks.find((s) => s.name === "app-frontend")!;
    const uiAnnotation = frontend.unmanagedAnnotations.find((a) =>
      a.subpath.endsWith("packages/ui"),
    );
    expect(uiAnnotation).toBeDefined();
    // packages/ui has one .cursor/rules/ui.mdc → cursor adapter should count 1 rule
    expect(uiAnnotation!.counts.rules).toBe(1);
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

  it("adds a virtual global stack when globalRoots contain AI config", async () => {
    const stacks = await scan({
      cwd: fixture,
      globalRoots: [path.resolve(__dirname, "../__fixtures__/scan-global")],
      depth: 5,
    });
    const global = stacks.find((s) => s.kind === "global");
    expect(global).toBeDefined();
    expect(global!.name).toBe("user-level");
    expect(global!.adapters.length).toBeGreaterThan(0);
  });

  it("does not add a global stack when globalRoots has no AI config", async () => {
    const stacks = await scan({ cwd: fixture, globalRoots: [], depth: 5 });
    expect(stacks.find((s) => s.kind === "global")).toBeUndefined();
  });

  it("skipLocal=true scans only globalRoots, skipping the cwd walk", async () => {
    const stacks = await scan({
      cwd: fixture,
      globalRoots: [path.resolve(__dirname, "../__fixtures__/scan-global")],
      depth: 5,
      skipLocal: true,
    });
    // No current-tree stacks should appear.
    expect(stacks.find((s) => s.name === "app-frontend")).toBeUndefined();
    expect(stacks.find((s) => s.name === "app-backend")).toBeUndefined();
    expect(stacks.find((s) => s.name === "llm-demo")).toBeUndefined();
    expect(stacks.find((s) => s.kind === "global")).toBeDefined();
  });

  it("surfaces unsupported AI tool dirs as unsupportedTools", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pit-unsupported-"));
    // A real stack root (so scan creates a hit for it) plus a .windsurf/ dir.
    writeFileSync(path.join(root, "CLAUDE.md"), "# hi\n");
    mkdirSync(path.join(root, ".windsurf", "rules"), { recursive: true });
    writeFileSync(path.join(root, ".windsurf", "rules", "x.md"), "rule");

    const stacks = await scan({ cwd: root, globalRoots: [], depth: 2 });
    const hit = stacks.find((s) => s.root === root);
    expect(hit).toBeDefined();
    expect(hit!.unsupportedTools).toContain(".windsurf");
  });

  it("creates a stack entry for repos that ONLY have unsupported tool config", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pit-only-windsurf-"));
    mkdirSync(path.join(root, ".windsurf", "rules"), { recursive: true });
    writeFileSync(path.join(root, ".windsurf", "rules", "x.md"), "rule");
    const stacks = await scan({ cwd: root, globalRoots: [], depth: 2 });
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.unsupportedTools).toEqual([".windsurf"]);
  });

  it("ignores translated docs/examples trees by default", async () => {
    // Mirrors repos like everything-claude-code where `docs/ja-JP/skills/...`
    // contains translated copies of AI config. Without ignore these
    // surface as dozens of bogus unmanaged stacks.
    const root = mkdtempSync(path.join(tmpdir(), "pit-docs-ignore-"));
    mkdirSync(path.join(root, ".promptpit"), { recursive: true });
    writeFileSync(
      path.join(root, ".promptpit", "stack.json"),
      JSON.stringify({ name: "docs-root", version: "0.1.0" }),
    );
    writeFileSync(path.join(root, "CLAUDE.md"), "# root\n");
    // Translated copy under docs/ — must NOT surface as a stack.
    mkdirSync(path.join(root, "docs", "ja-JP"), { recursive: true });
    writeFileSync(path.join(root, "docs", "ja-JP", "CLAUDE.md"), "# translated\n");
    mkdirSync(path.join(root, "examples", "demo"), { recursive: true });
    writeFileSync(path.join(root, "examples", "demo", "AGENTS.md"), "# example\n");

    const stacks = await scan({ cwd: root, globalRoots: [], depth: 5 });
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.kind).toBe("managed");
    // Neither the docs subtree nor examples subtree should show as an annotation.
    expect(stacks[0]!.unmanagedAnnotations.find((a) => a.subpath.startsWith("docs"))).toBeUndefined();
    expect(stacks[0]!.unmanagedAnnotations.find((a) => a.subpath.startsWith("examples"))).toBeUndefined();
  });

  it("reports per-adapter drift rather than broadcasting stack-level drift", async () => {
    // Fixture: a managed stack with rules tracked for two adapters. On disk,
    // the claude-code rule file matches the recorded hash (synced) while the
    // cursor rule file does NOT (drifted). A bug previously tagged all
    // adapters as drifted whenever any one was.
    const root = mkdtempSync(path.join(tmpdir(), "pit-per-adapter-drift-"));

    const claudeRuleContent = "# claude rule\nbody\n";
    const cursorRuleOnDisk = "# drifted cursor rule\n";
    const cursorRuleRecordedContent = "# original cursor rule\n"; // different → drifted

    mkdirSync(path.join(root, ".promptpit"), { recursive: true });
    mkdirSync(path.join(root, ".claude", "rules"), { recursive: true });
    mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });

    writeFileSync(
      path.join(root, ".promptpit", "stack.json"),
      JSON.stringify({ name: "per-adapter-drift", version: "0.1.0" }),
    );
    // CLAUDE.md triggers claude-code detection; .cursor/rules/ triggers cursor.
    writeFileSync(path.join(root, "CLAUDE.md"), "# instructions\n");
    writeFileSync(path.join(root, ".claude", "rules", "style.md"), claudeRuleContent);
    writeFileSync(path.join(root, ".cursor", "rules", "style.mdc"), cursorRuleOnDisk);

    const manifest = {
      version: 1,
      installs: [
        {
          stack: "per-adapter-drift",
          stackVersion: "0.1.0",
          installedAt: new Date().toISOString(),
          adapters: {
            "claude-code": { rules: { style: { hash: computeHash(claudeRuleContent) } } },
            cursor: { rules: { style: { hash: computeHash(cursorRuleRecordedContent) } } },
          },
        },
      ],
    };
    writeFileSync(path.join(root, ".promptpit", "installed.json"), JSON.stringify(manifest));

    const stacks = await scan({ cwd: root, globalRoots: [], depth: 2 });
    const managed = stacks.find((s) => s.kind === "managed");
    expect(managed).toBeDefined();
    const byId = Object.fromEntries(managed!.adapters.map((a) => [a.id, a]));
    expect(byId["cursor"]?.drift).toBe("drifted");
    expect(byId["claude-code"]?.drift).toBe("synced");
    // Overall is still the OR across adapters.
    expect(managed!.overallDrift).toBe("drifted");
  });
});
