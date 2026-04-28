import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { installStack } from "../../src/commands/install.js";
import { reconcileAll } from "../../src/core/reconcile.js";
import {
  collectDriftBack,
  listDriftCandidates,
} from "../../src/core/collect-drift.js";
import { readManifest } from "../../src/core/manifest.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("collectDriftBack", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupInstalled(): Promise<string> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-collect-drift-"));
    tmpDirs.push(target);
    // Copy bundle into place so the bundle exists for drift-back to write to.
    const { cp } = await import("node:fs/promises");
    await cp(VALID_STACK, path.join(target, ".promptpit"), { recursive: true });
    await writeFile(path.join(target, "CLAUDE.md"), "# My Project\n");
    await installStack(VALID_STACK, target, {});
    return target;
  }

  it("listDriftCandidates returns empty when nothing has drifted", async () => {
    const target = await setupInstalled();
    const drifted = await listDriftCandidates(target);
    expect(drifted).toEqual([]);
  });

  it("detects drifted skill and pulls canonical content into the bundle", async () => {
    const target = await setupInstalled();
    const canonicalSkill = path.join(target, ".agents", "skills", "browse", "SKILL.md");
    const before = await readFile(canonicalSkill, "utf-8");
    const modified = before + "\n\nLocal change.\n";
    await writeFile(canonicalSkill, modified);

    const drifted = await listDriftCandidates(target);
    // Skill is shared across adapters that track it; expect one entry per adapter.
    expect(drifted.length).toBeGreaterThanOrEqual(1);
    expect(drifted.every((d) => d.type === "skill" && d.name === "browse")).toBe(true);

    const result = await collectDriftBack(target, drifted);
    expect(result.dryRun).toBe(false);
    expect(result.accepted.length).toBeGreaterThanOrEqual(1);
    expect(result.accepted[0]).toMatchObject({ type: "skill", name: "browse" });
    expect(result.skipped).toEqual([]);
    expect(result.manifestUpdated).toBe(true);

    // Bundle's skill should match the canonical file
    const bundleSkill = path.join(target, ".promptpit", "skills", "browse", "SKILL.md");
    expect(await readFile(bundleSkill, "utf-8")).toBe(modified);

    // After drift-back, reconcile should be clean
    const re = await reconcileAll(target);
    const skillArtifact = re.stacks
      .flatMap((s) => s.adapters)
      .flatMap((a) => a.artifacts)
      .find((a) => a.type === "skill" && a.name === "browse");
    expect(skillArtifact?.state).toBe("synced");
  });

  it("dry-run does not write to the bundle but reports planned files", async () => {
    const target = await setupInstalled();
    const canonicalSkill = path.join(target, ".agents", "skills", "browse", "SKILL.md");
    const before = await readFile(canonicalSkill, "utf-8");
    const bundleSkill = path.join(target, ".promptpit", "skills", "browse", "SKILL.md");
    const bundleBefore = await readFile(bundleSkill, "utf-8");
    await writeFile(canonicalSkill, before + "\n\nDry edit.\n");

    const drifted = await listDriftCandidates(target);
    const result = await collectDriftBack(target, drifted, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.accepted.length).toBeGreaterThanOrEqual(1);
    expect(result.plannedFiles).toBeDefined();
    expect(result.plannedFiles!.length).toBeGreaterThan(0);

    // Bundle untouched
    expect(await readFile(bundleSkill, "utf-8")).toBe(bundleBefore);
    // Manifest untouched (hash unchanged)
    const re = await reconcileAll(target);
    const skill = re.stacks
      .flatMap((s) => s.adapters)
      .flatMap((a) => a.artifacts)
      .find((a) => a.type === "skill" && a.name === "browse");
    expect(skill?.state).toBe("drifted");
  });

  it("skips a selection that is no longer drifted", async () => {
    const target = await setupInstalled();
    const drifted = [
      { adapterId: "claude-code", type: "skill" as const, name: "browse" },
    ];
    const result = await collectDriftBack(target, drifted);
    expect(result.accepted).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/synced/);
  });

  it("rehashes manifest entries so future reconciles read as synced", async () => {
    const target = await setupInstalled();
    const canonicalSkill = path.join(target, ".agents", "skills", "browse", "SKILL.md");
    await writeFile(canonicalSkill, "modified\n");

    const drifted = await listDriftCandidates(target);
    await collectDriftBack(target, drifted);

    const manifest = await readManifest(target);
    const entry = manifest.installs[0]!;
    const skillRecord = entry.adapters["claude-code"]?.skills?.["browse"];
    expect(skillRecord).toBeDefined();
    // Hash should now reflect the modified content (not the install-time hash)
    const re = await reconcileAll(target);
    const sk = re.stacks[0]!.adapters[0]!.artifacts.find(
      (a) => a.type === "skill" && a.name === "browse",
    );
    expect(sk?.state).toBe("synced");
    expect(skillRecord!.hash).toBe(sk?.actualHash);
  });

  it("throws when no stacks are installed", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "pit-collect-drift-empty-"));
    tmpDirs.push(empty);
    await expect(collectDriftBack(empty, [])).rejects.toThrow("No stacks installed");
  });
});
