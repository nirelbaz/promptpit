import path from "node:path";
import { readManifest, computeHash, computeMcpServerHash } from "./manifest.js";
import { readFileOrNull } from "../shared/utils.js";
import { readMcpFromToml } from "../adapters/toml-utils.js";
import { parseJsonc, resolveRuleDest } from "../adapters/adapter-utils.js";
import { extractMarkerContent, hasMarkers } from "../shared/markers.js";
import type { InstallManifest, AdapterInstallRecord } from "../shared/schema.js";
import { getAdapter } from "../adapters/registry.js";

// --- Shared types ---

// Reconciliation states per the design doc
export type ArtifactState = "synced" | "drifted" | "deleted" | "removed-by-user" | "untracked";

// Priority: deleted > removed-by-user > drifted > untracked > synced
const STATE_SEVERITY: Record<ArtifactState, number> = {
  synced: 0, untracked: 1, drifted: 2, "removed-by-user": 3, deleted: 4,
};

export function escalateState(current: ArtifactState, next: ArtifactState): ArtifactState {
  return STATE_SEVERITY[next] > STATE_SEVERITY[current] ? next : current;
}

// --- Reconciled artifact types ---

export type ArtifactType = "instructions" | "skill" | "agent" | "rule" | "command" | "mcp";

export interface ReconciledArtifact {
  type: ArtifactType;
  name: string;
  path: string;
  state: ArtifactState;
  actualContent?: string;
}

export interface ReconciledAdapter {
  adapterId: string;
  artifacts: ReconciledArtifact[];
  state: ArtifactState;
  /** Whether the manifest recorded instructions for this adapter (may not have a corresponding artifact if adapter lookup failed). */
  hasInstructions: boolean;
}

export interface ReconcileResult {
  stack: string;
  version: string;
  source?: string;
  installMode?: "force-standards" | "prefer-universal";
  adapters: ReconciledAdapter[];
  overallState: ArtifactState;
}

export interface ReconcileOutput {
  stacks: ReconcileResult[];
  hasManifest: boolean;
}

// --- Core reconciliation logic ---

