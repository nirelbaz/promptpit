import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../../scripts/check-version.sh");

function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pit-version-check-"));
  execSync("git init && git config user.email test@test.com && git config user.name Test", {
    cwd: dir,
    stdio: "pipe",
  });
  return dir;
}

function writePackageJson(dir: string, version: string) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test", version }));
}

function writeChangelog(dir: string, content: string) {
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), content);
}

function commit(dir: string, msg: string) {
  execSync(`git add -A && git commit -m "${msg}" --allow-empty`, { cwd: dir, stdio: "pipe" });
}

function run(dir: string, baseRef = "HEAD~1"): { code: number; output: string } {
  try {
    const output = execSync(`bash "${SCRIPT}" ${baseRef}`, {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return { code: 0, output };
  } catch (err: any) {
    return { code: err.status ?? 1, output: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("check-version.sh", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes when version is unchanged", () => {
    writePackageJson(dir, "1.0.0");
    writeChangelog(dir, "# Changelog\n");
    commit(dir, "initial");
    // No changes to version
    writeChangelog(dir, "# Changelog\n\nSome edit\n");
    commit(dir, "edit changelog");

    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.output).toContain("Version unchanged");
  });

  it("passes when version bumped and CHANGELOG has matching entry", () => {
    writePackageJson(dir, "1.0.0");
    writeChangelog(dir, "# Changelog\n");
    commit(dir, "initial");

    writePackageJson(dir, "1.1.0");
    writeChangelog(dir, "# Changelog\n\n## 1.1.0\n\n- New feature\n");
    commit(dir, "bump version");

    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.output).toContain("matching CHANGELOG entry");
  });

  it("fails when version bumped but no CHANGELOG entry", () => {
    writePackageJson(dir, "1.0.0");
    writeChangelog(dir, "# Changelog\n");
    commit(dir, "initial");

    writePackageJson(dir, "1.1.0");
    commit(dir, "bump without changelog");

    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("no '## 1.1.0' entry");
  });

  it("skips when base ref does not exist", () => {
    writePackageJson(dir, "1.0.0");
    writeChangelog(dir, "# Changelog\n");
    commit(dir, "initial");

    const result = run(dir, "nonexistent-ref");
    expect(result.code).toBe(0);
    expect(result.output).toContain("not found");
  });

  it("skips when base has no package.json", () => {
    // First commit without package.json
    fs.writeFileSync(path.join(dir, "README.md"), "# test");
    commit(dir, "initial without package.json");

    writePackageJson(dir, "1.0.0");
    writeChangelog(dir, "# Changelog\n\n## 1.0.0\n\n- Init\n");
    commit(dir, "add package.json");

    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipping");
  });
});
