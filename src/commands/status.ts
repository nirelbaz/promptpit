import path from "node:path";
import chalk from "chalk";
import { readManifest, computeHash } from "../core/manifest.js";
import { readFileOrNull } from "../shared/utils.js";
import { extractMarkerContent, hasMarkers } from "../shared/markers.js";
import type { InstallManifest, AdapterInstallRecord } from "../shared/schema.js";
import { getAdapter } from "../adapters/registry.js";
import { log } from "../shared/io.js";

export interface StatusOptions {
  json?: boolean;
  short?: boolean;
}

// Reconciliation states per the design doc
type ArtifactState = "synced" | "drifted" | "deleted" | "removed-by-user" | "untracked";

interface AdapterStatus {
  adapterId: string;
  skillCount: number;
  mcpCount: number;
  hasInstructions: boolean;
  state: ArtifactState;
  driftedFiles: string[];
}

interface StackStatus {
  stack: string;
  version: string;
  source?: string;
  adapters: AdapterStatus[];
  overallState: ArtifactState;
}

interface StatusResult {
  stacks: StackStatus[];
  hasManifest: boolean;
}

async function checkAdapterStatus(
  root: string,
  stackName: string,
  adapterId: string,
  record: AdapterInstallRecord,
): Promise<AdapterStatus> {
  const driftedFiles: string[] = [];
  let worstState: ArtifactState = "synced";

  // Check instructions
  if (record.instructions) {
    let filePath: string | undefined;
    try {
      const adapter = getAdapter(adapterId);
      filePath = adapter.paths.project(root).config;
    } catch {
      // Unknown adapter — skip instruction check
    }
    if (filePath) {
      const content = await readFileOrNull(filePath);
      if (content == null) {
        worstState = "deleted";
        driftedFiles.push(filePath);
      } else if (hasMarkers(content, stackName)) {
        const markerContent = extractMarkerContent(content, stackName);
        if (markerContent != null) {
          const currentHash = computeHash(markerContent);
          if (currentHash !== record.instructions.hash) {
            worstState = "drifted";
            driftedFiles.push(filePath);
          }
        }
      } else {
        // Markers removed by user
        worstState = "removed-by-user";
        driftedFiles.push(filePath);
      }
    }
  }

  // Check skills — use canonical .agents/skills/ path (all adapters read from here)
  const skillEntries = record.skills ?? {};
  for (const [skillName, skillRecord] of Object.entries(skillEntries)) {
    const skillPath = path.join(root, ".agents", "skills", skillName, "SKILL.md");
    const content = await readFileOrNull(skillPath);
    if (content == null) {
      if (worstState === "synced") worstState = "deleted";
      driftedFiles.push(skillPath);
    } else {
      const currentHash = computeHash(content);
      if (currentHash !== skillRecord.hash) {
        if (worstState === "synced") worstState = "drifted";
        driftedFiles.push(skillPath);
      }
    }
  }

  // Check MCP — read file once, check each server's hash
  const mcpEntries = record.mcp ?? {};
  if (Object.keys(mcpEntries).length > 0) {
    let mcpPath: string;
    try {
      const adapter = getAdapter(adapterId);
      mcpPath = adapter.paths.project(root).mcp;
    } catch {
      mcpPath = path.join(root, ".mcp.json");
    }
    const mcpRaw = await readFileOrNull(mcpPath);
    if (mcpRaw == null) {
      if (worstState === "synced") worstState = "deleted";
      driftedFiles.push(mcpPath);
    } else {
      let mcpParsed: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(mcpRaw);
        mcpParsed = (parsed.mcpServers ?? {}) as Record<string, unknown>;
      } catch {
        if (worstState === "synced") worstState = "drifted";
        driftedFiles.push(mcpPath);
      }
      for (const [serverName, mcpRecord] of Object.entries(mcpEntries)) {
        const serverConfig = mcpParsed[serverName];
        if (!serverConfig) {
          if (worstState === "synced") worstState = "deleted";
          driftedFiles.push(mcpPath);
        } else {
          const currentHash = computeHash(JSON.stringify(serverConfig));
          if (currentHash !== mcpRecord.hash) {
            if (worstState === "synced") worstState = "drifted";
            driftedFiles.push(mcpPath);
          }
        }
      }
    }
  }

  return {
    adapterId,
    skillCount: Object.keys(skillEntries).length,
    mcpCount: Object.keys(mcpEntries).length,
    hasInstructions: !!record.instructions,
    state: worstState,
    driftedFiles,
  };
}

async function computeStatus(root: string): Promise<StatusResult> {
  let manifest: InstallManifest;
  try {
    manifest = await readManifest(root);
  } catch {
    return { stacks: [], hasManifest: false };
  }

  if (manifest.installs.length === 0) {
    return { stacks: [], hasManifest: true };
  }

  const stacks: StackStatus[] = [];

  for (const entry of manifest.installs) {
    const adapters: AdapterStatus[] = [];

    for (const [adapterId, record] of Object.entries(entry.adapters)) {
      const status = await checkAdapterStatus(root, entry.stack, adapterId, record);
      adapters.push(status);
    }

    // Priority: deleted > removed-by-user > drifted > untracked > synced
    const nonSynced = adapters.find((a) => a.state !== "synced");
    const overallState: ArtifactState = nonSynced
      ? (adapters.find((a) => a.state === "deleted")?.state ??
        adapters.find((a) => a.state === "removed-by-user")?.state ??
        adapters.find((a) => a.state === "drifted")?.state ??
        nonSynced.state)
      : "synced";

    stacks.push({
      stack: entry.stack,
      version: entry.stackVersion,
      source: entry.source,
      adapters,
      overallState,
    });
  }

  return { stacks, hasManifest: true };
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
  if (a.mcpCount > 0) parts.push(`${a.mcpCount} MCP`);
  return parts.join(", ");
}

function formatLong(result: StatusResult): void {
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
    }
  }

  // Show drifted files (deduplicated — same file can appear across multiple adapters/stacks)
  const seenFiles = new Set<string>();
  const allDrifted: { file: string; state: ArtifactState }[] = [];
  for (const s of result.stacks) {
    for (const a of s.adapters) {
      for (const f of a.driftedFiles) {
        if (!seenFiles.has(f)) {
          seenFiles.add(f);
          allDrifted.push({ file: f, state: a.state });
        }
      }
    }
  }

  if (allDrifted.length > 0) {
    console.log();
    console.log(chalk.bold("Changes:"));
    for (const { file, state } of allDrifted) {
      console.log(`  ${stateIcon(state)} ${file}`);
    }
  }

  // Suggestions
  const hasDrift = result.stacks.some((s) => s.overallState !== "synced");
  if (hasDrift) {
    console.log();
    console.log(chalk.dim("Suggestions:"));
    console.log(chalk.dim("  Run `pit install` to restore drifted files."));
    console.log(chalk.dim("  Run `pit collect` to capture current state."));
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

  if (opts.json) {
    formatJson(result);
  } else if (opts.short) {
    formatShort(result);
  } else {
    formatLong(result);
  }
}
