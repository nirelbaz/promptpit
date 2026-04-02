import path from "node:path";
import chalk from "chalk";
import { readManifest } from "../core/manifest.js";
import { tryReadStackManifest, tryReadMcpConfig } from "../core/stack.js";
import type { InstallManifest, InstallEntry } from "../shared/schema.js";
import { readSkillsFromDir } from "../adapters/adapter-utils.js";
import { computeStatus } from "./status.js";
import type { ArtifactState, StatusResult } from "./status.js";
import { log } from "../shared/io.js";

export interface CheckOptions {
  json?: boolean;
}

interface FreshnessIssue {
  message: string;
}

interface DriftIssue {
  type: ArtifactState;
  artifact: string;
  name?: string;
  adapter: string;
  path: string;
}

export interface CheckResult {
  pass: boolean;
  freshness: {
    pass: boolean;
    skipped?: boolean;
    issues: FreshnessIssue[];
  };
  drift: {
    pass: boolean;
    issues: DriftIssue[];
  };
}

/** Collect all installed names for a given artifact key across all adapters */
function collectInstalledNames(
  entry: InstallEntry,
  key: "skills" | "mcp",
): Set<string> {
  const names = new Set<string>();
  for (const record of Object.values(entry.adapters)) {
    const artifacts = record[key];
    if (artifacts) {
      for (const name of Object.keys(artifacts)) {
        names.add(name);
      }
    }
  }
  return names;
}

async function checkFreshness(
  root: string,
  manifest: InstallManifest,
): Promise<CheckResult["freshness"]> {
  const stackDir = path.join(root, ".promptpit");
  const stackManifest = await tryReadStackManifest(stackDir);
  if (!stackManifest) {
    return { pass: true, skipped: true, issues: [] };
  }

  const issues: FreshnessIssue[] = [];

  // Find matching install entry
  const entry = manifest.installs.find((e) => e.stack === stackManifest.name);
  if (!entry) {
    issues.push({
      message: `Stack "${stackManifest.name}" has never been installed. Run \`pit install\`.`,
    });
    return { pass: false, issues };
  }

  // Check version match
  if (entry.stackVersion !== stackManifest.version) {
    issues.push({
      message: `Stack version mismatch: stack.json has ${stackManifest.version}, installed has ${entry.stackVersion}.`,
    });
  }

  // Check skills
  const skillsDir = path.join(stackDir, "skills");
  const stackSkills = await readSkillsFromDir(skillsDir);
  const installedSkillNames = collectInstalledNames(entry, "skills");

  for (const skill of stackSkills) {
    if (!installedSkillNames.has(skill.name)) {
      issues.push({
        message: `Skill "${skill.name}" is in the stack but not installed.`,
      });
    }
  }

  // Check MCP servers
  const mcpPath = path.join(stackDir, "mcp.json");
  const stackMcp = await tryReadMcpConfig(mcpPath);
  const installedMcpNames = collectInstalledNames(entry, "mcp");

  for (const serverName of Object.keys(stackMcp)) {
    if (!installedMcpNames.has(serverName)) {
      issues.push({
        message: `MCP server "${serverName}" is in the stack but not installed.`,
      });
    }
  }

  return { pass: issues.length === 0, issues };
}

function checkDrift(statusResult: StatusResult): CheckResult["drift"] {
  const issues: DriftIssue[] = [];

  for (const stack of statusResult.stacks) {
    for (const adapter of stack.adapters) {
      // Tag each detail with its artifact type
      const tagged: { detail: typeof adapter.skillDetails[0]; artifact: string }[] = [
        ...(adapter.instructionDetail
          ? [{ detail: adapter.instructionDetail, artifact: "instructions" }]
          : []),
        ...adapter.skillDetails.map((d) => ({ detail: d, artifact: "skill" })),
        ...adapter.mcpDetails.map((d) => ({ detail: d, artifact: "mcp" })),
      ];

      for (const { detail, artifact } of tagged) {
        if (detail.state !== "synced") {
          issues.push({
            type: detail.state,
            artifact,
            name: artifact !== "instructions" ? detail.name : undefined,
            adapter: adapter.adapterId,
            path: detail.path,
          });
        }
      }
    }
  }

  return { pass: issues.length === 0, issues };
}

function formatHuman(result: CheckResult, root: string): void {
  // Freshness
  if (result.freshness.skipped) {
    log.info("Freshness: skipped (no stack.json)");
  } else if (result.freshness.pass) {
    log.success("Freshness: stack matches installed manifest");
  } else {
    log.warn(
      `Freshness: ${result.freshness.issues.length} issue${result.freshness.issues.length === 1 ? "" : "s"} found`,
    );
    for (const issue of result.freshness.issues) {
      console.log(`  ${chalk.yellow("!")} ${issue.message}`);
    }
  }

  // Drift
  if (result.drift.pass) {
    log.success("Drift: all artifacts in sync");
  } else {
    log.warn(
      `Drift: ${result.drift.issues.length} issue${result.drift.issues.length === 1 ? "" : "s"} found`,
    );
    for (const issue of result.drift.issues) {
      const icon =
        issue.type === "deleted"
          ? chalk.red("D")
          : issue.type === "removed-by-user"
            ? chalk.red("R")
            : chalk.yellow("M");
      const relPath = path.relative(root, issue.path);
      const label =
        issue.name ? `${issue.artifact} "${issue.name}"` : issue.artifact;
      console.log(`  ${icon}  ${relPath} (${label} ${issue.type})`);
    }
  }

  // Summary
  console.log();
  if (result.pass) {
    log.success("All checks passed");
  } else {
    const total = result.freshness.issues.length + result.drift.issues.length;
    log.error(`Check failed — ${total} issue${total === 1 ? "" : "s"} found`);
    log.info(
      "To fix: Run 'pit install' to sync, or 'pit collect' to adopt current changes.",
    );
  }
}

export async function checkCommand(
  root: string,
  opts: CheckOptions,
): Promise<CheckResult> {
  const manifest = await readManifest(root);

  const [freshness, statusResult] = await Promise.all([
    checkFreshness(root, manifest),
    computeStatus(root),
  ]);
  const drift = checkDrift(statusResult);

  const result: CheckResult = {
    pass: freshness.pass && drift.pass,
    freshness,
    drift,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatHuman(result, root);
  }

  return result;
}
