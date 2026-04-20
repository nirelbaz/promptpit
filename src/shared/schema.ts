import { z } from "zod";
import { DEFAULT_IGNORE } from "./constants.js";

const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(\.(0|[1-9]\d*))?(-[\w.]+)?(\+[\w.]+)?$/;

// --- Stack Manifest (stack.json) ---

export const stackManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9_@][a-zA-Z0-9_.\-/]*$/,
      "Only alphanumeric, dash, underscore, dot, @, and / allowed",
    ),
  version: z.string().regex(semverRegex, "Must be valid semver (e.g., 1.0.0 or 1.0.0.0)"),
  description: z.string().optional(),
  license: z.string().optional(),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  compatibility: z.array(z.string()).optional(),
  extends: z.array(z.string()).optional(),
  instructionStrategy: z.enum(["concatenate", "override"]).optional(),
  scripts: z.object({
    preinstall: z.string().min(1).optional(),
    postinstall: z.string().min(1).optional(),
  }).optional(),
  // Declarative conflict resolutions, keyed by "type:name"
  // (e.g., "skill:deploy", "mcp:filesystem"). Values are the source
  // identifier of the extends entry whose definition should win. Stack-local
  // only: not inherited through extends chains. Per-adapter scoping is a
  // future extension; v0.5 resolves at the source-bundle layer (adapter-
  // agnostic) which is where conflicts actually arise.
  overrides: z.record(z.string()).optional(),
});

export type StackManifest = z.infer<typeof stackManifestSchema>;

// --- Skill Frontmatter ---

// YAML parses `allowed-tools: Read` as a string, not an array.
// Coerce single strings into arrays so both forms are accepted.
const stringOrArray = z.preprocess(
  (val: unknown) => (typeof val === "string" ? [val] : val),
  z.array(z.string()),
);

/**
 * Skill frontmatter schema.
 *
 * **Categorization policy:** Fields from the Agent Skills spec, shared by 2+
 * tools, or commonly needed for faithful round-trip translation are explicitly
 * typed. Truly exotic tool-specific fields pass through via `.passthrough()`.
 *
 * Typed: name, description, license, metadata, allowed-tools, context, agent,
 *   user-invocable, model (existing); argument-hint, disable-model-invocation
 *   (Agent Skills spec); effort, hooks, paths, shell (Claude Code, typed for
 *   validation since they affect skill behavior).
 * Passthrough: any other tool-specific fields.
 */
export const skillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64).regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Must be 1-64 lowercase alphanumeric characters or hyphens, starting with alphanumeric",
  ),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  "allowed-tools": stringOrArray.optional(),
  context: stringOrArray.optional(),
  agent: z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  model: z.string().optional(),
  // Additional typed fields (Agent Skills spec, or commonly needed for translation)
  "argument-hint": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  effort: z.string().optional(),
  hooks: z.unknown().optional(),
  paths: stringOrArray.optional(),
  shell: z.string().optional(),
}).passthrough();

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

// --- Agent Frontmatter ---

/**
 * Agent frontmatter schema.
 *
 * **Categorization policy:** Fields shared by 2+ tools, affecting translation
 * logic, or commonly needed for faithful round-trip preservation are explicitly
 * typed. Truly exotic tool-specific fields (permissionMode, isolation,
 * sandbox_mode, nickname_candidates, etc.) pass through via `.passthrough()`
 * — they're preserved during round-trips but not validated.
 *
 * Typed: name, description, tools, model (core); disable-model-invocation,
 *   user-invocable (Copilot + Claude Code skills); target, metadata (Copilot);
 *   mcp-servers (Copilot + Claude Code); effort (Claude Code + Codex concept);
 *   maxTurns (Claude Code, affects agent behavior).
 * Passthrough: permissionMode, skills, background, isolation, color,
 *   initialPrompt, disallowedTools, memory, nickname_candidates, sandbox_mode,
 *   model_reasoning_effort, developer_instructions.
 */
export const agentFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: stringOrArray.optional(),
  model: z.string().optional(),
  // Additional typed fields (cross-tool or affecting translation/behavior)
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  target: z.string().optional(),
  "mcp-servers": z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  effort: z.string().optional(),
  maxTurns: z.number().optional(),
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

export interface SupportingFile {
  /** Path relative to the skill directory root (e.g., "scripts/setup.sh") */
  relativePath: string;
  /** File content as a Buffer */
  content: Buffer;
}

