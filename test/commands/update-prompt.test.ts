import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import path from "node:path";
import process from "node:process";
import { mkdtemp, rm, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";

/**
 * Drive update --interactive by mocking the interactive module. Covers:
 *   - collectDriftCandidates + promptDriftResolutions are invoked on drift
 *   - "keep" (fork) writes {forked:true, baselineHash} to the manifest
 *   - "upstream" overwrites the file and clears forked
 *   - "skip" preserves the old manifest hash
 *   - "diff" branch loops and re-prompts
 *   - No candidates → the resolver is NOT called (fast path)
 */

type DriftAction = "keep" | "upstream" | "diff" | "skip";

// Scriptable: each call to chooseDriftAction returns the next entry.
let driftScript: DriftAction[] = [];
let driftCallCount = 0;

vi.mock("../../src/shared/interactive.js", () => ({
  isInteractive: () => true,
  requireInteractive: () => {},
  chooseOne: async (_m: unknown, options: Array<{ value: unknown }>) => options[0]!.value,
  chooseMany: async (_m: unknown, _o: unknown, initial?: unknown) =>
    (initial as unknown[]) ?? [],
  chooseDriftAction: async (): Promise<DriftAction> => {
    const next = driftScript[driftCallCount++] ?? "skip";
    return next;
  },
  confirm: async () => true,
  text: async () => "",
}));

const { installStack } = await import("../../src/commands/install.js");
const { updateStacks } = await import("../../src/commands/update.js");

const STACK_FIXTURE = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("update --interactive (drift resolution)", () => {
  const tmpDirs: string[] = [];
  const origOutTty = process.stdout.isTTY;
  const origInTty = process.stdin.isTTY;

  beforeEach(() => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = true;
    driftScript = [];
    driftCallCount = 0;
  });

  afterEach(async () => {
    (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOutTty;
    (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origInTty;
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupDrifted(): Promise<{ target: string; source: string }> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-up-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    await cp(STACK_FIXTURE, path.join(target, ".promptpit"), { recursive: true });
    await installStack(".promptpit", target, {});

    // Induce BOTH:
    //   - Local drift: mutate marker content in CLAUDE.md (the string
    //     "TypeScript" is inside the marker, unlike the stack name which
    //     lives in the marker tags themselves).
    //   - Upstream change: mutate the source .promptpit so delta detects it
    const claudePath = path.join(target, "CLAUDE.md");
    const c = await readFile(claudePath, "utf-8");
    await writeFile(
      claudePath,
      c.replace(/TypeScript/, "TypeScript\n\n<!-- LOCAL EDIT -->"),
    );
    const agentPath = path.join(target, ".promptpit", "agent.promptpit.md");
    const a = await readFile(agentPath, "utf-8");
    await writeFile(agentPath, a + "\nUPSTREAM EDIT\n");

    return { target, source: path.join(target, ".promptpit") };
  }

  it("does not call the resolver when there are no drifted+changing artifacts", async () => {
    // Install, then update with no drift → no prompts.
    const target = await mkdtemp(path.join(tmpdir(), "pit-up-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    await cp(STACK_FIXTURE, path.join(target, ".promptpit"), { recursive: true });
    await installStack(".promptpit", target, {});
    await updateStacks(target, { interactive: true });
    expect(driftCallCount).toBe(0);
  });

  it("'keep' records {forked:true, baselineHash} in the manifest", async () => {
    const { target } = await setupDrifted();
    driftScript = ["keep"];
    await updateStacks(target, { interactive: true });
    const manifest = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    const adapter = manifest.installs[0].adapters["claude-code"];
    expect(adapter.instructions.forked).toBe(true);
    expect(typeof adapter.instructions.baselineHash).toBe("string");
    expect(adapter.instructions.baselineHash.length).toBeGreaterThan(0);
  });

  it("'upstream' overwrites the file and does NOT set forked", async () => {
    const { target } = await setupDrifted();
    driftScript = ["upstream"];
    await updateStacks(target, { interactive: true });
    const manifest = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    const adapter = manifest.installs[0].adapters["claude-code"];
    expect(adapter.instructions.forked).toBeUndefined();
    // File should contain the upstream edit now.
    const claude = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claude).toContain("UPSTREAM EDIT");
  });

  it("'skip' preserves the old manifest hash", async () => {
    const { target } = await setupDrifted();
    const before = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    const oldHash = before.installs[0].adapters["claude-code"].instructions.hash;

    driftScript = ["skip"];
    await updateStacks(target, { interactive: true });

    const after = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    const newHash = after.installs[0].adapters["claude-code"].instructions.hash;
    expect(newHash).toBe(oldHash);
    expect(after.installs[0].adapters["claude-code"].instructions.forked).toBeUndefined();
  });

  it("'diff' loops and re-prompts; final choice wins", async () => {
    const { target } = await setupDrifted();
    // First call returns "diff" (print diff, loop), second call returns "keep".
    driftScript = ["diff", "keep"];
    await updateStacks(target, { interactive: true });
    expect(driftCallCount).toBe(2);
    const manifest = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    expect(manifest.installs[0].adapters["claude-code"].instructions.forked).toBe(true);
  });
});
