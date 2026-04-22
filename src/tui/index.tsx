import { render } from "ink";
import { log } from "../shared/io.js";
import { NavProvider } from "./nav.js";
import { ScanProvider } from "./scan-context.js";
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
  //   \x1b[?1049h  enter alt-screen buffer
  //   \x1b[H       cursor to top-left — some terminals (iTerm, Terminal.app)
  //                don't reset cursor on alt-buffer switch, so Ink ends up
  //                rendering from wherever the CLI prompt left off instead
  //                of the top of the screen
  //   \x1b[2J      clear any residual alt-buffer content
  process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
  const restore = () => process.stdout.write.call(process.stdout, "\x1b[?1049l");
  process.on("exit", restore);

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

  // SIGINT handler registered after flushStderr is defined so Ctrl-C doesn't
  // drop adapter warnings buffered before the interrupt.
  const onSigint = () => { restore(); flushStderr(); process.exit(130); };
  process.on("SIGINT", onSigint);

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
    // ScanProvider wraps NavProvider so scan state survives push/pop —
    // StackDetail → StatusDiff → back → MainList doesn't trigger a fresh
    // scan, just re-renders against the cached result.
    const app = render(
      <ScanProvider cwd={cwd}>
        <NavProvider initial={() => <MainList />} />
      </ScanProvider>,
      { exitOnCtrlC: true, patchConsole: true },
    );
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
    process.off("SIGINT", onSigint);
  }
}