async function reconcileAdapter(
  root: string,
  stackName: string,
  adapterId: string,
  record: AdapterInstallRecord,
): Promise<ReconciledAdapter> {
  const artifacts: ReconciledArtifact[] = [];
  let worstState: ArtifactState = "synced";

  // Resolve adapter once — used for paths and capabilities
  let adapter: ReturnType<typeof getAdapter> | null = null;
  try {
    adapter = getAdapter(adapterId);
  } catch {
    // Unknown adapter — fall back to defaults below
  }

  // Check instructions
  if (record.instructions) {
    const filePath = adapter?.paths.project(root).config;
    if (filePath) {
      let instrState: ArtifactState = "synced";
      let actualContent: string | undefined;
      const content = await readFileOrNull(filePath);
      if (content == null) {
        instrState = "deleted";
      } else if (hasMarkers(content, stackName)) {
        const markerContent = extractMarkerContent(content, stackName);
        if (markerContent != null) {
          actualContent = markerContent;
          const currentHash = computeHash(markerContent);
          if (currentHash !== record.instructions.hash) {
            instrState = "drifted";
          }
        }
      } else {
        instrState = "removed-by-user";
      }
      worstState = escalateState(worstState, instrState);
      artifacts.push({
        type: "instructions",
        name: "instructions",
        path: filePath,
        state: instrState,
        actualContent,
      });
    }
  }

  // Check skills — use canonical .agents/skills/ path (all adapters read from here)
  const skillEntries = record.skills ?? {};
  for (const [skillName, skillRecord] of Object.entries(skillEntries)) {
    const skillPath = path.join(root, ".agents", "skills", skillName, "SKILL.md");
    let skillState: ArtifactState = "synced";
    let actualContent: string | undefined;
    const content = await readFileOrNull(skillPath);
    if (content == null) {
      skillState = "deleted";
    } else {
      actualContent = content;
      const currentHash = computeHash(content);
      if (currentHash !== skillRecord.hash) {
        skillState = "drifted";
      }
    }
    worstState = escalateState(worstState, skillState);
    artifacts.push({
      type: "skill",
      name: skillName,
      path: skillPath,
      state: skillState,
      actualContent,
    });
  }

  // Check agents — native adapters write per-file agents; inline adapters embed them in instructions
  const agentEntries = record.agents ?? {};
  if (Object.keys(agentEntries).length > 0 && adapter?.capabilities.agents === "native") {
    const agentsDir = adapter.paths.project(root).agents;
    if (agentsDir) {
      for (const [agentName, agentRecord] of Object.entries(agentEntries)) {
        // Claude Code uses <name>.md, Copilot uses <name>.agent.md, Codex uses <name>.toml
        const ext = adapterId === "copilot" ? ".agent.md" : adapterId === "codex" ? ".toml" : ".md";
        const agentPath = path.join(agentsDir, `${agentName}${ext}`);
        let agentState: ArtifactState = "synced";
        let actualContent: string | undefined;
        const content = await readFileOrNull(agentPath);
        if (content == null) {
          agentState = "deleted";
        } else {
          actualContent = content;
          const currentHash = computeHash(content);
          if (currentHash !== agentRecord.hash) {
            agentState = "drifted";
          }
        }
        worstState = escalateState(worstState, agentState);
        artifacts.push({
          type: "agent",
          name: agentName,
          path: agentPath,
          state: agentState,
          actualContent,
        });
      }
    }
  }

  // Check rules — use adapter's rules path
  const ruleEntries = record.rules ?? {};
  if (Object.keys(ruleEntries).length > 0) {
    const rulesPath = adapter?.paths.project(root).rules;
    for (const [ruleName, ruleRecord] of Object.entries(ruleEntries)) {
      // resolveRuleDest checks unprefixed path first for cursor/copilot (dedup-aware)
      let ruleFile: string;
      if (adapterId === "cursor") {
        ruleFile = await resolveRuleDest(rulesPath ?? root, ruleName, ".mdc");
      } else if (adapterId === "copilot") {
        ruleFile = await resolveRuleDest(rulesPath ?? root, ruleName, ".instructions.md");
      } else {
        ruleFile = path.join(rulesPath ?? root, `${ruleName}.md`);
      }

      let ruleState: ArtifactState = "synced";
      let actualContent: string | undefined;
      const content = await readFileOrNull(ruleFile);
      if (content == null) {
        ruleState = "deleted";
      } else {
        actualContent = content;
        const currentHash = computeHash(content);
        if (currentHash !== ruleRecord.hash) {
          ruleState = "drifted";
        }
      }
      worstState = escalateState(worstState, ruleState);
      artifacts.push({
        type: "rule",
        name: ruleName,
        path: ruleFile,
        state: ruleState,
        actualContent,
      });
    }
  }

  // Check commands
  const commandEntries = record.commands ?? {};
  if (Object.keys(commandEntries).length > 0 && adapter?.capabilities.commands) {
    const paths = adapter.paths.project(root);
    const commandsBase = paths.prompts ?? paths.commands ?? path.join(root, ".claude", "commands");
    const ext = paths.prompts ? ".prompt.md" : ".md";

    for (const [commandName, commandRecord] of Object.entries(commandEntries)) {
      const commandFile = path.join(commandsBase, `${commandName}${ext}`);
      let commandState: ArtifactState = "synced";
      let actualContent: string | undefined;
      const content = await readFileOrNull(commandFile);
      if (content == null) {
        commandState = "deleted";
      } else {
        actualContent = content;
        const currentHash = computeHash(content);
        if (currentHash !== commandRecord.hash) {
          commandState = "drifted";
        }
      }
      worstState = escalateState(worstState, commandState);
      artifacts.push({
        type: "command",
        name: commandName,
        path: commandFile,
        state: commandState,
        actualContent,
      });
    }
  }

  // Check MCP — read file once, check each server's hash
  const mcpEntries = record.mcp ?? {};
  if (Object.keys(mcpEntries).length > 0) {
    const mcpPath = adapter?.paths.project(root).mcp ?? path.join(root, ".mcp.json");
    const mcpRaw = await readFileOrNull(mcpPath);
    if (mcpRaw == null) {
      worstState = escalateState(worstState, "deleted");
      for (const serverName of Object.keys(mcpEntries)) {
        artifacts.push({ type: "mcp", name: serverName, path: mcpPath, state: "deleted" });
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
        for (const serverName of Object.keys(mcpEntries)) {
          artifacts.push({ type: "mcp", name: serverName, path: mcpPath, state: "drifted" });
        }
      }
      if (mcpParsed) {
        for (const [serverName, mcpRecord] of Object.entries(mcpEntries)) {
          let serverState: ArtifactState = "synced";
          let actualContent: string | undefined;
          const serverConfig = mcpParsed[serverName];
          if (!serverConfig) {
            serverState = "deleted";
          } else {
            actualContent = JSON.stringify(serverConfig, null, 2);
            const currentHash = computeMcpServerHash(serverConfig as Record<string, unknown>);
            if (currentHash !== mcpRecord.hash) {
              serverState = "drifted";
            }
          }
          worstState = escalateState(worstState, serverState);
          artifacts.push({
            type: "mcp",
            name: serverName,
            path: mcpPath,
            state: serverState,
            actualContent,
          });
        }
      }
    }
  }

  return { adapterId, artifacts, state: worstState, hasInstructions: !!record.instructions };
}

export async function reconcileAll(root: string): Promise<ReconcileOutput> {
  let manifest: InstallManifest;
  try {
    manifest = await readManifest(root);
  } catch {
    return { stacks: [], hasManifest: false };
  }

  if (manifest.installs.length === 0) {
    return { stacks: [], hasManifest: true };
  }

  const stacks: ReconcileResult[] = [];

  for (const entry of manifest.installs) {
    const adapters: ReconciledAdapter[] = [];

    for (const [adapterId, record] of Object.entries(entry.adapters)) {
      const reconciled = await reconcileAdapter(root, entry.stack, adapterId, record);
      adapters.push(reconciled);
    }

    const overallState = adapters.reduce<ArtifactState>(
      (worst, a) => escalateState(worst, a.state), "synced",
    );

    stacks.push({
      stack: entry.stack,
      version: entry.stackVersion,
      source: entry.source,
      installMode: entry.installMode,
      adapters,
      overallState,
    });
  }

  return { stacks, hasManifest: true };
}
