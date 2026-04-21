import { spawn as nodeSpawn } from "node:child_process";
import type { ActionContext } from "../stack-menu.js";

export function platformCommand(p: NodeJS.Platform): string {
  if (p === "darwin") return "open";
  if (p === "win32") return "explorer";
  return "xdg-open";
}

/** Reveal the stack folder in Finder / File Explorer / xdg file manager.
 *  Uses spawn with an args array (no shell), so a stack root containing shell
 *  metacharacters can't be misinterpreted. The child is detached + stdio:ignore
 *  so the TUI keeps ownership of the terminal. */
export async function openFolderAction(
  ctx: ActionContext,
  spawn: typeof nodeSpawn = nodeSpawn,
): Promise<void> {
  const cmd = platformCommand(process.platform);
  const child = spawn(cmd, [ctx.stack.root], { detached: true, stdio: "ignore" });
  child.unref?.();
}
