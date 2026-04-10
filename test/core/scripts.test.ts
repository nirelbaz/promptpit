import { describe, it, expect, afterEach } from "vitest";
import { runLifecycleScript, collectScripts, executeScripts } from "../../src/core/scripts.js";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stackManifestSchema } from "../../src/shared/schema.js";

describe("stackManifestSchema scripts field", () => {
  const base = { name: "test", version: "1.0.0" };

  it("accepts manifest without scripts", () => {
    const result = stackManifestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts manifest with preinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with postinstall script", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with both scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { preinstall: "echo prep", postinstall: "./setup.sh" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scripts?.preinstall).toBe("echo prep");
      expect(result.data.scripts?.postinstall).toBe("./setup.sh");
    }
  });

  it("rejects empty string scripts", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string script values", () => {
    const result = stackManifestSchema.safeParse({
      ...base,
      scripts: { postinstall: 42 },
    });
    expect(result.success).toBe(false);
  });
});

describe("runLifecycleScript", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("runs a script and returns success", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);
    const result = await runLifecycleScript("echo hello", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });
    expect(result.success).toBe(true);
  });

  it("returns failure on non-zero exit code", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);
    const result = await runLifecycleScript("exit 1", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });
    expect(result.success).toBe(false);
  });

  it("runs script from the given cwd", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "marker.txt"), "found");
    const result = await runLifecycleScript("cat marker.txt", dir, {
      PIT_TARGET_DIR: "/tmp/target",
      PIT_STACK_NAME: "test",
      PIT_STACK_VERSION: "1.0.0",
      PIT_SOURCE: ".promptpit",
    });
    expect(result.success).toBe(true);
  });

  it("injects PIT_ environment variables", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);
    const result = await runLifecycleScript(
      'test "$PIT_STACK_NAME" = "my-stack"',
      dir,
      {
        PIT_TARGET_DIR: "/tmp/target",
        PIT_STACK_NAME: "my-stack",
        PIT_STACK_VERSION: "2.0.0",
        PIT_SOURCE: "github:org/repo",
      },
    );
    expect(result.success).toBe(true);
  });
});

describe("collectScripts", () => {
  it("collects postinstall scripts in dependency order", () => {
    const entries = [
      {
        manifest: { name: "dep-b", version: "1.0.0", scripts: { postinstall: "./setup-b.sh" } },
        stackDir: "/tmp/b",
        source: "github:org/b",
      },
      {
        manifest: { name: "dep-a", version: "1.0.0", scripts: { postinstall: "./setup-a.sh" } },
        stackDir: "/tmp/a",
        source: "github:org/a",
      },
      {
        manifest: { name: "root", version: "1.0.0" },
        stackDir: "/tmp/root",
        source: ".promptpit",
      },
    ];
    const result = collectScripts(entries, "postinstall");
    expect(result).toHaveLength(2);
    expect(result[0].stackName).toBe("dep-b");
    expect(result[1].stackName).toBe("dep-a");
  });

  it("returns empty array when no scripts defined", () => {
    const entries = [
      { manifest: { name: "no-scripts", version: "1.0.0" }, stackDir: "/tmp/x", source: ".promptpit" },
    ];
    const result = collectScripts(entries, "preinstall");
    expect(result).toHaveLength(0);
  });

  it("collects preinstall scripts", () => {
    const entries = [
      {
        manifest: { name: "dep", version: "1.0.0", scripts: { preinstall: "echo prep" } },
        stackDir: "/tmp/dep",
        source: "github:org/dep",
      },
      {
        manifest: { name: "root", version: "1.0.0", scripts: { preinstall: "echo root-prep", postinstall: "./setup.sh" } },
        stackDir: "/tmp/root",
        source: ".promptpit",
      },
    ];
    const result = collectScripts(entries, "preinstall");
    expect(result).toHaveLength(2);
    expect(result[0].script).toBe("echo prep");
    expect(result[1].script).toBe("echo root-prep");
  });
});

describe("executeScripts", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("runs remote scripts when --trust is set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const entries = [
      {
        phase: "postinstall" as const,
        script: `touch "${dir}/trust-ran"`,
        stackDir: dir,
        stackName: "remote-stack",
        stackVersion: "1.0.0",
        source: "github:org/repo",
      },
    ];

    await executeScripts(entries, {
      targetDir: dir,
      isRemote: () => true,
      trust: true,
    });

    await expect(access(path.join(dir, "trust-ran"))).resolves.toBeUndefined();
  });

  it("throws on script failure by default", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const entries = [
      {
        phase: "postinstall" as const,
        script: "exit 1",
        stackDir: dir,
        stackName: "fail-stack",
        stackVersion: "1.0.0",
        source: ".promptpit",
      },
    ];

    await expect(
      executeScripts(entries, {
        targetDir: dir,
        isRemote: () => false,
      }),
    ).rejects.toThrow(/postinstall script.*exited with code/);
  });

  it("warns instead of throwing with ignoreScriptErrors", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const entries = [
      {
        phase: "postinstall" as const,
        script: "exit 1",
        stackDir: dir,
        stackName: "fail-stack",
        stackVersion: "1.0.0",
        source: ".promptpit",
      },
    ];

    // Should not throw
    await executeScripts(entries, {
      targetDir: dir,
      isRemote: () => false,
      ignoreScriptErrors: true,
    });
  });

  it("executes scripts in order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-scripts-"));
    tmpDirs.push(dir);

    const entries = [
      {
        phase: "postinstall" as const,
        script: `echo "first" >> "${dir}/order.txt"`,
        stackDir: dir,
        stackName: "dep-a",
        stackVersion: "1.0.0",
        source: ".promptpit",
      },
      {
        phase: "postinstall" as const,
        script: `echo "second" >> "${dir}/order.txt"`,
        stackDir: dir,
        stackName: "dep-b",
        stackVersion: "1.0.0",
        source: ".promptpit",
      },
    ];

    await executeScripts(entries, {
      targetDir: dir,
      isRemote: () => false,
    });

    const content = await readFile(path.join(dir, "order.txt"), "utf-8");
    expect(content.trim()).toBe("first\nsecond");
  });
});
