import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateAction } from "../../../src/tui/actions/validate.js";
import type { ActionContext } from "../../../src/tui/stack-menu.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

function ctx(stack: ScannedStack): ActionContext {
  return { stack, cwd: stack.root, config: {} as never, prompter: {} as never };
}

describe("validateAction", () => {
  it("returns early for unmanaged stacks (no .promptpit to validate)", async () => {
    const stack: ScannedStack = {
      root: "/does-not-matter",
      kind: "unmanaged",
      name: "x",
      manifestCorrupt: false,
      adapters: [],
      unmanagedAnnotations: [],
      unsupportedTools: [],
      overallDrift: "unknown",
    };
    await expect(validateAction(ctx(stack))).resolves.toBeUndefined();
  });

  it("runs validateStack on a real .promptpit/ and produces a note", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pit-validate-"));
    try {
      const stackDir = path.join(tmp, ".promptpit");
      await mkdir(stackDir, { recursive: true });
      await writeFile(
        path.join(stackDir, "stack.yml"),
        ["name: tmp", "version: 0.0.1"].join("\n"),
      );

      const stack: ScannedStack = {
        root: tmp,
        kind: "managed",
        name: "tmp",
        manifestCorrupt: false,
        promptpit: { stackVersion: "0.0.1", hasInstalledJson: false },
        adapters: [],
        unmanagedAnnotations: [],
        unsupportedTools: [],
        overallDrift: "synced",
      };
      await expect(validateAction(ctx(stack))).resolves.toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
