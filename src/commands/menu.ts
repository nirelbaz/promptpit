import { runTui } from "../tui/index.js";

export async function menuCommand(cwd: string): Promise<number> {
  return runTui(cwd);
}
