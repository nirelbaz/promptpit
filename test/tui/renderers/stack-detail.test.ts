import { describe, it, expect } from "vitest";
import { renderStackDetail } from "../../../src/tui/renderers/stack-detail.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

const managed: ScannedStack = {
  root: "/u/projects/app-frontend",
  kind: "managed",
  name: "app-frontend",
  manifestCorrupt: false,
  promptpit: { stackVersion: "0.3.1", hasInstalledJson: true, source: "github:org/shared@v1.0" },
  adapters: [{ id: "claude-code", artifacts: { skills: 3, rules: 0, agents: 1, commands: 0, mcp: 0, instructions: true }, drift: "drifted" }],
  unmanagedAnnotations: [],
  overallDrift: "drifted",
};

describe("renderStackDetail", () => {
  it("shows source, version, drift summary for managed stack", () => {
    const out = renderStackDetail(managed, { driftedArtifactCount: 2, installedAtRelative: "2 days ago" });
    expect(out).toMatch(/app-frontend/);
    expect(out).toMatch(/pit-managed · v0\.3\.1/);
    expect(out).toMatch(/github:org\/shared/);
    expect(out).toMatch(/2 artifacts modified/);
  });

  it("shows detected counts for unmanaged stack", () => {
    const unmanaged = { ...managed, kind: "unmanaged" as const, name: "app-backend", overallDrift: "unknown" as const };
    delete (unmanaged as { promptpit?: unknown }).promptpit;
    const out = renderStackDetail(unmanaged, {});
    expect(out).toMatch(/unmanaged/);
    expect(out).toMatch(/detected:/);
    expect(out).not.toMatch(/pit-managed/);
  });

  it("renders global stack with the 'global' kind label and no pit-managed marker", () => {
    const global: ScannedStack = {
      root: "/Users/u/.claude",
      kind: "global",
      name: "user-level",
      manifestCorrupt: false,
      adapters: [
        { id: "claude-code", artifacts: { skills: 2, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: false }, drift: "unknown" },
      ],
      unmanagedAnnotations: [],
      unsupportedTools: [],
      overallDrift: "unknown",
    };
    const out = renderStackDetail(global, {});
    expect(out).toMatch(/global/);
    expect(out).toMatch(/detected:/);
    expect(out).not.toMatch(/pit-managed/);
  });

  it("falls back to 'local (no extends)' when promptpit.source is absent", () => {
    const localOnly: ScannedStack = {
      root: "/u/projects/local-stack",
      kind: "managed",
      name: "local-stack",
      manifestCorrupt: false,
      // No `source` field — this stack was not installed from an extends URL.
      promptpit: { stackVersion: "0.2.0", hasInstalledJson: true },
      adapters: [
        { id: "claude-code", artifacts: { skills: 0, rules: 0, agents: 0, commands: 0, mcp: 0, instructions: true }, drift: "synced" },
      ],
      unmanagedAnnotations: [],
      unsupportedTools: [],
      overallDrift: "synced",
    };
    const out = renderStackDetail(localOnly, {});
    expect(out).toMatch(/source: *local \(no extends\)/);
  });

  it("omits the drift line when driftedArtifactCount is 0", () => {
    // Same shape as the first test but with zero drifted artifacts. The
    // renderer should skip the yellow "drift: …" row entirely.
    const synced: ScannedStack = {
      ...managed,
      adapters: [{ ...managed.adapters[0]!, drift: "synced" }],
      overallDrift: "synced",
    };
    const out = renderStackDetail(synced, { driftedArtifactCount: 0, installedAtRelative: "just now" });
    expect(out).not.toMatch(/drift:/);
    // Installed line still renders — that's orthogonal to drift.
    expect(out).toMatch(/installed:/);
  });
});