export interface SkillEntry {
  name: string;
  path: string;
  frontmatter: SkillFrontmatter;
  content: string;
  /** Non-SKILL.md files in the skill directory (scripts, references, assets, etc.) */
  supportingFiles?: SupportingFile[];
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

// `forked` marks an artifact where the user chose "keep mine" during
// `pit update --interactive`. `hash` is the local content hash at fork time;
// `baselineHash` is what upstream had at the same moment, so future updates
// can still surface upstream changes relative to the baseline.
const artifactHashSchema = z.object({
  hash: z.string(),
  forked: z.literal(true).optional(),
  baselineHash: z.string().optional(),
});

const skillArtifactHashSchema = z.object({
  hash: z.string(),
  supportingFiles: z.array(z.string()).optional(),
  forked: z.literal(true).optional(),
  baselineHash: z.string().optional(),
});

const adapterInstallSchema = z.object({
  instructions: artifactHashSchema.optional(),
  skills: z.record(skillArtifactHashSchema).optional(),
  agents: z.record(artifactHashSchema).optional(),
  rules: z.record(artifactHashSchema).optional(),
  commands: z.record(artifactHashSchema).optional(),
  mcp: z.record(artifactHashSchema).optional(),
});

export type AdapterInstallRecord = z.infer<typeof adapterInstallSchema>;

const resolvedExtendsEntrySchema = z.object({
  source: z.string(),
  version: z.string().optional(),
  resolvedCommit: z.string().optional(),
  resolvedAt: z.string(),
});

// `.passthrough()` preserves unknown fields on read-and-write round-trips,
// so older pit versions don't strip newer schema additions (overrides,
// excluded, forked/baselineHash) when writing the manifest.
const installEntrySchema = z.object({
  stack: z.string().min(1),
  stackVersion: z.string(),
  source: z.string().optional(),
  resolvedCommit: z.string().optional(),
  installedAt: z.string(),
  installMode: z.enum(["force-standards", "prefer-universal"]).optional(),
  resolvedExtends: z.array(resolvedExtendsEntrySchema).optional(),
  adapters: z.record(adapterInstallSchema),
  // Interactive conflict resolutions chosen by the user during
  // `pit install --interactive`. Same "type:name" key shape as stack.json
  // overrides.
  overrides: z.record(z.string()).optional(),
  // Artifacts the user opted out of via `pit install --select`. Format:
  // "type:name". Cleared by `--reset-exclusions`.
  excluded: z.array(z.string()).optional(),
}).passthrough();

export type InstallEntry = z.infer<typeof installEntrySchema>;

export const installManifestSchema = z.object({
  version: z.literal(1),
  installs: z.array(installEntrySchema),
});

export type InstallManifest = z.infer<typeof installManifestSchema>;

// --- Scanned stacks (for TUI + `pit ls`) ---

export const adapterIdSchema = z.enum([
  "claude-code", "cursor", "codex", "copilot", "standards",
]);

const scannedAdapterArtifactsSchema = z.object({
  skills: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
  agents: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  mcp: z.number().int().nonnegative(),
  instructions: z.boolean(),
});

export const scannedStackSchema = z.object({
  root: z.string(),
  kind: z.enum(["managed", "unmanaged", "global"]),
  name: z.string(),
  /** Set when `installed.json` exists but can't be parsed or reconciled. The TUI uses this to
   *  surface a "Delete installed.json and refresh" recovery action (see spec §12). */
  manifestCorrupt: z.boolean().default(false),
  promptpit: z.object({
    stackVersion: z.string(),
    source: z.string().optional(),
    hasInstalledJson: z.boolean(),
  }).optional(),
  adapters: z.array(z.object({
    id: adapterIdSchema,
    artifacts: scannedAdapterArtifactsSchema,
    drift: z.enum(["synced", "drifted", "unknown"]).optional(),
  })),
  unmanagedAnnotations: z.array(z.object({
    subpath: z.string(),
    adapterId: adapterIdSchema,
    counts: scannedAdapterArtifactsSchema,
  })),
  overallDrift: z.enum(["synced", "drifted", "unknown"]).optional(),
});

export type ScannedStack = z.infer<typeof scannedStackSchema>;

// --- User Config (~/.promptpit/config.json) ---

export const configSchema = z.object({
  version: z.literal(1),
  scan: z.object({
    defaultDepth: z.number().int().positive().default(5),
    ignore: z.array(z.string()).default([...DEFAULT_IGNORE]),
  }).default({}),
  recents: z.object({
    targetPaths: z.array(z.string()).max(20).default([]),
    sources: z.array(z.string()).max(20).default([]),
  }).default({}),
  ui: z.object({
    showGlobalRow: z.boolean().default(true),
    offline: z.boolean().default(false),
  }).default({}),
});

export type PitConfig = z.infer<typeof configSchema>;

// --- Trust Store (~/.promptpit/trust.json) ---

export const trustSchema = z.object({
  version: z.literal(1),
  trusted: z.record(z.string(), z.object({
    trustedAt: z.string().datetime(),
    scripts: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  })).default({}),
});

export type PitTrust = z.infer<typeof trustSchema>;
