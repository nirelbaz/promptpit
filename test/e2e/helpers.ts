import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";

/**
 * Sets up temp dir management for an E2E test suite.
 * Call inside a describe() block — registers afterEach cleanup automatically.
 */
export function useTmpDirs(prefix: string) {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeTmpDir(suffix = ""): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `${prefix}${suffix}`));
    tmpDirs.push(dir);
    return dir;
  }

  return { makeTmpDir };
}

/**
 * Captures JSON output from a command that prints to console.log.
 */
export async function captureJson(fn: () => Promise<void>): Promise<Record<string, unknown>> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await fn();
    const output = spy.mock.calls.map((c) => c.join(" ")).join("");
    return JSON.parse(output);
  } finally {
    spy.mockRestore();
  }
}
