import { execFileSync } from "node:child_process";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { exists, removeDir } from "../shared/utils.js";
import { collectStack } from "../commands/collect.js";
import { log, spinner } from "../shared/io.js";

export interface GitHubSource {
  owner: string;
  repo: string;
  ref?: string;
}

const SAFE_NAME = /^[a-zA-Z0-9_.\-]+$/;

export function parseGitHubSource(source: string): GitHubSource | null {
  const match = source.match(/^github:([^/]+)\/([^@]+)(?:@(.+))?$/);
  if (!match) return null;
  const owner = match[1]!;
  const repo = match[2]!;
  const ref = match[3];
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(repo)) return null;
  if (ref && !SAFE_NAME.test(ref)) return null;
  return { owner, repo, ref };
}

export async function cloneAndResolve(
  gh: GitHubSource,
): Promise<{ stackDir: string; tmpDir: string }> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-github-"));
  const url = `https://github.com/${gh.owner}/${gh.repo}.git`;

  const spin = spinner(`Cloning ${gh.owner}/${gh.repo}...`);

  try {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error(
        "git is not installed or not in PATH. Install git to use github: sources.",
      );
    }

    const args = ["clone", "--depth", "1"];
    if (gh.ref) args.push("--branch", gh.ref);
    args.push(url, path.join(tmpDir, "repo"));
    execFileSync("git", args, { stdio: "pipe", timeout: 60000 });
    spin.succeed(`Cloned ${gh.owner}/${gh.repo}`);
  } catch (err: unknown) {
    spin.fail(`Failed to clone ${gh.owner}/${gh.repo}`);
    await removeDir(tmpDir);
    if (err instanceof Error && err.message.includes("not installed")) {
      throw err;
    }
    throw new Error(
      `Could not clone ${url}. Check that the repository exists and is accessible.`,
    );
  }

  const repoDir = path.join(tmpDir, "repo");
  const promptpitDir = path.join(repoDir, ".promptpit");

  if (await exists(promptpitDir)) {
    return { stackDir: promptpitDir, tmpDir };
  }

  log.info("No .promptpit/ found — auto-collecting from repository...");
  const autoCollectDir = path.join(tmpDir, "auto-collected");

  try {
    await collectStack(repoDir, autoCollectDir, {});
  } catch (err: unknown) {
    await removeDir(tmpDir);
    if (
      err instanceof Error &&
      err.message.includes("No AI tool configuration")
    ) {
      throw new Error(
        `No AI tool configuration found in ${gh.owner}/${gh.repo}. ` +
          `This repository doesn't appear to have any AI agent configs to collect.`,
      );
    }
    throw err;
  }

  return { stackDir: autoCollectDir, tmpDir };
}

/**
 * Clone a GitHub repo into a specific directory (for shared temp dir during extends resolution).
 * Returns the stackDir within that directory. Caller manages temp dir cleanup.
 */
export async function cloneToDir(
  gh: GitHubSource,
  parentDir: string,
): Promise<{ stackDir: string }> {
  const repoDir = path.join(parentDir, `${gh.owner}-${gh.repo}${gh.ref ? `-${gh.ref}` : ""}`);
  const url = `https://github.com/${gh.owner}/${gh.repo}.git`;

  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("git is not installed or not in PATH. Install git to use github: sources.");
  }

  const args = ["clone", "--depth", "1"];
  if (gh.ref) args.push("--branch", gh.ref);
  args.push(url, repoDir);

  try {
    execFileSync("git", args, { stdio: "pipe", timeout: 60000 });
  } catch {
    throw new Error(
      `Could not clone ${url}. Check that the repository exists and is accessible.`,
    );
  }

  const promptpitDir = path.join(repoDir, ".promptpit");
  if (await exists(promptpitDir)) {
    return { stackDir: promptpitDir };
  }

  // Auto-collect fallback
  const autoDir = path.join(parentDir, `${gh.owner}-${gh.repo}-collected`);
  try {
    await collectStack(repoDir, autoDir, {});
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("No AI tool configuration")) {
      throw new Error(
        `No AI tool configuration found in ${gh.owner}/${gh.repo}. ` +
          `This repository doesn't appear to have any AI agent configs to collect.`,
      );
    }
    throw err;
  }

  return { stackDir: autoDir };
}

/** Get the HEAD commit SHA of a git repo directory. */
export function getRepoCommitSha(repoDir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).toString().trim();
  } catch {
    return undefined;
  }
}
