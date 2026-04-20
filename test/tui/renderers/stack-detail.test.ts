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
    expect(out).not.toMatch(/pit-managed/);
  });
});
