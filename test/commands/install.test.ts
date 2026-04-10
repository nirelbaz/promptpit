import { describe, it, expect, afterEach } from "vitest";
import { installStack } from "../../src/commands/install.js";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");
const SCRIPT_STACK = path.resolve("test/__fixtures__/stacks/stack-with-scripts");

describe("installStack", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("installs stack from local path into a Claude Code project", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing content\n");

    await installStack(VALID_STACK, target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# Existing content");
    expect(claudeMd).toContain("promptpit:start:test-stack");
    expect(claudeMd).toContain("TypeScript strict mode");

    const skill = await readFile(
      path.join(target, ".claude", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toContain("browse");
  });

  it("writes .env file with placeholders", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const envFile = await readFile(path.join(target, ".env"), "utf-8");
    expect(envFile).toContain("DATABASE_URL");
  });

  it("appends missing .env keys without substring false positives", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");
    // Pre-populate .env with a key whose name is a superstring of a required key
    await writeFile(
      path.join(target, ".env"),
      "DATABASE_URL_BACKUP=old-value\n",
    );

    await installStack(VALID_STACK, target, {});

    const envFile = await readFile(path.join(target, ".env"), "utf-8");
    // DATABASE_URL should still be added even though DATABASE_URL_BACKUP exists
    expect(envFile).toContain("DATABASE_URL_BACKUP=old-value");
    expect(envFile).toMatch(/^DATABASE_URL=/m);
  });

  it("installs from .promptpit/ in target dir when source is default", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Copy valid stack into target/.promptpit/
    const { cp } = await import("node:fs/promises");
    await cp(VALID_STACK, path.join(target, ".promptpit"), { recursive: true });

    await installStack(".promptpit", target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:test-stack");
  });

  it("shows helpful error when no .promptpit/ found", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);

    await expect(
      installStack(".promptpit", target, {}),
    ).rejects.toThrow("No .promptpit/ found");
  });

  it("re-install replaces marker content", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});
    await installStack(VALID_STACK, target, {});

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    const startCount = (
      claudeMd.match(/promptpit:start:test-stack/g) || []
    ).length;
    expect(startCount).toBe(1);
  });

  it("writes canonical skills to .agents/skills/", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const canonical = await readFile(
      path.join(target, ".agents", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(canonical).toContain("browse");
  });

  it("creates symlinks from .claude/skills/ to canonical location", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const skillPath = path.join(target, ".claude", "skills", "browse", "SKILL.md");
    const stat = await lstat(skillPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // Symlink should be relative
    const linkTarget = await readlink(skillPath);
    expect(path.isAbsolute(linkTarget)).toBe(false);

    // Content should be readable through the symlink
    const content = await readFile(skillPath, "utf-8");
    expect(content).toContain("browse");
  });

  it("re-install updates both canonical and symlinks", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});
    await installStack(VALID_STACK, target, {});

    // Canonical should still exist
    const canonical = await readFile(
      path.join(target, ".agents", "skills", "browse", "SKILL.md"),
      "utf-8",
    );
    expect(canonical).toContain("browse");

    // Symlink should still work
    const skillPath = path.join(target, ".claude", "skills", "browse", "SKILL.md");
    const stat = await lstat(skillPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const content = await readFile(skillPath, "utf-8");
    expect(content).toContain("browse");
  });

  it("upgrade: replaces existing regular file with symlink", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Simulate old copy-based install by writing a regular file
    const skillDir = path.join(target, ".claude", "skills", "browse");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "old copy");

    // Run new install (should replace file with symlink)
    await installStack(VALID_STACK, target, {});

    const skillPath = path.join(skillDir, "SKILL.md");
    const stat = await lstat(skillPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const content = await readFile(skillPath, "utf-8");
    expect(content).toContain("browse");
  });

  it("dry-run does not write any files", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(VALID_STACK, target, { dryRun: true });

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toBe("# Existing\n");

    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(target, ".claude", "skills"))).toBe(false);
    expect(existsSync(path.join(target, ".promptpit", "installed.json"))).toBe(false);
    expect(existsSync(path.join(target, ".env"))).toBe(false);
  });

  it("dry-run with verbose does not write any files", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    await installStack(VALID_STACK, target, { dryRun: true, verbose: true });

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toBe("# Existing\n");
  });

  it("records agent hashes in install manifest after install", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-agents-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const { readManifest } = await import("../../src/core/manifest.js");
    const manifest = await readManifest(target);

    expect(manifest.installs).toHaveLength(1);
    const entry = manifest.installs[0]!;

    // At least one adapter should have an agents record with the reviewer hash
    const adapterWithAgents = Object.values(entry.adapters).find(
      (record) => record.agents && Object.keys(record.agents).length > 0,
    );
    expect(adapterWithAgents).toBeDefined();
    expect(adapterWithAgents!.agents).toHaveProperty("reviewer");
    expect(adapterWithAgents!.agents!["reviewer"]!.hash).toMatch(/^sha256:/);
  });

  it("inline adapter hashes agents even when agentInstructions is empty", async () => {
    // Covers the right branch of: agentInstructions || (agents.length > 0 && agents === "inline")
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-noinstrs-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    // Build a minimal stack with agents but no instructions
    const { mkdir } = await import("node:fs/promises");
    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-noinstrs-"));
    tmpDirs.push(stackDir);
    await writeFile(path.join(stackDir, "stack.json"), JSON.stringify({
      name: "agents-only", version: "1.0.0", agents: ["agents/helper"],
    }));
    await mkdir(path.join(stackDir, "agents"), { recursive: true });
    await writeFile(
      path.join(stackDir, "agents", "helper.md"),
      "---\nname: helper\ndescription: Helps\n---\n\nHelp.\n",
    );

    await installStack(stackDir, target, {});

    const { readManifest } = await import("../../src/core/manifest.js");
    const manifest = await readManifest(target);
    const standardsRecord = manifest.installs[0]!.adapters["standards"];
    expect(standardsRecord).toBeDefined();
    // Standards (inline) should have instructions hash even with no agentInstructions,
    // because agents are embedded in the marker block
    expect(standardsRecord!.instructions).toBeDefined();
    expect(standardsRecord!.instructions!.hash).toMatch(/^sha256:/);
  });

  it("copilot manifest hashes translated agent content (not source)", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-copilot-"));
    tmpDirs.push(target);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(target, ".github"), { recursive: true });
    await writeFile(path.join(target, ".github", "copilot-instructions.md"), "");

    await installStack(VALID_STACK, target, {});

    // Verify the on-disk .agent.md content matches the manifest hash
    const { readManifest, computeHash } = await import("../../src/core/manifest.js");
    const manifest = await readManifest(target);
    const copilotRecord = manifest.installs[0]!.adapters["copilot"];
    expect(copilotRecord).toBeDefined();
    expect(copilotRecord!.agents).toHaveProperty("reviewer");

    const onDisk = await readFile(
      path.join(target, ".github", "agents", "reviewer.agent.md"),
      "utf-8",
    );
    expect(computeHash(onDisk)).toBe(copilotRecord!.agents!["reviewer"]!.hash);
  });

  describe("install commands", () => {
    it("installs commands to Claude Code .claude/commands/", async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pit-install-commands-"));
      tmpDirs.push(target);
      await writeFile(path.join(target, "CLAUDE.md"), "# Test");

      const stackDir = path.resolve("test/__fixtures__/stacks/valid-stack");
      await installStack(stackDir, target, {});

      const reviewContent = await readFile(
        path.join(target, ".claude", "commands", "review.md"),
        "utf-8",
      );
      expect(reviewContent).toContain("Review the following code");

      const devStartContent = await readFile(
        path.join(target, ".claude", "commands", "dev", "start.md"),
        "utf-8",
      );
      expect(devStartContent).toContain("Start the development server");
    });
  });

  it("commands are not recorded in manifest for adapters without commands capability", async () => {
    // Standards and Codex have capabilities.commands = false — commands should not be hashed
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-cmd-nocap-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const { readManifest } = await import("../../src/core/manifest.js");
    const manifest = await readManifest(target);
    const entry = manifest.installs[0]!;

    // standards adapter does not support commands — its record must NOT contain commands
    const standardsRecord = entry.adapters["standards"];
    if (standardsRecord) {
      expect(standardsRecord.commands).toBeUndefined();
    }

    // claude-code adapter DOES support commands — its record MUST contain commands
    const claudeRecord = entry.adapters["claude-code"];
    expect(claudeRecord).toBeDefined();
    expect(claudeRecord!.commands).toBeDefined();
  });

  it("inline-agent manifest hashes buildInlineContent (instructions + agents)", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-inline-"));
    tmpDirs.push(target);
    // Standards adapter is always injected — just need AGENTS.md or CLAUDE.md
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(VALID_STACK, target, {});

    const { readManifest, computeHash } = await import("../../src/core/manifest.js");
    const { extractMarkerContent } = await import("../../src/shared/markers.js");
    const manifest = await readManifest(target);
    const standardsRecord = manifest.installs[0]!.adapters["standards"];
    expect(standardsRecord).toBeDefined();
    expect(standardsRecord!.instructions).toBeDefined();

    // The on-disk AGENTS.md marker content should match the manifest hash
    const agentsMd = await readFile(path.join(target, "AGENTS.md"), "utf-8");
    const markerContent = extractMarkerContent(agentsMd, "test-stack");
    expect(markerContent).not.toBeNull();
    expect(computeHash(markerContent!)).toBe(standardsRecord!.instructions!.hash);
  });

  it("runs postinstall script after files are written", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/postinstall-ran"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest instructions");

    await installStack(stackDir, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "postinstall-ran"))).resolves.toBeUndefined();
  });

  it("runs preinstall script before files are written", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { preinstall: `mkdir -p "${target}/pre-marker"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest instructions");

    await installStack(stackDir, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "pre-marker"))).resolves.toBeUndefined();
  });

  it("skips scripts with --ignore-scripts", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/should-not-exist"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    await installStack(stackDir, target, { ignoreScripts: true });

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "should-not-exist"))).rejects.toThrow();
  });

  it("aborts install on preinstall failure by default", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "# Existing\n");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { preinstall: "exit 1" },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    await expect(installStack(stackDir, target, {})).rejects.toThrow(
      /preinstall script.*exited with code/,
    );

    // Verify no files were written (install was aborted)
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toBe("# Existing\n");
  });

  it("continues on script failure with --ignore-script-errors", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: "exit 1" },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    // Should not throw
    await installStack(stackDir, target, { ignoreScriptErrors: true });

    // Install still completed (CLAUDE.md was written)
    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("promptpit:start:script-test");
  });

  it("runs fixture stack scripts and creates marker file", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    await installStack(SCRIPT_STACK, target, {});

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, ".postinstall-marker"))).resolves.toBeUndefined();
  });

  it("dry-run shows lifecycle scripts without executing", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "pit-install-"));
    tmpDirs.push(target);
    await writeFile(path.join(target, "CLAUDE.md"), "");

    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-"));
    tmpDirs.push(stackDir);
    await writeFile(
      path.join(stackDir, "stack.json"),
      JSON.stringify({
        name: "script-test",
        version: "1.0.0",
        scripts: { postinstall: `touch "${target}/should-not-run"` },
      }),
    );
    await writeFile(path.join(stackDir, "agent.promptpit.md"), "---\n---\nTest");

    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await installStack(stackDir, target, { dryRun: true });
    } finally {
      console.log = origLog;
    }

    // Script should be shown in output
    const output = logs.join("\n");
    expect(output).toContain("postinstall");

    // Script should NOT have been executed
    const { access } = await import("node:fs/promises");
    await expect(access(path.join(target, "should-not-run"))).rejects.toThrow();
  });
});
