import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { readManifest } from "../core/manifest.js";
import { reconcileAll } from "../core/reconcile.js";
import type { ReconciledArtifact, ReconciledAdapter } from "../core/reconcile.js";
// Re-export for downstream compatibility (check.ts imports ArtifactState from here)
export type { ArtifactState } from "../core/reconcile.js";
import type { ArtifactState } from "../core/reconcile.js";
import type { InstallManifest } from "../shared/schema.js";
import { log } from "../shared/io.js";
import { parseGitHubSource } from "../sources/github.js";

export interface StatusOptions {
  json?: boolean;
  short?: boolean;
  verbose?: boolean;
  skipUpstream?: boolean;
}

export interface ArtifactDetail {
  name: string;
  path: string;
  state: ArtifactState;
}

export interface AdapterStatus {
  adapterId: string;
  skillCount: number;
  ruleCount: number;
  mcpCount: number;
  agentCount: number;
  commandCount: number;
  hasInstructions: boolean;
  state: ArtifactState;
  driftedFiles: string[];
  // Verbose details
  instructionDetail?: ArtifactDetail;
  skillDetails: ArtifactDetail[];
  ruleDetails: ArtifactDetail[];
  mcpDetails: ArtifactDetail[];
  agentDetails: ArtifactDetail[];
  commandDetails: ArtifactDetail[];
}

export interface StackStatus {
  stack: string;
  version: string;
  source?: string;
  installMode?: "force-standards" | "prefer-universal";
  adapters: AdapterStatus[];
  overallState: ArtifactState;
}

export interface StatusResult {
  stacks: StackStatus[];
  hasManifest: boolean;
}

// Map a ReconciledArtifact to the ArtifactDetail shape used by status display
function toArtifactDetail(artifact: ReconciledArtifact): ArtifactDetail {
  return { name: artifact.name, path: artifact.path, state: artifact.state };
}

// Map a ReconciledAdapter to the AdapterStatus shape used by status display
function toAdapterStatus(reconciled: ReconciledAdapter): AdapterStatus {
  const driftedFiles: string[] = [];
  const byType = {
    instructions: [] as ReconciledArtifact[],
    skill: [] as ReconciledArtifact[],
    agent: [] as ReconciledArtifact[],
    rule: [] as ReconciledArtifact[],
    command: [] as ReconciledArtifact[],
    mcp: [] as ReconciledArtifact[],
  };

  for (const artifact of reconciled.artifacts) {
    byType[artifact.type].push(artifact);
    if (artifact.state !== "synced") {
      driftedFiles.push(artifact.path);
    }
  }

  return {
    adapterId: reconciled.adapterId,
    skillCount: byType.skill.length,
    ruleCount: byType.rule.length,
    mcpCount: byType.mcp.length,
    agentCount: byType.agent.length,
    commandCount: byType.command.length,
    hasInstructions: reconciled.hasInstructions,
    state: reconciled.state,
    driftedFiles,
    instructionDetail: byType.instructions[0] ? toArtifactDetail(byType.instructions[0]) : undefined,
    skillDetails: byType.skill.map(toArtifactDetail),
    ruleDetails: byType.rule.map(toArtifactDetail),
    mcpDetails: byType.mcp.map(toArtifactDetail),
    agentDetails: byType.agent.map(toArtifactDetail),
    commandDetails: byType.command.map(toArtifactDetail),
  };
}

export async function computeStatus(root: string): Promise<StatusResult> {
  const reconciled = await reconcileAll(root);

  return {
    hasManifest: reconciled.hasManifest,
    stacks: reconciled.stacks.map((rs) => ({
      stack: rs.stack,
      version: rs.version,
      source: rs.source,
      installMode: rs.installMode,
      adapters: rs.adapters.map(toAdapterStatus),
      overallState: rs.overallState,
    })),
  };
}

function stateIcon(state: ArtifactState): string {
  switch (state) {
    case "synced": return chalk.green("✓");
    case "drifted": return chalk.yellow("M");
    case "deleted": return chalk.red("D");
    case "removed-by-user": return chalk.red("R");
    case "untracked": return chalk.blue("?");
  }
}

function stateColor(state: ArtifactState): (s: string) => string {
  switch (state) {
    case "synced": return chalk.green;
    case "drifted": return chalk.yellow;
    case "deleted": return chalk.red;
    case "removed-by-user": return chalk.red;
    case "untracked": return chalk.blue;
  }
}

function formatAdapterSummary(a: AdapterStatus): string {
  const parts: string[] = [];
  if (a.hasInstructions) parts.push("instructions");
  if (a.skillCount > 0) parts.push(`${a.skillCount} skill${a.skillCount === 1 ? "" : "s"}`);
  if (a.agentCount > 0) parts.push(`${a.agentCount} agent${a.agentCount === 1 ? "" : "s"}`);
  if (a.ruleCount > 0) parts.push(`${a.ruleCount} rule${a.ruleCount === 1 ? "" : "s"}`);
  if (a.commandCount > 0) parts.push(`${a.commandCount} command${a.commandCount === 1 ? "" : "s"}`);
  if (a.mcpCount > 0) parts.push(`${a.mcpCount} MCP`);
  return parts.join(", ");
}

function printDetailLine(d: ArtifactDetail, typeLabel: string, root: string): void {
  const relPath = path.relative(root, d.path);
  const label = chalk.dim(typeLabel.padEnd(14));
  const name = typeLabel === "instructions" ? "" : `${d.name}  `;
  console.log(`      ${stateIcon(d.state)} ${label}${name}${chalk.dim(relPath)}`);
}

