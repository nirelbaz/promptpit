import { describe, it, expect, vi } from "vitest";
import { openFolderAction, platformCommand } from "../../../src/tui/actions/open-folder.js";
import type { ActionContext } from "../../../src/tui/stack-menu.js";
import type { ScannedStack } from "../../../src/shared/schema.js";

function ctx(root: string): ActionContext {
  return {
    stack: { root } as ScannedStack,
    cwd: root,
    config: {} as never,
    prompter: {} as never,
  };
}

describe("openFolder", () => {
  it("picks the right command per platform", () => {
    expect(platformCommand("darwin")).toBe("open");
    expect(platformCommand("linux")).toBe("xdg-open");
    expect(platformCommand("win32")).toBe("explorer");
  });

  it("spawns the command with the stack root (args as array — no shell)", async () => {
    const unref = vi.fn();
    const spawn = vi.fn().mockReturnValue({ unref });
    await openFolderAction(ctx("/x"), spawn as never);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["/x"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(unref).toHaveBeenCalled();
  });

  it("tolerates a child without unref (e.g. a mock that forgot it)", async () => {
    const spawn = vi.fn().mockReturnValue({});
    await expect(openFolderAction(ctx("/y"), spawn as never)).resolves.toBeUndefined();
  });
});
