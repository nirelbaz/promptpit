import path from "node:path";
import chalk from "chalk";
import { createTwoFilesPatch } from "diff";
import { reconcileAll, buildExpectedContent } from "../core/reconcile.js";
import type { ArtifactType, ArtifactState, ReconciledArtifact } from "../core/reconcile.js";
import { readStack } from "../core/stack.js";
import { resolveGraph, mergeGraph } from "../core/resolve.js";
import type { StackBundle } from "../shared/schema.js";
import { log } from "../shared/io.js";

// --- Public types ---

export interface DiffOptions {
  type?: string;      // filter by artifact type (singular: "skill", "rule", etc.)
  adapter?: string;   // filter by adapter ID
  name?: string;      // filter by artifact name
  json?: boolean;
}

export interface DiffArtifact {
  type: string;
  name: string;
  path: string;
  state: ArtifactState;
  diff?: string;
}

export interface DiffResult {
  stacks: Array<{
    stack: string;
    version: string;
    adapters: Array<{
      adapterId: string;
      artifacts: DiffArtifact[];
    }>;
  }>;
  hasDrift: boolean;
  hasManifest: boolean;
}

// --- Helpers ---

/** Load the stack bundle from .promptpit/, resolving extends if present. */
async function loadBundle(root: string): Promise<StackBundle | null> {
  const stackDir = path.join(root, ".promptpit");
  try {
    const bundle = await readStack(stackDir);
    if (bundle.manifest.extends?.length) {
      const graph = await resolveGraph(stackDir);
      const merged = mergeGraph(graph, { skipRootInstructions: true });
      return merged.bundle;
    }
    return bundle;
  } catch {
    return null;
  }
}

/** Generate a unified diff between expected and actual content. */
function generateDiff(expected: string, actual: string, filePath: string): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    expected,
    actual,
    "expected (from .promptpit/)",
    "actual (installed)",
  );
}

/** Colorize a unified diff patch line-by-line. */
function colorizeDiff(patch: string): string {
  const lines = patch.split("\n");
  return lines
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) {
        return chalk.dim(line);
      }
      if (line.startsWith("+")) {
        return chalk.green(line);
      }
      if (line.startsWith("-")) {
        return chalk.red(line);
      }
      if (line.startsWith("@@")) {
        return chalk.cyan(line);
      }
      return chalk.dim(line);
    })
    .join("\n");
}

/** Format an artifact label for display. */
function artifactLabel(type: string, name: string): string {
  if (type === "instructions") return "instructions";
  return `${type}: ${name}`;
}

// --- Core logic ---

export async function computeDiff(root: string, opts: DiffOptions): Promise<DiffResult> {
  const reconciled = await reconcileAll(root);

  if (!reconciled.hasManifest || reconciled.stacks.length === 0) {
    return { stacks: [], hasDrift: false, hasManifest: reconciled.hasManifest };
  }

  const bundle = await loadBundle(root);
  let hasDrift = false;

  const stacks = reconciled.stacks.map((rs) => {
    const adapters = rs.adapters
      .filter((ra) => !opts.adapter || ra.adapterId === opts.adapter)
      .map((ra) => {
        const artifacts: DiffArtifact[] = [];

        for (const artifact of ra.artifacts) {
          // Skip synced artifacts
          if (artifact.state === "synced") continue;

          // Apply filters
          if (opts.type && artifact.type !== opts.type) continue;
          if (opts.name && artifact.name !== opts.name) continue;

          hasDrift = true;

          const diffArtifact: DiffArtifact = {
            type: artifact.type,
            name: artifact.name,
            path: artifact.path,
            state: artifact.state,
          };

          // Generate diff for drifted artifacts when we have the source bundle
          if (artifact.state === "drifted" && bundle && artifact.actualContent != null) {
            const expected = buildExpectedContent(
              bundle,
              ra.adapterId,
              artifact.type as ArtifactType,
              artifact.name,
            );
            if (expected != null) {
              diffArtifact.diff = generateDiff(expected, artifact.actualContent, artifact.path);
            }
          }

          artifacts.push(diffArtifact);
        }

        return { adapterId: ra.adapterId, artifacts };
      })
      // Only include adapters that have drifted artifacts
      .filter((a) => a.artifacts.length > 0);

    return { stack: rs.stack, version: rs.version, adapters };
  });

  return { stacks, hasDrift, hasManifest: reconciled.hasManifest };
}

export async function diffCommand(root: string, opts: DiffOptions): Promise<boolean> {
  const result = await computeDiff(root, opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.hasDrift;
  }

  // No stacks at all
  const hasAnyArtifacts = result.stacks.some((s) => s.adapters.length > 0);
  if (!hasAnyArtifacts) {
    if (!result.hasManifest || result.stacks.length === 0) {
      log.info("No stacks installed. Run `pit install` to get started.");
    } else {
      log.info("All artifacts in sync.");
    }
    return false;
  }

  // Print diffs grouped by stack → adapter → artifact
  for (const stack of result.stacks) {
    for (const adapter of stack.adapters) {
      for (const artifact of adapter.artifacts) {
        const label = artifactLabel(artifact.type, artifact.name);
        const relPath = path.relative(root, artifact.path);

        if (artifact.state === "deleted") {
          console.log(
            chalk.red(`${adapter.adapterId} / ${label} — deleted (run pit install to restore)`),
          );
          console.log(chalk.dim(`  ${relPath}`));
          console.log();
        } else if (artifact.state === "removed-by-user") {
          console.log(
            chalk.red(`${adapter.adapterId} / ${label} — removed by user`),
          );
          console.log(chalk.dim(`  ${relPath}`));
          console.log();
        } else if (artifact.state === "drifted") {
          if (artifact.diff) {
            console.log(chalk.bold(`${adapter.adapterId} / ${label}`));
            console.log(chalk.dim(`  ${relPath}`));
            console.log(colorizeDiff(artifact.diff));
            console.log();
          } else {
            console.log(
              chalk.yellow(`${adapter.adapterId} / ${label} — drifted (source unavailable for diff)`),
            );
            console.log(chalk.dim(`  ${relPath}`));
            console.log();
          }
        }
      }
    }
  }

  return result.hasDrift;
}
