import path from "node:path";
import chalk from "chalk";
import { readManifest, computeHash, computeMcpServerHash } from "../core/manifest.js";
import { readFileOrNull } from "../shared/utils.js";
import { readMcpFromToml } from "../adapters/toml-utils.js";
import { parseJsonc } from "../adapters/adapter-utils.js";
import { extractMarkerContent, hasMarkers } from "../shared/markers.js";
import type { InstallManifest, AdapterInstallRecord } from "../shared/schema.js";
import { getAdapter } from "../adapters/registry.js";
import { log } from "../shared/io.js";

export interface StatusOptions {
  json?: boolean;
  short?: boolean;
  verbose?: boolean;
}

// Reconciliation states per the design doc
export type ArtifactState = "synced" | "drifted" | "deleted" | "removed-by-user" | "untracked";

// Priority: deleted > removed-by-user > drifted > untracked > synced
const STATE_SEVERITY: Record<ArtifactState, number> = {
  synced: 0, untracked: 1, drifted: 2, "removed-by-user": 3, deleted: 4,
};

function escalateState(current: ArtifactState, next: ArtifactState): ArtifactState {
  return STATE_SEVERITY[next] > STATE_SEVERITY[current] ? next : current;
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
  hasInstructions: boolean;
  state: ArtifactState;
  driftedFiles: string[];
  // Verbose details
  instructionDetail?: ArtifactDetail;
  skillDetails: ArtifactDetail[];
  ruleDetails: ArtifactDetail[];
  mcpDetails: ArtifactDetail[];
  agentDetails: ArtifactDetail[];
}

export interface StackStatus {
  stack: string;
  version: string;
  source?: string;
  adapters: AdapterStatus[];
  overallState: ArtifactState;
}

export interface StatusResult {
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

  // Resolve adapter once — used for paths and capabilities
  let adapter: ReturnType<typeof getAdapter> | null = null;
  try {
    adapter = getAdapter(adapterId);
  } catch {
    // Unknown adapter — fall back to defaults below
  }

  // Check instructions
  let instructionDetail: ArtifactDetail | undefined;
  if (record.instructions) {
    const filePath = adapter?.paths.project(root).config;
    if (filePath) {
      let instrState: ArtifactState = "synced";
      const content = await readFileOrNull(filePath);
      if (content == null) {
        instrState = "deleted";
        driftedFiles.push(filePath);
      } else if (hasMarkers(content, stackName)) {
        const markerContent = extractMarkerContent(content, stackName);
        if (markerContent != null) {
          const currentHash = computeHash(markerContent);
          if (currentHash !== record.instructions.hash) {
            instrState = "drifted";
            driftedFiles.push(filePath);
          }
        }
      } else {
        instrState = "removed-by-user";
        driftedFiles.push(filePath);
      }
      worstState = escalateState(worstState, instrState);
      instructionDetail = { name: "instructions", path: filePath, state: instrState };
    }
  }

  // Check skills — use canonical .agents/skills/ path (all adapters read from here)
  const skillEntries = record.skills ?? {};
  const skillDetails: ArtifactDetail[] = [];
  for (const [skillName, skillRecord] of Object.entries(skillEntries)) {
    const skillPath = path.join(root, ".agents", "skills", skillName, "SKILL.md");
    let skillState: ArtifactState = "synced";
    const content = await readFileOrNull(skillPath);
    if (content == null) {
      skillState = "deleted";
      driftedFiles.push(skillPath);
    } else {
      const currentHash = computeHash(content);
      if (currentHash !== skillRecord.hash) {
        skillState = "drifted";
        driftedFiles.push(skillPath);
      }
    }
    worstState = escalateState(worstState, skillState);
    skillDetails.push({ name: skillName, path: skillPath, state: skillState });
  }

  // Check agents — native adapters write per-file agents; inline adapters embed them in instructions
  const agentEntries = record.agents ?? {};
  const agentDetails: ArtifactDetail[] = [];
  if (Object.keys(agentEntries).length > 0 && adapter?.capabilities.agents === "native") {
    const agentsDir = adapter.paths.project(root).agents;
    if (agentsDir) {
      for (const [agentName, agentRecord] of Object.entries(agentEntries)) {
        // Claude Code uses <name>.md, Copilot uses <name>.agent.md
        const ext = adapterId === "copilot" ? ".agent.md" : ".md";
        const agentPath = path.join(agentsDir, `${agentName}${ext}`);
        let agentState: ArtifactState = "synced";
        const content = await readFileOrNull(agentPath);
        if (content == null) {
          agentState = "deleted";
          driftedFiles.push(agentPath);
        } else {
          const currentHash = computeHash(content);
          if (currentHash !== agentRecord.hash) {
            agentState = "drifted";
            driftedFiles.push(agentPath);
          }
        }
        worstState = escalateState(worstState, agentState);
        agentDetails.push({ name: agentName, path: agentPath, state: agentState });
      }
    }
  }

