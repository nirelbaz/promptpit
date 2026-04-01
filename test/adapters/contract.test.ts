import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAdapters } from "../../src/adapters/registry.js";
import { readStack } from "../../src/core/stack.js";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PlatformAdapter } from "../../src/adapters/types.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

const ADAPTER_FIXTURES: Record<string, (dir: string) => Promise<void>> = {
  "claude-code": async (dir) => {
    await writeFile(path.join(dir, "CLAUDE.md"), "# Test");
  },
  cursor: async (dir) => {
    await writeFile(path.join(dir, ".cursorrules"), "Test rules");
  },
  standards: async (dir) => {
    await writeFile(path.join(dir, "AGENTS.md"), "# Test agents");
  },
  copilot: async (dir) => {
    await mkdir(path.join(dir, ".github"), { recursive: true });
    await writeFile(
      path.join(dir, ".github", "copilot-instructions.md"),
      "# Copilot instructions",
    );
  },
};

describe.each(listAdapters().map((a) => [a.id, a] as const))(
  "Adapter contract: %s",
  (id, adapter: PlatformAdapter) => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(tmpdir(), `pit-contract-${id}-`));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    // 1. detect() returns true for configured project
    it("detect() returns true for configured project", async () => {
      const setup = ADAPTER_FIXTURES[id];
      if (setup) await setup(tmpDir);
      const result = await adapter.detect(tmpDir);
      expect(result.detected).toBe(true);
    });

    // 2. detect() returns false for empty project
    it("detect() returns false for unconfigured project", async () => {
      const result = await adapter.detect(tmpDir);
      expect(result.detected).toBe(false);
    });

    // 3. read() returns valid PlatformConfig
    it("read() returns valid PlatformConfig", async () => {
      const setup = ADAPTER_FIXTURES[id];
      if (setup) await setup(tmpDir);
      const config = await adapter.read(tmpDir);
      expect(config.adapterId).toBe(id);
      expect(typeof config.agentInstructions).toBe("string");
      expect(Array.isArray(config.skills)).toBe(true);
      expect(typeof config.mcpServers).toBe("object");
    });

    // 4. write() produces files with markers (marker-based adapters only)
    it("write() produces files with correct markers", async () => {

      const setup = ADAPTER_FIXTURES[id];
      if (setup) await setup(tmpDir);
      const bundle = await readStack(VALID_STACK);
      const result = await adapter.write(tmpDir, bundle, {});
      expect(result.filesWritten.length).toBeGreaterThan(0);

      const paths = adapter.paths.project(tmpDir);
      const configContent = await readFile(paths.config, "utf-8");
      expect(configContent).toContain("promptpit:start:test-stack");
      expect(configContent).toContain("promptpit:end:test-stack");
    });

    // 5. write() is idempotent
    it("write() is idempotent (run twice, same result)", async () => {

      const setup = ADAPTER_FIXTURES[id];
      if (setup) await setup(tmpDir);
      const bundle = await readStack(VALID_STACK);
      await adapter.write(tmpDir, bundle, {});
      await adapter.write(tmpDir, bundle, {});

      const paths = adapter.paths.project(tmpDir);
      const configContent = await readFile(paths.config, "utf-8");
      const startCount = (
        configContent.match(/promptpit:start:test-stack/g) || []
      ).length;
      expect(startCount).toBe(1);
    });

    // 6. paths.user() returns home directory paths
    it("paths.user() returns home directory paths", () => {
      const userP = adapter.paths.user();
      expect(typeof userP.config).toBe("string");
      expect(typeof userP.skills).toBe("string");
      expect(typeof userP.mcp).toBe("string");
    });

    // 7. write() preserves existing content outside markers (marker-based adapters only)
    it("write() preserves existing content outside markers", async () => {

      const setup = ADAPTER_FIXTURES[id];
      if (setup) await setup(tmpDir);

      const paths = adapter.paths.project(tmpDir);
      await writeFile(
        paths.config,
        "# My custom config\n\nDo not delete this.\n",
      );

      const bundle = await readStack(VALID_STACK);
      await adapter.write(tmpDir, bundle, {});

      const content = await readFile(paths.config, "utf-8");
      expect(content).toContain("# My custom config");
      expect(content).toContain("Do not delete this.");
      expect(content).toContain("promptpit:start:test-stack");
    });
  },
);
