// TUI entry. Replaces the clack-era loop with an Ink render that owns
// the full screen for the duration of the session. Alt-screen buffer is
// entered on start and restored on exit so quitting feels like quitting
// vim/less — the user's prompt comes back exactly where they left it.
//
// TTY guard matches the clack behaviour: non-TTY stdin (CI, pipes) gets
// a one-line error pointing at `pit ls`, not a hang and a reconciler
// crash.
import { render } from "ink";
import { log } from "../shared/io.js";
import { NavProvider } from "./nav.js";
import { MainList } from "./screens/main-list.js";
import { writeErrorLog } from "./error-boundary.js";

export async function runTui(cwd: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error(
      "bare `pit` requires a TTY. Use `pit ls` for a static list, or run `pit <command>` for a specific action.",
    );
    return 1;
  }

  // Alt-screen buffer: restore terminal state on any exit path, including
  // uncaught errors. The manual \x1b escapes bypass the Ink reconciler,
  // which can leave the buffer entered if it throws during render.
  process.stdout.write("\x1b[?1049h");
  const restore = () => process.stdout.write("\x1b[?1049l");
  process.on("exit", restore);
  process.on("SIGINT", () => { restore(); process.exit(130); });

  try {
    const app = render(<NavProvider initial={() => <MainList cwd={cwd} />} />, {
      exitOnCtrlC: true,
    });
    await app.waitUntilExit();
    return 0;
  } catch (err) {
    restore();
    const file = await writeErrorLog("runTui", err);
    log.error(`Something went wrong in the TUI. Log written to ${file}.`);
    return 1;
  }
}
