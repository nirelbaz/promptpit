import { describe, it, expect } from "vitest";
import { renderStackList } from "../../../src/tui/renderers/stack-list.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

function managed(over: Partial<ScannedStack> = {}): ScannedStack {
  return {
    root: "/u/projects/app-frontend",
    kind: "managed",
    name: "app-frontend",
    manifestCorrupt: false,
    promptpit: { stackVersion: "0.3.1", hasInstalledJson: true },
    adapters: [
      { id: "claude-code", artifacts: { skills: 3, rules: 0, agents: 1, commands: 0, mcp: 0, instructions: true }, drift: "drifted" },
      { id: "cursor", artifacts: { skills: 0, rules: 5, agents: 0, commands: 0, mcp: 0, instructions: false }, drift: "synced" },
    ],
    unmanagedAnnotations: [],
    unsupportedTools: [],
    overallDrift: "drifted",
    ...over,
  };
}

describe("renderStackList", () => {
  it("renders managed + unmanaged + global into grouped sections", () => {
    const stacks: ScannedStack[] = [
      managed(),
      { root: "/u/projects/app-backend", kind: "unmanaged", name: "app-backend", manifestCorrupt: false,
        adapters: [{ id: "claude-code", artifacts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 1, instructions: true }, drift: "unknown" }],
        unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown" },
      { root: "~", kind: "global", name: "user-level", manifestCorrupt: false,
        adapters: [{ id: "claude-code", artifacts: { skills: 12, rules: 0, agents: 3, commands: 4, mcp: 0, instructions: false }, drift: "unknown" }],
        unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown" },
    ];
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks, scopeLabel: "current tree (depth 5) + global" });
    expect(out).toMatchSnapshot();
  });

  it("shows drifted badge for managed stacks with drift", () => {
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks: [managed()], scopeLabel: "current" });
    expect(out).toContain("drifted");
  });

  it("shows subpath annotations on managed rows", () => {
    const stack = managed({ unmanagedAnnotations: [{
      subpath: "packages/ui", adapterId: "cursor",
      counts: { skills: 0, rules: 2, agents: 0, commands: 0, mcp: 0, instructions: false },
    }] });
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks: [stack], scopeLabel: "current" });
    expect(out).toMatch(/└─\s+\.\/packages\/ui/);
    expect(out).toContain("cursor");
  });

  it("shows ancestor stacks using an absolute path (not relative)", () => {
    const ancestor: ScannedStack = {
      root: "/u/projects",
      kind: "unmanaged",
      name: "projects",
      manifestCorrupt: false,
      adapters: [{ id: "claude-code", artifacts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: true }, drift: "unknown" }],
      unmanagedAnnotations: [],
      unsupportedTools: [],
      overallDrift: "unknown",
    };
    const out = renderStackList({ cwd: "/u/projects/app-frontend", stacks: [ancestor], scopeLabel: "test" });
    // Ancestor root is outside cwd, so it must render as absolute — never as
    // a confusing `..` relative path.
    expect(out).toContain("/u/projects");
    expect(out).not.toMatch(/\.\.\//);
  });

  it("sorts local stacks shallow-first by cwd-relative depth, cwd root at top", () => {
    const cwd = "/u/repo";
    const root: ScannedStack = {
      root: "/u/repo",
      kind: "managed", name: "root-stack", manifestCorrupt: false,
      promptpit: { stackVersion: "0.1.0", hasInstalledJson: true },
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "synced",
    };
    const deep: ScannedStack = {
      root: "/u/repo/pkg/ui/app",
      kind: "unmanaged", name: "deep", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    const mid: ScannedStack = {
      root: "/u/repo/pkg/core",
      kind: "unmanaged", name: "mid", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    const out = renderStackList({ cwd, stacks: [deep, mid, root], scopeLabel: "test" });
    const iRoot = out.indexOf("root-stack");
    const iMid = out.indexOf("mid");
    const iDeep = out.indexOf("deep");
    expect(iRoot).toBeGreaterThan(-1);
    expect(iRoot).toBeLessThan(iMid);
    expect(iMid).toBeLessThan(iDeep);
  });

  it("renders cwd-root as '.' and nested stacks as cwd-relative paths", () => {
    const cwd = "/u/repo";
    const root: ScannedStack = {
      root: "/u/repo",
      kind: "managed", name: "root-stack", manifestCorrupt: false,
      promptpit: { stackVersion: "0.1.0", hasInstalledJson: true },
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "synced",
    };
    const nested: ScannedStack = {
      root: "/u/repo/pkg/ui",
      kind: "unmanaged", name: "nested", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    const out = renderStackList({ cwd, stacks: [root, nested], scopeLabel: "test" });
    // cwd-root renders without a path line (redundant — you're standing in it).
    expect(out).toContain("root-stack");
    expect(out).not.toMatch(/root-stack[\s\S]*\s\.\s*$/m);
    // Nested stack's path appears on its own dim line under the title.
    expect(out).toContain("nested");
    expect(out).toContain("pkg/ui");
    // The old "current folder (X)" group label must be gone.
    expect(out).not.toMatch(/current folder/);
  });

  it("prefixes nested stack paths with ./ and trims the stack-name tail", () => {
    const cwd = "/u/repo";
    // Name matches the leaf segment — the tail is redundant with the name column.
    const sameLeaf: ScannedStack = {
      root: "/u/repo/packages/app-frontend",
      kind: "unmanaged", name: "app-frontend", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    // Name does not match the leaf — full path with `./` prefix.
    const diffLeaf: ScannedStack = {
      root: "/u/repo/tools/ci",
      kind: "unmanaged", name: "my-tool", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    const out = renderStackList({ cwd, stacks: [sameLeaf, diffLeaf], scopeLabel: "test" });
    expect(out).toContain("./packages/");
    expect(out).not.toMatch(/\.\/packages\/app-frontend/);
    expect(out).toContain("./tools/ci");
  });

  it("hides the path line when the whole path is just the stack name", () => {
    const cwd = "/u/repo";
    const s: ScannedStack = {
      root: "/u/repo/foo",
      kind: "unmanaged", name: "foo", manifestCorrupt: false,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown",
    };
    const out = renderStackList({ cwd, stacks: [s], scopeLabel: "test" });
    expect(out).toContain("foo");
    // No path line should appear (no `./` prefix anywhere).
    expect(out).not.toContain("./");
  });

  it("groups global stacks under a 'global' subheader", () => {
    const stacks: ScannedStack[] = [
      { root: "~", kind: "global", name: "user-level", manifestCorrupt: false,
        adapters: [{ id: "claude-code", artifacts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false }, drift: "unknown" }],
        unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "unknown" },
    ];
    const out = renderStackList({ cwd: "/u/repo", stacks, scopeLabel: "test" });
    expect(out).toMatch(/^─── global ───/m);
    expect(out).toContain("user-level");
  });

  it("collapses multiple annotations with the same subpath into one line", () => {
    const cwd = "/u/repo";
    const s: ScannedStack = {
      root: "/u/repo",
      kind: "managed", name: "root", manifestCorrupt: false,
      promptpit: { stackVersion: "0.1.0", hasInstalledJson: true },
      adapters: [],
      unmanagedAnnotations: [
        { subpath: "pkg/a", adapterId: "claude-code", counts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false } },
        { subpath: "pkg/a", adapterId: "standards",    counts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false } },
        // Duplicate adapterId at same subpath — must be deduped, not shown as "claude-code, claude-code".
        { subpath: "pkg/a", adapterId: "claude-code", counts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false } },
        { subpath: "pkg/b", adapterId: "cursor",       counts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false } },
      ],
      unsupportedTools: [],
      overallDrift: "synced",
    };
    const out = renderStackList({ cwd, stacks: [s], scopeLabel: "test" });
    expect(out).toMatch(/└─ \.\/pkg\/a\s+claude-code, standards/);
    expect(out).not.toMatch(/claude-code, claude-code/);
    expect(out).toMatch(/└─ \.\/pkg\/b\s+cursor/);
  });

  it("strips ANSI/control characters from author-controlled strings", () => {
    const cwd = "/u/repo";
    const s: ScannedStack = {
      root: "/u/repo",
      kind: "managed",
      // Author-controlled name with escape sequences that could clear the screen
      // or spoof status. Renderer must strip them before display.
      name: "evil\x1b[2Jspoof",
      manifestCorrupt: false,
      promptpit: { stackVersion: "0.1.0", hasInstalledJson: true },
      adapters: [],
      unmanagedAnnotations: [
        { subpath: "foo\rbar", adapterId: "cursor", counts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false } },
      ],
      unsupportedTools: ["nasty\x07tool"],
      overallDrift: "synced",
    };
    const out = renderStackList({ cwd, stacks: [s], scopeLabel: "test" });
    // No raw control bytes should reach the output — the ESC byte (\x1b) that
    // would make `[2J` an actual screen-clear is stripped, leaving harmless
    // printable text behind.
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\x07");
    // The surrounding printable text still renders (defanged, not erased).
    expect(out).toContain("evil");
    expect(out).toContain("spoof");
    expect(out).toContain("foobar");
    expect(out).toContain("nastytool");
  });

  it("falls back to v? when a managed stack is missing promptpit", () => {
    // Schema permits this shape (promptpit is optional regardless of kind).
    // Renderer must not throw.
    const cwd = "/u/repo";
    const s: ScannedStack = {
      root: "/u/repo",
      kind: "managed", name: "broken", manifestCorrupt: true,
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [],
      overallDrift: "unknown",
    };
    const out = renderStackList({ cwd, stacks: [s], scopeLabel: "test" });
    expect(out).toContain("broken");
    expect(out).toContain("managed · v?");
  });

  it("legend explains the └─ annotation line", () => {
    const cwd = "/u/repo";
    const s: ScannedStack = {
      root: "/u/repo", kind: "managed", name: "x", manifestCorrupt: false,
      promptpit: { stackVersion: "0.1.0", hasInstalledJson: true },
      adapters: [], unmanagedAnnotations: [], unsupportedTools: [], overallDrift: "synced",
    };
    const out = renderStackList({ cwd, stacks: [s], scopeLabel: "test" });
    expect(out).toMatch(/└─\s+nested config/);
  });

  it("renders onboarding card when stacks is empty", () => {
    const out = renderStackList({ cwd: "/u/projects/new-repo", stacks: [], scopeLabel: "current (depth 5) + global" });
    expect(out).toMatch(/No AI config found/);
    expect(out).toMatch(/pit init/);
  });

  it("includes a compact-counts legend when stacks are rendered", () => {
    const out = renderStackList({
      cwd: "/u/projects/app-frontend",
      stacks: [managed()],
      scopeLabel: "current",
    });
    expect(out).toMatch(/legend:/);
    expect(out).toMatch(/s=skills.*a=agents/);
  });

  it("omits the legend on empty-state output", () => {
    const out = renderStackList({ cwd: "/u/x", stacks: [], scopeLabel: "current" });
    expect(out).not.toMatch(/legend:/);
  });

  it("renders no-match notice (not onboarding) when filters masked results", () => {
    const out = renderStackList({
      cwd: "/u/projects/new-repo",
      stacks: [],
      scopeLabel: "current",
      filterActive: true,
    });
    expect(out).toMatch(/No stacks match the active filters/);
    expect(out).not.toMatch(/pit init/);
  });
});
