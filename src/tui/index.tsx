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

  // Intercept every stderr write while Ink owns the terminal. Any stray byte
  // between Ink renders scrambles its cursor-position math and leaves ghost
  // frames on screen (the "3 stacked Status & diff headers" bug). We buffer
  // everything and replay after Ink unmounts — belt-and-suspenders beyond
  // the per-screen withMutedWarnings calls.
  //
  // Bounded buffer + uncaughtException flush so a crashing process still
  // surfaces its own stack trace instead of being swallowed by the intercept.
  const MAX_STDERR_BUFFER_BYTES = 1 << 20; // 1 MB
  const stderrBuffer: string[] = [];
  let stderrBufferBytes = 0;
  let stderrBufferDropped = 0;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const s = typeof chunk === "string" ? chunk : String(chunk);
    if (stderrBufferBytes + s.length <= MAX_STDERR_BUFFER_BYTES) {
      stderrBuffer.push(s);
      stderrBufferBytes += s.length;
    } else {
      stderrBufferDropped += s.length;
    }
    const cb = rest.find((a) => typeof a === "function") as ((err?: Error | null) => void) | undefined;
    cb?.();
    return true;
  }) as typeof process.stderr.write;

  const flushStderr = (): void => {
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
    if (stderrBuffer.length > 0) {
      originalStderrWrite(stderrBuffer.join(""));
      stderrBuffer.length = 0;
      stderrBufferBytes = 0;
    }
    if (stderrBufferDropped > 0) {
      originalStderrWrite(`[pit] dropped ${stderrBufferDropped} bytes of stderr to protect the alt-screen buffer\n`);
      stderrBufferDropped = 0;
    }
  };

  // Hard-crash handlers: restore the terminal and flush buffered stderr so
  // the user actually sees the error instead of a blank prompt.
  const onFatal = (err: unknown) => {
    restore();
    flushStderr();
    originalStderrWrite(err instanceof Error ? (err.stack ?? err.message) + "\n" : String(err) + "\n");
    process.exit(1);
  };
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);

  try {
    const app = render(<NavProvider initial={() => <MainList cwd={cwd} />} />, {
      exitOnCtrlC: true,
      patchConsole: true,
    });
    await app.waitUntilExit();
    return 0;
  } catch (err) {
    restore();
    flushStderr();
    const file = await writeErrorLog("runTui", err);
    log.error(`Something went wrong in the TUI. Log written to ${file}.`);
    return 1;
  } finally {
    flushStderr();
    process.off("uncaughtException", onFatal);
    process.off("unhandledRejection", onFatal);
  }
}
