import path from "node:path";
import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
import { installManifestSchema } from "../shared/schema.js";
import type { InstallManifest, InstallEntry, McpServerConfig, SupportingFile, AdapterInstallRecord, StackBundle } from "../shared/schema.js";
import type { PlatformAdapter, WriteOptions } from "../adapters/types.js";
import { buildInlineContent } from "../adapters/adapter-utils.js";
import { ruleToClaudeFormat } from "../adapters/claude-code.js";
import { ruleToMdc } from "../adapters/cursor.js";
import { ruleToInstructionsMd, agentToGitHubAgent } from "../adapters/copilot.js";
import { agentToCodexToml } from "../adapters/toml-utils.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";

const MANIFEST_FILE = "installed.json";

function manifestPath(root: string): string {
  return path.join(root, ".promptpit", MANIFEST_FILE);
}

export function emptyManifest(): InstallManifest {
  return { version: 1, installs: [] };
}

export async function readManifest(root: string): Promise<InstallManifest> {
  const raw = await readFileOrNull(manifestPath(root));
  if (!raw) return emptyManifest();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Corrupt manifest at ${manifestPath(root)}: invalid JSON. ` +
        `Delete the file and run \`pit install\` again.`,
    );
  }

  const result = installManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid manifest at ${manifestPath(root)}: ${result.error.errors.map((e) => e.message).join(", ")}. ` +
        `Delete the file and run \`pit install\` again.`,
    );
  }

  return result.data;
}

// Atomic write: write to .tmp then rename
export async function writeManifest(
  root: string,
  manifest: InstallManifest,
): Promise<void> {
  const dest = manifestPath(root);
  const tmp = dest + ".tmp";
  await writeFileEnsureDir(tmp, JSON.stringify(manifest, null, 2) + "\n");
  await rename(tmp, dest);
}

// Upsert: same stack name replaces, different stack name appends
export function upsertInstall(
  manifest: InstallManifest,
  entry: InstallEntry,
): InstallManifest {
  const filtered = manifest.installs.filter((e) => e.stack !== entry.stack);
  return { ...manifest, installs: [...filtered, entry] };
}

export function computeHash(content: string): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

/** Composite hash for a skill: SKILL.md content + sorted supporting file hashes.
 *  When no supporting files, identical to computeHash(content). */
export function computeSkillHash(content: string, supportingFiles?: SupportingFile[]): string {
  if (!supportingFiles || supportingFiles.length === 0) {
    return computeHash(content);
  }
  const fileHashes = supportingFiles
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((f) => createHash("sha256").update(f.content).digest("hex"))
    .join("");
  return "sha256:" + createHash("sha256").update(content + fileHashes).digest("hex");
}

// Normalize content for hash comparison (instructions may have whitespace diffs)
export function normalizeForHash(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

// Canonical MCP server fields — only these are included in the hash.
// Adapter-added fields (e.g. Copilot's "type") are excluded so install-time
// and status-time hashes match regardless of adapter transformations.
const MCP_CANONICAL_KEYS = ["command", "args", "env", "url", "serverUrl"];

/** Sort all object keys recursively for deterministic serialization. */
function sortedStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(sortedStringify).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedStringify(obj[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Deterministic hash of an MCP server config, ignoring adapter-added fields. */
export function computeMcpServerHash(serverConfig: McpServerConfig | Record<string, unknown>): string {
  const canonical: Record<string, unknown> = {};
  for (const key of MCP_CANONICAL_KEYS) {
    if (key in serverConfig && serverConfig[key] !== undefined) {
      canonical[key] = serverConfig[key];
    }
  }
  return computeHash(sortedStringify(canonical));
}

// --- Shared adapter hash computation ---

export interface AdapterWriteContext {
  adapter: PlatformAdapter;
  writeOpts: WriteOptions;
}

/**
 * Build per-adapter hash records for the install manifest.
 * Used by both install and update commands.
 */
export function buildAdapterRecords(
  contexts: AdapterWriteContext[],
  bundle: StackBundle,
  target: string,
): Record<string, AdapterInstallRecord> {
  const adapterRecords: Record<string, AdapterInstallRecord> = {};

  for (const { adapter, writeOpts } of contexts) {
    const record: AdapterInstallRecord = {};

    // Hash instructions
    const skipAdapterInstructions =
      (adapter.id === "standards" && writeOpts.skipInstructions) ||
      (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.instructions);
    if (!skipAdapterInstructions && (bundle.agentInstructions || (bundle.agents.length > 0 && adapter.capabilities.agents === "inline"))) {
      const configPath = adapter.paths.project(target).config;
      if (configPath) {
        const written = adapter.capabilities.agents === "inline"
          ? buildInlineContent(bundle.agentInstructions, bundle.agents) ?? ""
          : bundle.agentInstructions;
        record.instructions = { hash: computeHash(written.trim()) };
      }
    }

    // Hash skills
    if (bundle.skills.length > 0) {
      const skills: Record<string, { hash: string; supportingFiles?: string[] }> = {};
      for (const skill of bundle.skills) {
        skills[skill.name] = {
          hash: computeSkillHash(skill.content, skill.supportingFiles),
          supportingFiles: skill.supportingFiles?.map((f) => f.relativePath) ?? [],
        };
      }
      if (Object.keys(skills).length > 0) {
        record.skills = skills;
      }
    }

    // Hash agents (native adapters translate per-file)
    if (bundle.agents.length > 0 && adapter.capabilities.agents === "native") {
      const agents: Record<string, { hash: string }> = {};
      for (const agent of bundle.agents) {
        let translated = agent.content;
        if (adapter.id === "copilot") translated = agentToGitHubAgent(agent.content);
        else if (adapter.id === "codex") translated = agentToCodexToml(agent.content);
        agents[agent.name] = { hash: computeHash(translated) };
      }
      if (Object.keys(agents).length > 0) {
        record.agents = agents;
      }
    }

    // Hash rules (translated content per adapter)
    if (bundle.rules.length > 0 && adapter.capabilities.rules) {
      const rules: Record<string, { hash: string }> = {};
      for (const rule of bundle.rules) {
        let translated = rule.content;
        if (adapter.id === "claude-code") translated = ruleToClaudeFormat(rule.content);
        else if (adapter.id === "cursor") translated = ruleToMdc(rule.content);
        else if (adapter.id === "copilot") translated = ruleToInstructionsMd(rule.content);
        rules[rule.name] = { hash: computeHash(translated) };
      }
      if (Object.keys(rules).length > 0) {
        record.rules = rules;
      }
    }

    // Hash MCP
    const skipAdapterMcp =
      (adapter.id === "standards" && writeOpts.skipMcp) ||
      (adapter.id !== "standards" && writeOpts.preferUniversal && adapter.capabilities.nativelyReads?.mcp);
    if (!skipAdapterMcp && adapter.capabilities.mcpStdio && Object.keys(bundle.mcpServers).length > 0) {
      const mcp: Record<string, { hash: string }> = {};
      for (const [serverName, serverConfig] of Object.entries(bundle.mcpServers)) {
        mcp[serverName] = { hash: computeMcpServerHash(serverConfig) };
      }
      record.mcp = mcp;
    }

    // Hash commands
    if (bundle.commands.length > 0 && adapter.capabilities.commands) {
      const commands: Record<string, { hash: string }> = {};
      for (const command of bundle.commands) {
        commands[command.name] = { hash: computeHash(command.content) };
      }
      record.commands = commands;
    }

    if (record.instructions || record.skills || record.agents || record.rules || record.mcp || record.commands) {
      adapterRecords[adapter.id] = record;
    }
  }

  return adapterRecords;
}
