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
  const restore = () => process.stdout.write.call(process.stdout, "\x1b[?1049l");
  process.on("exit", restore);
  process.on("SIGINT", () => { restore(); process.exit(130); });

  // Intercept every stderr write and every direct stdout write that isn't
  // Ink's own frame output. Any stray byte between Ink renders scrambles
  // Ink's cursor-position math and leaves ghost frames on screen (the "3
  // stacked Status & diff headers" bug). Ink writes via its own Output
  // abstraction that goes through stdout.write — we can't distinguish those
  // from user writes at the method level, so we buffer everything that
  // isn't Ink and flush on exit. In practice the buffer is tiny because
  // we've already routed most log.* calls through withMutedWarnings; this
  // is belt-and-suspenders for anything we missed.
  const stderrBuffer: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    stderrBuffer.push(typeof chunk === "string" ? chunk : String(chunk));
    const cb = rest.find((a) => typeof a === "function") as ((err?: Error | null) => void) | undefined;
    cb?.();
    return true;
  }) as typeof process.stderr.write;

  try {
    const app = render(<NavProvider initial={() => <MainList cwd={cwd} />} />, {
      exitOnCtrlC: true,
      patchConsole: true,
    });
    await app.waitUntilExit();
    return 0;
  } catch (err) {
    restore();
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
    const file = await writeErrorLog("runTui", err);
    log.error(`Something went wrong in the TUI. Log written to ${file}.`);
    return 1;
  } finally {
    // Replay anything buffered to stderr after Ink exits, so warnings and
    // errors that fired during the session aren't silently lost.
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
    if (stderrBuffer.length > 0) {
      originalStderrWrite(stderrBuffer.join(""));
    }
  }
}
