import { execFile } from "node:child_process";
import { log, spinner } from "../shared/io.js";

export interface ScriptEnv {
  PIT_TARGET_DIR: string;
  PIT_STACK_NAME: string;
  PIT_STACK_VERSION: string;
  PIT_SOURCE: string;
}

export interface ScriptResult {
  success: boolean;
  code: number | null;
}

export interface ScriptEntry {
  phase: "preinstall" | "postinstall";
  script: string;
  stackDir: string;
  stackName: string;
  stackVersion: string;
  source: string;
}

export function runLifecycleScript(
  _phase: "preinstall" | "postinstall",
  script: string,
  cwd: string,
  env: ScriptEnv,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "sh",
      ["-c", script],
      {
        cwd,
        env: { ...process.env, ...env },
        timeout: 300_000,
      },
      (error, _stdout, _stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : 1;
          resolve({ success: false, code });
        } else {
          resolve({ success: true, code: 0 });
        }
      },
    );
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export function collectScripts(
  entries: Array<{
    manifest: { name: string; version: string; scripts?: { preinstall?: string; postinstall?: string } };
    stackDir: string;
    source: string;
  }>,
  phase: "preinstall" | "postinstall",
): ScriptEntry[] {
  const result: ScriptEntry[] = [];
  for (const entry of entries) {
    const script = entry.manifest.scripts?.[phase];
    if (script) {
      result.push({
        phase,
        script,
        stackDir: entry.stackDir,
        stackName: entry.manifest.name,
        stackVersion: entry.manifest.version,
        source: entry.source,
      });
    }
  }
  return result;
}

export async function promptForScriptConsent(entry: ScriptEntry): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error();
  log.warn(`This stack wants to run a ${entry.phase} script:`);
  console.error();
  console.error(`  ${entry.script}`);
  console.error();
  console.error(`  Source: ${entry.source}`);
  console.error(`  Stack:  ${entry.stackName}`);
  console.error();

  return new Promise((resolve) => {
    rl.question("Allow? [y/N] ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function executeScripts(
  entries: ScriptEntry[],
  opts: {
    targetDir: string;
    isRemote: (source: string) => boolean;
    trust?: boolean;
    ignoreScriptErrors?: boolean;
  },
): Promise<void> {
  for (const entry of entries) {
    if (opts.isRemote(entry.source) && !opts.trust) {
      const allowed = await promptForScriptConsent(entry);
      if (!allowed) {
        log.info(`Skipped ${entry.phase} script from ${entry.stackName}`);
        continue;
      }
    }

    const spin = spinner(`Running ${entry.phase} (${entry.stackName})...`);

    const env: ScriptEnv = {
      PIT_TARGET_DIR: opts.targetDir,
      PIT_STACK_NAME: entry.stackName,
      PIT_STACK_VERSION: entry.stackVersion,
      PIT_SOURCE: entry.source,
    };

    const result = await runLifecycleScript(entry.phase, entry.script, entry.stackDir, env);

    if (result.success) {
      spin.succeed(`${entry.phase} (${entry.stackName}) completed`);
    } else if (opts.ignoreScriptErrors) {
      spin.warn(`${entry.phase} (${entry.stackName}) failed (exit ${result.code}) — continuing`);
    } else {
      spin.fail(`${entry.phase} (${entry.stackName}) failed (exit ${result.code})`);
      throw new Error(
        `${entry.phase} script from "${entry.stackName}" exited with code ${result.code}`,
      );
    }
  }
}
