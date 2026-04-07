import { z } from "zod";

const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[\w.]+)?(\+[\w.]+)?$/;

// --- Stack Manifest (stack.json) ---

export const stackManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9_@][a-zA-Z0-9_.\-/]*$/,
      "Only alphanumeric, dash, underscore, dot, @, and / allowed",
    ),
  version: z.string().regex(semverRegex, "Must be valid semver (e.g., 1.0.0)"),
  description: z.string().optional(),
  license: z.string().optional(),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  compatibility: z.array(z.string()).optional(),
});

export type StackManifest = z.infer<typeof stackManifestSchema>;

// --- Skill Frontmatter ---

// YAML parses `allowed-tools: Read` as a string, not an array.
// Coerce single strings into arrays so both forms are accepted.
const stringOrArray = z.preprocess(
  (val: unknown) => (typeof val === "string" ? [val] : val),
  z.array(z.string()),
);

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  license: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  "allowed-tools": stringOrArray.optional(),
  context: stringOrArray.optional(),
  agent: z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  model: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

// --- Agent Frontmatter ---

export const agentFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: stringOrArray.optional(),
  model: z.string().optional(),
}).passthrough();

export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

export interface AgentEntry {
  name: string;
  path: string;
  frontmatter: AgentFrontmatter;
  content: string;
}

// --- Rule Frontmatter ---

export const ruleFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  globs: z.preprocess(
    (val: unknown) => {
      if (val === null || val === undefined) return undefined;
      if (typeof val === "string") return [val];
      return val;
    },
    z.array(z.string()).optional(),
  ),
  alwaysApply: z.boolean().optional(),
});

export type RuleFrontmatter = z.infer<typeof ruleFrontmatterSchema>;

// --- Rule Entry ---

export interface RuleEntry {
  name: string;
  path: string;
  frontmatter: RuleFrontmatter;
  content: string;
}

// --- Command Frontmatter (optional) ---

export const commandFrontmatterSchema = z.object({
  description: z.string().optional(),
}).passthrough();

export type CommandFrontmatter = z.infer<typeof commandFrontmatterSchema>;

// --- Command Entry ---

export interface CommandEntry {
  name: string;
  path: string;
  content: string;
}

// --- MCP Server Config ---

export const mcpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  serverUrl: z.string().optional(),
}).passthrough().refine(
  (s) => s.command || s.url || s.serverUrl,
  { message: "MCP server must have command (stdio) or url/serverUrl (remote)" },
);

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
  agents: AgentEntry[];
  rules: RuleEntry[];
  commands: CommandEntry[];
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

// --- Install Manifest (.promptpit/installed.json) ---

const artifactHashSchema = z.object({
  hash: z.string(),
});

const adapterInstallSchema = z.object({
  instructions: artifactHashSchema.optional(),
  skills: z.record(artifactHashSchema).optional(),
  agents: z.record(artifactHashSchema).optional(),
  rules: z.record(artifactHashSchema).optional(),
  commands: z.record(artifactHashSchema).optional(),
  mcp: z.record(artifactHashSchema).optional(),
});

export type AdapterInstallRecord = z.infer<typeof adapterInstallSchema>;

const installEntrySchema = z.object({
  stack: z.string().min(1),
  stackVersion: z.string(),
  source: z.string().optional(),
  installedAt: z.string(),
  adapters: z.record(adapterInstallSchema),
});

export type InstallEntry = z.infer<typeof installEntrySchema>;

export const installManifestSchema = z.object({
  version: z.literal(1),
  installs: z.array(installEntrySchema),
});

export type InstallManifest = z.infer<typeof installManifestSchema>;
