import type { PlatformConfig } from "../adapters/types.js";
import type { SkillEntry, RuleEntry, McpConfig, AgentEntry } from "../shared/schema.js";
import { computeHash, normalizeForHash } from "./manifest.js";

export interface MergedStack {
  agentInstructions: string;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcpServers: McpConfig;
  rules: RuleEntry[];
}

type MergeResult = MergedStack & { warnings: string[] };

// Check if an MCP server config has version-pinned package args (e.g., @modelcontextprotocol/server-github@2025.4.8)
function hasVersionPins(server: unknown): boolean {
  const s = server as Record<string, unknown>;
  const args = s?.args;
  if (!Array.isArray(args)) return false;
  return args.some((a) => typeof a === "string" && /@\d/.test(a));
}

export function mergeConfigs(
  configs: PlatformConfig[],
): MergeResult {
  if (configs.length === 0) {
    return { agentInstructions: "", skills: [], agents: [], mcpServers: {}, rules: [], warnings: [] };
  }
  if (configs.length === 1) {
    const c = configs[0]!;
    return {
      agentInstructions: c.agentInstructions,
      skills: c.skills,
      agents: c.agents,
      mcpServers: c.mcpServers,
      rules: c.rules,
      warnings: [],
    };
  }

  const warnings: string[] = [];

  // Dedup instructions by content hash — prevents identical content from
  // multiple adapters (e.g., CLAUDE.md and AGENTS.md) being collected twice
  const seenInstructionHashes = new Set<string>();
  const uniqueInstructions: { adapterId: string; content: string }[] = [];
  for (const c of configs) {
    const trimmed = c.agentInstructions.trim();
    if (!trimmed) continue;
    const hash = computeHash(normalizeForHash(trimmed));
    if (!seenInstructionHashes.has(hash)) {
      seenInstructionHashes.add(hash);
      uniqueInstructions.push({ adapterId: c.adapterId, content: c.agentInstructions });
    }
  }
  const instructions = uniqueInstructions
    .map((u) => `## From ${u.adapterId}\n\n${u.content}`)
    .join("\n\n");

  const seenSkills = new Map<string, SkillEntry>();
  for (const config of configs) {
    for (const skill of config.skills) {
      if (!seenSkills.has(skill.name)) {
        seenSkills.set(skill.name, skill);
      }
    }
  }

  const seenMcp: McpConfig = {};
  for (const config of configs) {
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (name in seenMcp) {
        // Prefer the version with pinned packages (args containing @version suffixes)
        if (hasVersionPins(server) && !hasVersionPins(seenMcp[name]!)) {
          seenMcp[name] = server;
          warnings.push(
            `MCP server "${name}" found in multiple tools — keeping version-pinned variant`,
          );
        } else {
          warnings.push(
            `MCP server "${name}" found in multiple tools — keeping first`,
          );
        }
      } else {
        seenMcp[name] = server;
      }
    }
  }

  const seenAgents = new Map<string, AgentEntry>();
  for (const config of configs) {
    for (const agent of (config.agents ?? [])) {
      if (!seenAgents.has(agent.name)) {
        seenAgents.set(agent.name, agent);
      }
    }
  }

  const seenRules = new Map<string, RuleEntry>();
  for (const config of configs) {
    for (const rule of config.rules) {
      if (!seenRules.has(rule.name)) {
        seenRules.set(rule.name, rule);
      }
    }
  }

  return {
    agentInstructions: instructions,
    skills: [...seenSkills.values()],
    agents: [...seenAgents.values()],
    mcpServers: seenMcp,
    rules: [...seenRules.values()],
    warnings,
  };
}
