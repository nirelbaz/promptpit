import { z } from "zod";

const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[\w.]+)?(\+[\w.]+)?$/;

// --- Stack Manifest (stack.json) ---

export const stackManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(semverRegex, "Must be valid semver (e.g., 1.0.0)"),
  description: z.string().optional(),
  license: z.string().optional(),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  compatibility: z.array(z.string()).optional(),
});

export type StackManifest = z.infer<typeof stackManifestSchema>;

// --- Skill Frontmatter ---

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  license: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  "allowed-tools": z.array(z.string()).optional(),
  context: z.array(z.string()).optional(),
  agent: z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  model: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

// --- MCP Server Config ---

export const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export const mcpConfigSchema = z.record(mcpServerSchema);
export type McpConfig = z.infer<typeof mcpConfigSchema>;

// --- Stack Bundle (the full .promptpit/ contents in memory) ---

export interface SkillEntry {
  name: string;
  path: string;
  frontmatter: SkillFrontmatter;
  content: string;
}

export interface StackBundle {
  manifest: StackManifest;
  agentInstructions: string;
  skills: SkillEntry[];
  mcpServers: McpConfig;
  envExample: Record<string, string>;
}

// --- Env var name security ---

const DANGEROUS_ENV_NAMES = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "RUBYOPT",
  "PERL5OPT",
  "BASH_ENV",
  "ENV",
  "ZDOTDIR",
  "HOME",
  "USER",
  "SHELL",
]);

export function isDangerousEnvName(name: string): boolean {
  return DANGEROUS_ENV_NAMES.has(name.toUpperCase());
}
