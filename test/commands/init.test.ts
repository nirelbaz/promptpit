import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initCommand, type Prompter } from "../../src/commands/init.js";

/** Fake prompter that returns canned answers in order. */
function fakePrompter(answers: string[]): Prompter {
  let idx = 0;
  return {
    question: async () => {
      if (idx >= answers.length) {
        throw new Error(`Unexpected prompt at index ${idx} — add more answers to fakePrompter`);
      }
      return answers[idx++];
    },
    close: () => {},
  };
}

describe("pit init", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-init-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("scaffolds stack.json with prompted values", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter([
      "my-stack",   // name
      "1.0.0",      // version
      "A test stack", // description
      "Test Author",  // author
      "n",          // instructions
      "n",          // mcp
      "n",          // env
    ]);

    await initCommand(dir, {}, prompter);

    const raw = await readFile(path.join(dir, ".promptpit", "stack.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("my-stack");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBe("A test stack");
    expect(manifest.author).toBe("Test Author");
  });

  it("uses defaults when answers are empty", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter([
      "",  // name → dirname
      "",  // version → 0.1.0
      "",  // description → omitted
      "",  // author → omitted
      "",  // instructions → no
      "",  // mcp → no
      "",  // env → no
    ]);

    await initCommand(dir, {}, prompter);

    const raw = await readFile(path.join(dir, ".promptpit", "stack.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe(path.basename(dir));
    expect(manifest.version).toBe("0.1.0");
    expect(manifest).not.toHaveProperty("description");
    expect(manifest).not.toHaveProperty("author");
  });

  it("creates skills/.gitkeep always", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter(["test", "0.1.0", "", "", "n", "n", "n"]);

    await initCommand(dir, {}, prompter);

    const content = await readFile(
      path.join(dir, ".promptpit", "skills", ".gitkeep"),
      "utf-8",
    );
    expect(content).toBe("");
  });

  it("creates rules/.gitkeep always", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter(["test", "0.1.0", "", "", "n", "n", "n"]);

    await initCommand(dir, {}, prompter);

    const content = await readFile(
      path.join(dir, ".promptpit", "rules", ".gitkeep"),
      "utf-8",
    );
    expect(content).toBe("");
  });

  it("creates optional files when user says yes", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter([
      "full-stack",
      "0.1.0",
      "Full scaffold",
      "",
      "y",  // instructions
      "y",  // mcp
      "y",  // env
    ]);

    await initCommand(dir, {}, prompter);

    const outputDir = path.join(dir, ".promptpit");

    // agent.promptpit.md
    const instructions = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(instructions).toContain("name: full-stack");
    expect(instructions).toContain("# Agent Instructions");

    // mcp.json
    const mcp = await readFile(path.join(outputDir, "mcp.json"), "utf-8");
    expect(JSON.parse(mcp)).toEqual({});

    // .env.example
    const env = await readFile(path.join(outputDir, ".env.example"), "utf-8");
    expect(env).toContain("environment variables");
  });

  it("skips optional files when user says no", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter(["test", "0.1.0", "", "", "n", "n", "n"]);

    await initCommand(dir, {}, prompter);

    const outputDir = path.join(dir, ".promptpit");
    await expect(
      readFile(path.join(outputDir, "agent.promptpit.md"), "utf-8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(outputDir, "mcp.json"), "utf-8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(outputDir, ".env.example"), "utf-8"),
    ).rejects.toThrow();
  });

  it("refuses to overwrite existing stack.json without --force", async () => {
    const dir = await makeTmpDir();
    const outputDir = path.join(dir, ".promptpit");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "stack.json"), "{}");

    const prompter = fakePrompter(["test", "0.1.0", "", "", "n", "n", "n"]);
    await expect(initCommand(dir, {}, prompter)).rejects.toThrow(
      "already exists",
    );
  });

  it("overwrites with --force", async () => {
    const dir = await makeTmpDir();
    const outputDir = path.join(dir, ".promptpit");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "stack.json"), "{}");

    const prompter = fakePrompter([
      "overwritten",
      "2.0.0",
      "",
      "",
      "n",
      "n",
      "n",
    ]);
    await initCommand(dir, { force: true }, prompter);

    const raw = await readFile(path.join(outputDir, "stack.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("overwritten");
    expect(manifest.version).toBe("2.0.0");
  });

  it("rejects invalid stack name", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter([
      "invalid name!",  // invalid chars
      "0.1.0",
      "",
      "",
      "n",
      "n",
      "n",
    ]);

    await expect(initCommand(dir, {}, prompter)).rejects.toThrow(
      "Invalid stack config",
    );
  });

  it("rejects invalid version", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter([
      "test",
      "not-semver",
      "",
      "",
      "n",
      "n",
      "n",
    ]);

    await expect(initCommand(dir, {}, prompter)).rejects.toThrow(
      "Invalid stack config",
    );
  });

  it("respects custom --output directory", async () => {
    const dir = await makeTmpDir();
    const prompter = fakePrompter(["test", "0.1.0", "", "", "n", "n", "n"]);

    await initCommand(dir, { output: "custom-output" }, prompter);

    const raw = await readFile(
      path.join(dir, "custom-output", "stack.json"),
      "utf-8",
    );
    expect(JSON.parse(raw).name).toBe("test");
  });
});
