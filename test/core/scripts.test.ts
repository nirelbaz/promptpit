import { describe, it, expect, afterEach } from "vitest";
import { runLifecycleScript, collectScripts } from "../../src/core/scripts.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const result = await runLifecycleScript("postinstall", "echo hello", dir, {
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
    const result = await runLifecycleScript("postinstall", "exit 1", dir, {
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
    const result = await runLifecycleScript("postinstall", "cat marker.txt", dir, {
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
      "postinstall",
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