  // Check rules — use adapter's rules path
  const ruleEntries = record.rules ?? {};
  const ruleDetails: ArtifactDetail[] = [];
  if (Object.keys(ruleEntries).length > 0) {
    const rulesPath = adapter?.paths.project(root).rules;
    for (const [ruleName, ruleRecord] of Object.entries(ruleEntries)) {
      let ruleFile: string;
      if (adapterId === "cursor") {
        const prefixed = ruleName.startsWith("rule-") ? ruleName : `rule-${ruleName}`;
        ruleFile = path.join(rulesPath ?? root, `${prefixed}.mdc`);
      } else if (adapterId === "copilot") {
        const prefixed = ruleName.startsWith("rule-") ? ruleName : `rule-${ruleName}`;
        ruleFile = path.join(rulesPath ?? root, `${prefixed}.instructions.md`);
      } else {
        ruleFile = path.join(rulesPath ?? root, `${ruleName}.md`);
      }

      let ruleState: ArtifactState = "synced";
      const content = await readFileOrNull(ruleFile);
      if (content == null) {
        ruleState = "deleted";
        driftedFiles.push(ruleFile);
      } else {
        const currentHash = computeHash(content);
        if (currentHash !== ruleRecord.hash) {
          ruleState = "drifted";
          driftedFiles.push(ruleFile);
        }
      }
      worstState = escalateState(worstState, ruleState);
      ruleDetails.push({ name: ruleName, path: ruleFile, state: ruleState });
    }
  }

  // Check MCP — read file once, check each server's hash
  const mcpEntries = record.mcp ?? {};
  const mcpDetails: ArtifactDetail[] = [];
  if (Object.keys(mcpEntries).length > 0) {
    const mcpPath = adapter?.paths.project(root).mcp ?? path.join(root, ".mcp.json");
    const mcpRaw = await readFileOrNull(mcpPath);
    if (mcpRaw == null) {
      worstState = escalateState(worstState, "deleted");
      driftedFiles.push(mcpPath);
      for (const serverName of Object.keys(mcpEntries)) {
        mcpDetails.push({ name: serverName, path: mcpPath, state: "deleted" });
      }
    } else {
      let mcpParsed: Record<string, unknown> | null = null;
      const mcpFormat = adapter?.capabilities.mcpFormat ?? "json";
      const mcpRootKey = adapter?.capabilities.mcpRootKey ?? "mcpServers";
      try {
        if (mcpFormat === "toml") {
          mcpParsed = readMcpFromToml(mcpRaw) as Record<string, unknown>;
        } else {
          const parsed = parseJsonc(mcpRaw) as Record<string, unknown>;
          mcpParsed = (parsed[mcpRootKey] ?? {}) as Record<string, unknown>;
        }
      } catch {
        worstState = escalateState(worstState, "drifted");
        driftedFiles.push(mcpPath);
        for (const serverName of Object.keys(mcpEntries)) {
          mcpDetails.push({ name: serverName, path: mcpPath, state: "drifted" });
        }
      }
      if (mcpParsed) {
        for (const [serverName, mcpRecord] of Object.entries(mcpEntries)) {
          let serverState: ArtifactState = "synced";
          const serverConfig = mcpParsed[serverName];
          if (!serverConfig) {
            serverState = "deleted";
            driftedFiles.push(mcpPath);
          } else {
            const currentHash = computeMcpServerHash(serverConfig as Record<string, unknown>);
            if (currentHash !== mcpRecord.hash) {
              serverState = "drifted";
              driftedFiles.push(mcpPath);
            }
          }
          worstState = escalateState(worstState, serverState);
          mcpDetails.push({ name: serverName, path: mcpPath, state: serverState });
        }
      }
    }
  }

  return {
    adapterId,
    skillCount: Object.keys(skillEntries).length,
    ruleCount: Object.keys(ruleEntries).length,
    mcpCount: Object.keys(mcpEntries).length,
    agentCount: Object.keys(agentEntries).length,
    hasInstructions: !!record.instructions,
    state: worstState,
    driftedFiles,
    instructionDetail,
    skillDetails,
    ruleDetails,
    mcpDetails,
    agentDetails,
  };
}

export async function computeStatus(root: string): Promise<StatusResult> {
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

    const overallState = adapters.reduce<ArtifactState>(
      (worst, a) => escalateState(worst, a.state), "synced",
    );

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
  if (a.agentCount > 0) parts.push(`${a.agentCount} agent${a.agentCount === 1 ? "" : "s"}`);
  if (a.ruleCount > 0) parts.push(`${a.ruleCount} rule${a.ruleCount === 1 ? "" : "s"}`);
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
        for (const d of adapter.ruleDetails) {
          printDetailLine(d, "rule", root);
        }
        for (const d of adapter.mcpDetails) {
          printDetailLine(d, "mcp", root);
        }
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

  if (opts.json) {
    formatJson(result);
  } else if (opts.short) {
    formatShort(result);
  } else {
    formatDetailed(result, root, !!opts.verbose);
  }
}
