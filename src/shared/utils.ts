import { readFile, writeFile, mkdir, access, rm, lstat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

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

export async function removeSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      await unlink(path);
    }
  } catch {
    // Path doesn't exist, nothing to remove
  }
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
