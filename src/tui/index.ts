import { homedir } from "node:os";
import path from "node:path";
import { isCancel, cancel as clackCancel } from "@clack/prompts";
import { log } from "../shared/io.js";
import { scan } from "../core/scan.js";
import { loadConfig } from "../core/config.js";
import { PromptCancelledError } from "../shared/interactive.js";
import { mainMenu } from "./main-menu.js";
import { writeErrorLog } from "./error-boundary.js";

const GLOBAL_ROOTS = [
  path.join(homedir(), ".claude"),
  path.join(homedir(), ".cursor"),
  path.join(homedir(), ".codex"),
  path.join(homedir(), ".github"),
  path.join(homedir(), ".agents", "skills"),
];

export async function runTui(cwd: string): Promise<number> {
  // `pit` with no args is the TUI. Under a pipe or redirect (CI, subagent
  // stdin), clack will hang on a raw keypress — fail loud with a pointer
  // to the static alternative instead.
  if (!process.stdin.isTTY) {
    log.error(
      "bare `pit` requires a TTY. Use `pit ls` for a static list, or run `pit <command>` for a specific action.",
    );
    return 1;
  }

  process.on("SIGINT", () => {
    clackCancel("aborted");
    process.exit(130);
  });

  try {
    // Loop: rescan + main-menu. Actions return `true` to rescan and re-enter,
    // `false` to exit. Config is reloaded per-iteration so edits via
    // `pit config` picked up by the next pass without restarting.
    while (true) {
      const cfg = await loadConfig(homedir(), { silent: true });
      const { result: stacks } = await log.withMutedWarnings(() =>
        scan({
          cwd,
          globalRoots: cfg.ui.showGlobalRow ? GLOBAL_ROOTS : [],
          depth: cfg.scan.defaultDepth,
          ignoreGlobs: cfg.scan.ignore,
        }),
      );
      const shouldContinue = await mainMenu({ cwd, stacks, config: cfg });
      if (!shouldContinue) return 0;
    }
  } catch (err) {
    if (err instanceof PromptCancelledError) return 130;
    if (isCancel(err)) return 130;
    const file = await writeErrorLog("runTui", err);
    log.error(`Something went wrong in the TUI. Log written to ${file}.`);
    return 1;
  }
}
