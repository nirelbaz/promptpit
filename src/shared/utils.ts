import { readFile, writeFile, mkdir, access, rm, lstat, unlink, symlink, copyFile, rename } from "node:fs/promises";
import path, { dirname, relative } from "node:path";
import process from "node:process";
import { z } from "zod";
import { log } from "./io.js";

export async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function writeFileEnsureDir(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

export async function writeFileBufferEnsureDir(
  path: string,
  content: Buffer,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function removeFileOrSymlink(p: string): Promise<void> {
  try {
    const stat = await lstat(p);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await unlink(p);
    } else if (stat.isDirectory()) {
      await rm(p, { recursive: true, force: true });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function symlinkOrCopy(src: string, dest: string): Promise<void> {
  await removeFileOrSymlink(dest);
  await mkdir(dirname(dest), { recursive: true });

  if (process.platform !== "win32") {
    const rel = relative(dirname(dest), src);
    await symlink(rel, dest);
    return;
  }

  // Windows: try symlink, fall back to copy
  try {
    const rel = relative(dirname(dest), src);
    await symlink(rel, dest);
  } catch {
    await copyFile(src, dest);
  }
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export interface LoadJsonOpts {
  silent?: boolean;
  label?: string;
}

/**
 * Read a JSON file and validate it against a Zod schema. Falls back to the
 * schema's parse of `defaultValue` when the file is missing, unparseable,
 * or fails validation. Never overwrites a bad file on disk — recovery is
 * the user's call via CLI.
 */
export async function loadJsonFile<S extends z.ZodTypeAny>(
  filePath: string,
  schema: S,
  defaultValue: unknown,
  opts: LoadJsonOpts = {},
): Promise<z.output<S>> {
  const raw = await readFileOrNull(filePath);
  if (!raw) return schema.parse(defaultValue);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!opts.silent) {
      const label = opts.label ?? filePath;
      log.warn(`${label} is invalid JSON. Using defaults in memory. File will not be auto-overwritten.`);
    }
    return schema.parse(defaultValue);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    if (!opts.silent) {
      const label = opts.label ?? filePath;
      log.warn(`${label} failed schema validation. Using defaults.`);
    }
    return schema.parse(defaultValue);
  }
  return result.data;
}

/** Atomic write: tmp file, then rename into place. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = filePath + ".tmp";
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileEnsureDir(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, filePath);
}
