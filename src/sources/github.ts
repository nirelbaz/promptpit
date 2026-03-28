import { execSync } from "node:child_process";
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

export function parseGitHubSource(source: string): GitHubSource | null {
  const match = source.match(/^github:([^/]+)\/([^@]+)(?:@(.+))?$/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, ref: match[3] };
}

export async function cloneAndResolve(
  gh: GitHubSource,
): Promise<{ stackDir: string; tmpDir: string }> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pit-github-"));
  const url = `https://github.com/${gh.owner}/${gh.repo}.git`;

  const spin = spinner(`Cloning ${gh.owner}/${gh.repo}...`);

  try {
    try {
      execSync("git --version", { stdio: "ignore" });
    } catch {
      throw new Error(
        "git is not installed or not in PATH. Install git to use github: sources.",
      );
    }

    const refArgs = gh.ref ? `--branch ${gh.ref}` : "";
    execSync(
      `git clone --depth 1 ${refArgs} "${url}" "${tmpDir}/repo"`,
      { stdio: "pipe", timeout: 60000 },
    );
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
