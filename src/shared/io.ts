import chalk from "chalk";
import ora, { type Ora } from "ora";
import { createTwoFilesPatch } from "diff";
import type { DryRunEntry } from "../adapters/types.js";

// Respect NO_COLOR (https://no-color.org/) and drop color when stdout isn't a
// TTY. Chalk usually auto-detects via supports-color, but subagent harnesses
// and piped invocations sometimes still emitted raw escape codes. Forcing
// level 0 upfront makes the decision deterministic regardless of pipeline.
const colorDisabled = !!process.env.NO_COLOR || !process.stdout.isTTY;
if (colorDisabled) {
  chalk.level = 0;
}

// Dedup set for warnOnce. Resets on each CLI invocation.
const emittedWarnKeys = new Set<string>();

// Active warning-mute scopes. Only the innermost (top-of-stack) scope counts
// a given warning — this avoids concurrent scopes (e.g. `Promise.all`) each
// inflating each other's totals. Nested scopes read as "inner handles it."
// Each scope also dedupes by warnOnce key, so a loop producing the same key
// 500 times is reported as "1 thing," not 500.
interface MuteHandle {
  count: number;
  countedKeys: Set<string>;
}
const activeMutes: MuteHandle[] = [];

// N18: status/notice output must never mix with the command's data output
// (JSON, diffs, tables). Anything routed through `log.*` is incidental —
// warnings, info banners, success glyphs — so send it all to stderr. Commands
// that want their output on stdout already use `console.log` directly.
function writeNotice(line: string): void {
  process.stderr.write(line + "\n");
}

function topMute(): MuteHandle | undefined {
  return activeMutes[activeMutes.length - 1];
}

export const log = {
  info: (msg: string) => writeNotice(`${chalk.blue("ℹ")} ${msg}`),
  success: (msg: string) => writeNotice(`${chalk.green("✔")} ${msg}`),
  warn: (msg: string) => {
    const top = topMute();
    if (top) {
      top.count++;
      return;
    }
    writeNotice(`${chalk.yellow("⚠")} ${msg}`);
  },
  error: (msg: string) => writeNotice(`${chalk.red("✖")} ${msg}`),
  /**
   * Emit a warning only once per key within this process. Use for warnings
   * that fire inside hot loops (scan/read/collect) where the same message
   * would otherwise repeat on every invocation.
   *
   * Keep counts-matter warnings (e.g. validate summaries) on `log.warn`.
   */
  warnOnce: (key: string, msg: string) => {
    // Already emitted somewhere unmuted — ignore.
    if (emittedWarnKeys.has(key)) return;
    const top = topMute();
    if (top) {
      // Count unique keys only; don't pollute the dedup set so a later
      // unmuted call with the same key can still emit its first occurrence.
      if (!top.countedKeys.has(key)) {
        top.countedKeys.add(key);
        top.count++;
      }
      return;
    }
    emittedWarnKeys.add(key);
    writeNotice(`${chalk.yellow("⚠")} ${msg}`);
  },
  /**
   * Suppress `warn` / `warnOnce` output for the duration of `fn`. Returns
   * how many distinct warnings the scope swallowed so the caller can
   * summarize. Concurrent scopes (e.g. `Promise.all`) don't cross-count —
   * each warning is attributed to the innermost active scope only.
   */
  withMutedWarnings: async <T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; suppressed: number }> => {
    const handle: MuteHandle = { count: 0, countedKeys: new Set() };
    activeMutes.push(handle);
    try {
      const result = await fn();
      return { result, suppressed: handle.count };
    } finally {
      const i = activeMutes.indexOf(handle);
      if (i >= 0) activeMutes.splice(i, 1);
    }
  },
  /** Test helper — clears the dedup set. Do not use in production code. */
  _resetWarnOnce: () => {
    emittedWarnKeys.clear();
    activeMutes.length = 0;
  },
};

/**
 * N17: `ora` routes success/fail glyphs through `log-symbols` → `yoctocolors`,
 * which bypasses `chalk.level = 0`. The result: raw ANSI escapes leak into
 * non-TTY output (piped subagent stdin, CI logs) even after forcing level 0.
 * When color is disabled we swap the real spinner for a stub that prints
 * plain notice lines, matching the surface the callers actually use
 * (`succeed`/`fail`/`warn`).
 *
 * Keeping the return type `Ora` so callers don't change. The stub only
 * implements the methods used in this repo; unused ones return the stub for
 * chainability. If a new method is added, add it here too.
 */
export function spinner(text: string): Ora {
  if (colorDisabled) {
    return createQuietSpinner(text);
  }
  return ora({ text, color: "cyan" }).start();
}

function createQuietSpinner(initialText: string): Ora {
  let current = initialText;
  // Print the label up front so users on non-TTY still see what's in flight.
  // Same channel as log.* — spinners are status, not command output.
  writeNotice(current);
  const stub = {
    text: current,
    succeed(msg?: string) {
      writeNotice(`${chalk.green("✔")} ${msg ?? current}`);
      return stub;
    },
    fail(msg?: string) {
      writeNotice(`${chalk.red("✖")} ${msg ?? current}`);
      return stub;
    },
    warn(msg?: string) {
      writeNotice(`${chalk.yellow("⚠")} ${msg ?? current}`);
      return stub;
    },
    info(msg?: string) {
      writeNotice(`${chalk.blue("ℹ")} ${msg ?? current}`);
      return stub;
    },
    start(msg?: string) {
      if (msg) current = msg;
      return stub;
    },
    stop() {
      return stub;
    },
    stopAndPersist() {
      return stub;
    },
    clear() {
      return stub;
    },
    render() {
      return stub;
    },
    frame() {
      return "";
    },
  } as unknown as Ora;
  // Keep `stub.text` aligned when callers mutate it.
  Object.defineProperty(stub, "text", {
    get() {
      return current;
    },
    set(v: string) {
      current = v;
    },
  });
  return stub;
}

export interface DryRunSection {
  label: string;
  entries: DryRunEntry[];
}

export function printDryRunReport(
  header: string,
  sections: DryRunSection[],
  verbose: boolean,
): void {
  console.log();
  console.log(chalk.cyan(header));

  for (const section of sections) {
    if (section.entries.length === 0) continue;
    console.log();
    console.log(chalk.bold(`  ${section.label}:`));

    for (const entry of section.entries) {
      const actionColor =
        entry.action === "create"
          ? chalk.green
          : entry.action === "modify"
            ? chalk.yellow
            : entry.action === "run"
              ? chalk.magenta
              : entry.action === "remove"
                ? chalk.red
                : chalk.dim;
      const detail = entry.detail ? chalk.dim(` (${entry.detail})`) : "";
      console.log(`    ${actionColor(entry.action.padEnd(7))} ${entry.file}${detail}`);

      if (
        verbose &&
        entry.action === "modify" &&
        entry.oldContent != null &&
        entry.newContent != null
      ) {
        const patch = createTwoFilesPatch(
          entry.file,
          entry.file,
          entry.oldContent,
          entry.newContent,
          "before",
          "after install",
        );
        // Skip the first two lines (Index: and ===) from the patch
        const lines = patch.split("\n").slice(2);
        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            console.log(`      ${chalk.green(line)}`);
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            console.log(`      ${chalk.red(line)}`);
          } else if (line.startsWith("@@")) {
            console.log(`      ${chalk.cyan(line)}`);
          } else {
            console.log(`      ${chalk.dim(line)}`);
          }
        }
      }
    }
  }
  console.log();
}