function formatDetailed(result: StatusResult, root: string, verbose: boolean): void {
  if (!result.hasManifest || result.stacks.length === 0) {
    log.info("No stacks installed. Run `pit install` to get started.");
    return;
  }

  console.log();
  console.log(chalk.bold("Installed stacks:"));

  for (const stack of result.stacks) {
    const sourceStr = stack.source ? ` (from ${stack.source})` : "";
    console.log(`  ${chalk.bold(stack.stack)} v${stack.version}${chalk.dim(sourceStr)}`);

    for (const adapter of stack.adapters) {
      const icon = stateIcon(adapter.state);
      const summary = formatAdapterSummary(adapter);
      const colorFn = stateColor(adapter.state);
      console.log(`    ${icon} ${adapter.adapterId.padEnd(15)} ${colorFn(summary)}`);

      if (verbose) {
        if (adapter.instructionDetail) {
          printDetailLine(adapter.instructionDetail, "instructions", root);
        }
        for (const d of adapter.skillDetails) {
          printDetailLine(d, "skill", root);
        }
        for (const d of adapter.agentDetails) {
          printDetailLine(d, "agent", root);
        }
        for (const d of adapter.commandDetails) {
          printDetailLine(d, "command", root);
        }
        for (const d of adapter.ruleDetails) {
          printDetailLine(d, "rule", root);
        }
        for (const d of adapter.mcpDetails) {
          printDetailLine(d, "mcp", root);
        }
      }
    }

    // Show explanatory messages when Standards skipped files due to dedup
    // Only when install used default dedup (no explicit installMode override)
    if (!stack.installMode) {
      const stdRecord = stack.adapters.find((a) => a.adapterId === "standards");
      const otherAdapters = stack.adapters.filter((a) => a.adapterId !== "standards");

      // Explain skipped instructions: Standards has none but another adapter wrote them
      if (
        stdRecord &&
        !stdRecord.hasInstructions &&
        otherAdapters.some((a) => a.hasInstructions)
      ) {
        console.log(
          chalk.dim(
            "    ℹ standards         AGENTS.md not written — detected tools read it natively",
          ),
        );
      }

      // Explain skipped MCP: Standards has none but another adapter wrote MCP
      if (
        stdRecord &&
        stdRecord.mcpCount === 0 &&
        otherAdapters.some((a) => a.mcpCount > 0)
      ) {
        console.log(
          chalk.dim(
            "    ℹ standards         .mcp.json not written — detected tools read it natively",
          ),
        );
      }
    }
  }

  if (!verbose) {
    // Show drifted files with per-artifact state (deduplicated)
    const fileStates = new Map<string, ArtifactState>();
    for (const s of result.stacks) {
      for (const a of s.adapters) {
        const details = [
          ...(a.instructionDetail ? [a.instructionDetail] : []),
          ...a.skillDetails,
          ...a.agentDetails,
          ...a.commandDetails,
          ...a.ruleDetails,
          ...a.mcpDetails,
        ];
        for (const d of details) {
          if (d.state !== "synced" && !fileStates.has(d.path)) {
            fileStates.set(d.path, d.state);
          }
        }
      }
    }
    const allDrifted = [...fileStates.entries()].map(([file, state]) => ({ file, state }));

    if (allDrifted.length > 0) {
      console.log();
      console.log(chalk.bold("Changes:"));
      for (const { file, state } of allDrifted) {
        console.log(`  ${stateIcon(state)} ${file}`);
      }
    }

  }

  // Suggestions
  const hasDrift = result.stacks.some((s) => s.overallState !== "synced");
  if (hasDrift) {
    console.log();
    log.warn("Suggestions:");
    log.info("  Run 'pit install' to restore drifted files.");
    log.info("  Run 'pit collect' to capture current state.");
  }

  console.log();
}

function formatShort(result: StatusResult): void {
  if (!result.hasManifest || result.stacks.length === 0) {
    console.log("No stacks installed");
    return;
  }

  for (const stack of result.stacks) {
    const icon = stateIcon(stack.overallState);
    const adapterCount = stack.adapters.length;
    console.log(`${icon} ${stack.stack}@${stack.version} (${adapterCount} adapters)`);
  }
}

function formatJson(result: StatusResult): void {
  console.log(JSON.stringify(result, null, 2));
}

export async function statusCommand(
  root: string,
  opts: StatusOptions = {},
): Promise<void> {
  const result = await computeStatus(root);

  // Check upstream extends drift
  if (!opts.skipUpstream && result.hasManifest) {
    let manifest: InstallManifest;
    try {
      manifest = await readManifest(root);
    } catch {
      manifest = { installs: [] } as unknown as InstallManifest;
    }
    for (const install of manifest.installs) {
      if (!install.resolvedExtends?.length) continue;
      for (const ext of install.resolvedExtends) {
        const gh = parseGitHubSource(ext.source);
        if (!gh || !ext.resolvedCommit) continue;
        try {
          const ref = gh.ref ?? "HEAD";
          const output = execFileSync("git", [
            "ls-remote",
            `https://github.com/${gh.owner}/${gh.repo}.git`,
            ref,
          ], { stdio: ["pipe", "pipe", "pipe"], timeout: 10000 }).toString();
          const latestSha = output.split("\t")[0]?.trim();

          if (latestSha && latestSha !== ext.resolvedCommit) {
            log.warn(
              `${ext.source}: upstream has changed since install ` +
              `(commit ${ext.resolvedCommit.slice(0, 7)} → ${latestSha.slice(0, 7)})`,
            );
          }
        } catch {
          // Network error — skip silently
        }
      }
    }
  }

  if (opts.json) {
    formatJson(result);
  } else if (opts.short) {
    formatShort(result);
  } else {
    formatDetailed(result, root, !!opts.verbose);
  }
}
