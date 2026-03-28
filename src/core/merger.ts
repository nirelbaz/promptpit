import type { PlatformConfig } from "../adapters/types.js";
import type { SkillEntry, McpConfig } from "../shared/schema.js";

export interface MergedStack {
  agentInstructions: string;
  skills: SkillEntry[];
  mcpServers: McpConfig;
  rules: string[];
}

interface MergeOptions {
  returnWarnings?: boolean;
}

type MergeResult = MergedStack & { warnings?: string[] };

export function mergeConfigs(
  configs: PlatformConfig[],
  opts?: MergeOptions,
): MergeResult {
  if (configs.length === 0) {
    return { agentInstructions: "", skills: [], mcpServers: {}, rules: [] };
  }
  if (configs.length === 1) {
    const c = configs[0]!;
    return {
      agentInstructions: c.agentInstructions,
      skills: [...c.skills],
      mcpServers: { ...c.mcpServers },
      rules: [...c.rules],
    };
  }

  const warnings: string[] = [];

  const instructions = configs
    .filter((c) => c.agentInstructions.trim())
    .map((c) => `## From ${c.adapterId}\n\n${c.agentInstructions}`)
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

  const rules = configs.flatMap((c) => c.rules);

  const result: MergeResult = {
    agentInstructions: instructions,
    skills: [...seenSkills.values()],
    mcpServers: seenMcp,
    rules,
  };

  if (opts?.returnWarnings) {
    result.warnings = warnings;
  }

  return result;
}
