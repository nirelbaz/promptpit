import { readFile, writeFile, mkdir, access, rm, lstat, unlink, symlink, copyFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import process from "node:process";

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
