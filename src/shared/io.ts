import chalk from "chalk";
import ora, { type Ora } from "ora";
import { createTwoFilesPatch } from "diff";
import type { DryRunEntry } from "../adapters/types.js";

// Dedup set for warnOnce. Lives for the lifetime of the process — resets
// naturally on each CLI invocation. Intentionally not exposed; callers drive
// it via `log.warnOnce(key, msg)`.
const emittedWarnKeys = new Set<string>();

export const log = {
  info: (msg: string) => console.log(chalk.blue("ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("✔"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✖"), msg),
  /**
   * Emit a warning only once per key within this process. Use for warnings
   * that fire inside hot loops (scan/read/collect) where the same message
   * would otherwise repeat on every invocation.
   *
   * Keep counts-matter warnings (e.g. validate summaries) on `log.warn`.
   */
  warnOnce: (key: string, msg: string) => {
    if (emittedWarnKeys.has(key)) return;
    emittedWarnKeys.add(key);
    console.log(chalk.yellow("⚠"), msg);
  },
  /** Test helper — clears the dedup set. Do not use in production code. */
  _resetWarnOnce: () => {
    emittedWarnKeys.clear();
  },
};

export function spinner(text: string): Ora {
  return ora({ text, color: "cyan" }).start();
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
