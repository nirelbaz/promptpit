import type { StackBundle, McpConfig, SkillEntry } from "../shared/schema.js";

// --- Path Sets ---

export interface PathSet {
  config: string;
  skills: string;
  mcp: string;
  rules?: string;
}

export interface AdapterPaths {
  project(root: string): PathSet;
  user(): PathSet;
}

// --- Detection ---

export interface DetectionResult {
  detected: boolean;
  configPaths: string[];
}

// --- Capabilities ---

export interface AdapterCapabilities {
  skillLinkStrategy: "symlink" | "translate-copy" | "none";
  rules: boolean;
  skillFormat: "skill.md" | "mdc" | "md";
  mcpStdio: boolean;
  mcpRemote: boolean;
  agentsmd: boolean;
  hooks: boolean;
}

// --- Platform Config (read from a single adapter) ---

export interface PlatformConfig {
  adapterId: string;
  agentInstructions: string;
  skills: SkillEntry[];
  mcpServers: McpConfig;
  rules: string[];
}

// --- Write Options ---

export interface WriteOptions {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  global?: boolean;
  canonicalSkillPaths?: Map<string, string>;
}

// --- Dry-Run Reporting ---

export interface DryRunEntry {
  file: string;
  action: "create" | "modify" | "skip";
  detail?: string;
  oldContent?: string;
  newContent?: string;
}

// --- Write Result ---

export interface WriteResult {
  filesWritten: string[];
  filesSkipped: string[];
  warnings: string[];
  dryRunEntries?: DryRunEntry[];
}

// --- The Adapter Contract ---

export interface PlatformAdapter {
  id: string;
  displayName: string;
  paths: AdapterPaths;
  capabilities: AdapterCapabilities;
  detect(root: string): Promise<DetectionResult>;
  read(root: string): Promise<PlatformConfig>;
  write(
    root: string,
    stack: StackBundle,
    opts: WriteOptions,
  ): Promise<WriteResult>;
}
