import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

// Unhandled TUI errors land here so the user gets a file path to attach to a
// bug report instead of a raw stack trace scrolling past. Logs rotate at 10
// files so we don't silently fill `~/.promptpit/logs/` over a long session.
const LOG_DIR = path.join(homedir(), ".promptpit", "logs");
const MAX_LOGS = 10;

export async function writeErrorLog(where: string, err: unknown): Promise<string> {
  await mkdir(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(LOG_DIR, `tui-${ts}.log`);
  const body = `at ${where}\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`;
  await writeFile(file, body);
  await rotateLogs();
  return file;
}

async function rotateLogs(): Promise<void> {
  let entries: string[];
  try {
    entries = (await readdir(LOG_DIR)).filter((f) => f.startsWith("tui-")).sort();
  } catch {
    return;
  }
  while (entries.length > MAX_LOGS) {
    const oldest = entries.shift()!;
    await rm(path.join(LOG_DIR, oldest), { force: true });
  }
}
