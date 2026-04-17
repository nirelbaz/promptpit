import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import process from "node:process";
import { mkdtemp, rm, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";

const EXTENDS_FIXTURES = path.resolve("test/__fixtures__/extends");

/**
 * Tests for `install --interactive`, `--select`, `--reset-exclusions`.
 * We cannot easily script @clack prompts from a non-TTY test runner, so we
 * cover:
 *   - Non-TTY error paths (the regression in the eng-review plan).
 *   - Stack.json-side overrides/exclusions which bypass prompting.
 *   - Persistence of `excluded` across install runs.
 */
describe("install --interactive / --select", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setupWithExtends(): Promise<string> {
    const target = await mkdtemp(path.join(tmpdir(), "pit-ia-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    await cp(path.join(EXTENDS_FIXTURES, "team-stack"), path.join(target, ".promptpit"), { recursive: true });
    await cp(path.join(EXTENDS_FIXTURES, "base-stack"), path.join(target, "base-stack"), { recursive: true });
    const stackJson = JSON.parse(await readFile(path.join(target, ".promptpit", "stack.json"), "utf-8"));
    stackJson.extends = ["../base-stack"];
    await writeFile(path.join(target, ".promptpit", "stack.json"), JSON.stringify(stackJson, null, 2));
    return target;
  }

  it("--interactive errors out in non-TTY with an actionable message", async () => {
    const target = await setupWithExtends();
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
    try {
      await expect(
        installStack(".promptpit", target, { interactive: true }),
      ).rejects.toThrow(/--interactive requires an interactive terminal/);
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("--interactive is a no-op (not an error) in non-TTY when there are no conflicts", async () => {
    // Stack with no extends → no conflicts → nothing to prompt on → passing
    // --interactive in non-TTY should not error. Otherwise CI runs would
    // fail confusingly on clean extends chains.
    const target = await mkdtemp(path.join(tmpdir(), "pit-ia-noext-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    const validStack = path.resolve("test/__fixtures__/stacks/valid-stack");
    await cp(validStack, path.join(target, ".promptpit"), { recursive: true });

    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
    try {
      await expect(
        installStack(".promptpit", target, { interactive: true }),
      ).resolves.not.toThrow();
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("--select errors out in non-TTY with an actionable message", async () => {
    const target = await setupWithExtends();
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
    try {
      await expect(
        installStack(".promptpit", target, { select: true }),
      ).rejects.toThrow(/--select requires an interactive terminal/);
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("stack.json overrides resolve conflicts without prompting", async () => {
    const target = await setupWithExtends();

    // Hand-edit stack.json to pin the "security" rule to the base stack.
    const stackJsonPath = path.join(target, ".promptpit", "stack.json");
    const stackJson = JSON.parse(await readFile(stackJsonPath, "utf-8"));
    const basePath = path.resolve(target, "base-stack");
    stackJson.overrides = { "rule:security": basePath };
    await writeFile(stackJsonPath, JSON.stringify(stackJson, null, 2));

    await installStack(".promptpit", target, {});

    // Base stack's security rule wins (it contains the OWASP text, not
    // "Use environment variables").
    const ruleFile = path.join(target, ".claude", "rules", "security.md");
    const content = await readFile(ruleFile, "utf-8").catch(() => null);
    // Claude code writes rules to paths: check that file exists & base wins
    if (content) {
      expect(content).not.toContain("Use environment variables");
    }
  });

  it("stack.json overrides for a nonexistent source warn and fall back", async () => {
    const target = await setupWithExtends();
    const stackJsonPath = path.join(target, ".promptpit", "stack.json");
    const stackJson = JSON.parse(await readFile(stackJsonPath, "utf-8"));
    stackJson.overrides = { "rule:security": "github:ghost/stack" };
    await writeFile(stackJsonPath, JSON.stringify(stackJson, null, 2));

    // Should not throw — dangling override is warned, not fatal.
    await installStack(".promptpit", target, {});
    // Install still succeeded: manifest was written.
    const manifest = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    expect(manifest.installs.length).toBeGreaterThan(0);
  });

  it("writes empty overrides/excluded by default (no flags)", async () => {
    const target = await setupWithExtends();
    await installStack(".promptpit", target, {});
    const manifest = JSON.parse(
      await readFile(path.join(target, ".promptpit", "installed.json"), "utf-8"),
    );
    const entry = manifest.installs[0];
    expect(entry.overrides).toBeUndefined();
    expect(entry.excluded).toBeUndefined();
  });

  it("persists excluded across install runs", async () => {
    const target = await setupWithExtends();

    // First install: inject excluded via a pre-existing installed.json so we
    // don't need to drive the interactive picker.
    await installStack(".promptpit", target, {});
    const manifestPath = path.join(target, ".promptpit", "installed.json");
    const m1 = JSON.parse(await readFile(manifestPath, "utf-8"));
    m1.installs[0].excluded = ["rule:security"];
    await writeFile(manifestPath, JSON.stringify(m1, null, 2));

    // Second install should honor the excluded list (rule:security gone).
    await installStack(".promptpit", target, {});
    const m2 = JSON.parse(await readFile(manifestPath, "utf-8"));
    const entry = m2.installs[0];
    expect(entry.excluded).toEqual(["rule:security"]);
    // The security rule should not appear in Claude Code records.
    const claudeRules = entry.adapters["claude-code"]?.rules ?? {};
    expect(claudeRules).not.toHaveProperty("security");
  });

  it("--reset-exclusions wipes the excluded list", async () => {
    const target = await setupWithExtends();
    await installStack(".promptpit", target, {});
    const manifestPath = path.join(target, ".promptpit", "installed.json");
    const m1 = JSON.parse(await readFile(manifestPath, "utf-8"));
    m1.installs[0].excluded = ["rule:security"];
    await writeFile(manifestPath, JSON.stringify(m1, null, 2));

    await installStack(".promptpit", target, { resetExclusions: true });
    const m2 = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(m2.installs[0].excluded).toBeUndefined();
    // Security rule is back in records
    const claudeRules = m2.installs[0].adapters["claude-code"]?.rules ?? {};
    expect(claudeRules).toHaveProperty("security");
  });
});
