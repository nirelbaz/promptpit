import type { PlatformConfig } from "../adapters/types.js";
import type { SkillEntry, RuleEntry, McpConfig } from "../shared/schema.js";
import { computeHash, normalizeForHash } from "./manifest.js";

export interface MergedStack {
  agentInstructions: string;
  skills: SkillEntry[];
  mcpServers: McpConfig;
  rules: RuleEntry[];
}

type MergeResult = MergedStack & { warnings: string[] };

export function mergeConfigs(
  configs: PlatformConfig[],
): MergeResult {
  if (configs.length === 0) {
    return { agentInstructions: "", skills: [], mcpServers: {}, rules: [] as RuleEntry[], warnings: [] };
  }
  if (configs.length === 1) {
    const c = configs[0]!;
    return {
      agentInstructions: c.agentInstructions,
      skills: c.skills,
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
        warnings.push(
          `MCP server "${name}" found in multiple tools — keeping first`,
        );
      } else {
        seenMcp[name] = server;
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
    mcpServers: seenMcp,
    rules: [...seenRules.values()],
    warnings,
  };
}
