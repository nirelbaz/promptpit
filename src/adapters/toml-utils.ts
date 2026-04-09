import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import { parse, stringify } from "smol-toml";
import type { McpConfig, McpServerConfig, AgentEntry } from "../shared/schema.js";
import { readFileOrNull } from "../shared/utils.js";
import { inferAgentDefaults, SAFE_MATTER_OPTIONS } from "./adapter-utils.js";
import { agentFrontmatterSchema } from "../shared/schema.js";
import { log } from "../shared/io.js";

/**
 * Read MCP servers from a config.toml string.
 * Extracts [mcp_servers.*] sections and maps to McpConfig,
 * dropping Codex-specific fields (enabled, timeouts, tool filters).
 */
export function readMcpFromToml(content: string): McpConfig {
  if (!content.trim()) return {};

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }

  const mcpServers = parsed.mcp_servers as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!mcpServers || typeof mcpServers !== "object") return {};

  const result: McpConfig = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (typeof server !== "object" || !server) continue;

    const command = server.command;
    const url = server.url ?? server.serverUrl;

    // Must have either command (stdio) or url (remote)
    if (typeof command !== "string" && typeof url !== "string") continue;

    const entry: McpServerConfig = {};
    if (typeof command === "string") {
      entry.command = command;
      if (Array.isArray(server.args)) {
        entry.args = server.args.map(String);
      }
    }
    if (typeof url === "string") {
      if (server.url) entry.url = String(server.url);
      if (server.serverUrl) entry.serverUrl = String(server.serverUrl);
    }
    if (server.env && typeof server.env === "object" && !Array.isArray(server.env)) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env as Record<string, unknown>)) {
        env[k] = String(v);
      }
      entry.env = env;
    }
    result[name] = entry;
  }
  return result;
}

/** Escape special regex characters. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Quote a TOML key if it contains non-bare characters. */
function toTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** Quote a string value for TOML (JSON escaping is compatible). */
function toTomlString(s: string): string {
  return JSON.stringify(s);
}

/**
 * Find the line range of a [mcp_servers.NAME] section (including sub-tables).
 * Returns start (header line) and end (last content line + 1, excluding
 * trailing blank lines so inter-section spacing is preserved).
 */
function findSectionRange(
  lines: string[],
  serverName: string,
): { start: number; end: number } | null {
  const escaped = escapeRegex(serverName);
  const headerRe = new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${escaped}\\s*\\]\\s*(#.*)?$`,
  );
  const subTableRe = new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${escaped}\\.`,
  );
  const anyHeaderRe = /^\s*\[/;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Find next section header that isn't a sub-table of this server
  let nextHeader = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (anyHeaderRe.test(lines[i]!) && !subTableRe.test(lines[i]!)) {
      nextHeader = i;
      break;
    }
  }

  // Exclude trailing blank/comment lines so inter-section comments
  // (e.g. commented-out servers between active ones) are preserved
  let end = nextHeader;
  while (end > start + 1) {
    const line = lines[end - 1]!.trim();
    if (line === "" || line.startsWith("#")) {
      end--;
    } else {
      break;
    }
  }

  return { start, end };
}

/**
 * Generate a TOML section for an MCP server.
 */
function serverToTomlSection(
  name: string,
  server: McpServerConfig,
): string {
  const key = toTomlKey(name);
  const lines: string[] = [`[mcp_servers.${key}]`];
  if (server.command) lines.push(`command = ${toTomlString(server.command)}`);
  if (server.args && server.args.length > 0) {
    lines.push(`args = [${server.args.map(toTomlString).join(", ")}]`);
  }
  if (server.url) lines.push(`url = ${toTomlString(server.url)}`);
  if (server.serverUrl) lines.push(`serverUrl = ${toTomlString(server.serverUrl)}`);
  if (server.env && Object.keys(server.env).length > 0) {
    const pairs = Object.entries(server.env)
      .map(([k, v]) => `${toTomlKey(k)} = ${toTomlString(v)}`)
      .join(", ");
    lines.push(`env = { ${pairs} }`);
  }
  return lines.join("\n");
}

/**
 * Merge MCP servers into a config.toml string.
 * Surgically edits managed [mcp_servers.*] sections while preserving
 * comments, formatting, and non-managed content in the original file.
 */
export function writeMcpToToml(
  existingContent: string,
  servers: McpConfig,
): string {
  // Empty file — generate fresh
  if (!existingContent.trim()) {
    const sections = Object.entries(servers).map(([name, server]) =>
      serverToTomlSection(name, server),
    );
    return sections.join("\n\n") + "\n";
  }

  // Validate existing TOML is parseable (fail fast on corruption)
  try {
    parse(existingContent);
  } catch (err) {
    throw new Error(
      `Failed to parse existing config.toml: ${(err as Error).message}`,
    );
  }

  let lines = existingContent.split("\n");

  for (const [name, server] of Object.entries(servers)) {
    const range = findSectionRange(lines, name);
    const newLines = serverToTomlSection(name, server).split("\n");

    if (range) {
      // Replace existing section in-place
      lines.splice(range.start, range.end - range.start, ...newLines);
    } else {
      // Append new section at end with blank line separator
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
        lines.pop();
      }
      lines.push("", ...newLines);
    }
  }

  return lines.join("\n").replace(/\n*$/, "\n");
}

/**
 * Read Codex agent .toml files from a directory.
 * Maps TOML fields to the portable AgentEntry format:
 *   - name: from filename
 *   - description: first sentence of developer_instructions
 *   - model: from model field
 *   - developer_instructions: becomes body content
 *   - other fields: preserved via passthrough
 */
export async function readAgentsFromToml(
  agentsDir: string,
): Promise<AgentEntry[]> {
  const agentFiles = await fg("*.toml", {
    cwd: agentsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const agents: AgentEntry[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = parse(raw) as Record<string, unknown>;
    } catch {
      log.warn(`Skipping ${file}: invalid TOML`);
      continue;
    }

    const agentName = path.basename(file, ".toml");
    const instructions = typeof parsed.developer_instructions === "string"
      ? parsed.developer_instructions.trim()
      : "";

    // Build portable frontmatter from TOML fields
    const data: Record<string, unknown> = { ...parsed };
    delete data.developer_instructions;

    const withDefaults = inferAgentDefaults(data, agentName, instructions);
    const validation = agentFrontmatterSchema.safeParse(withDefaults);
    if (!validation.success) {
      const reasons = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      log.warn(`Skipping ${file}: invalid agent frontmatter (${reasons})`);
      continue;
    }

    // Build markdown content with frontmatter for portable round-trips
    const content = matter.stringify(instructions + "\n", validation.data);

    agents.push({
      name: agentName,
      path: `agents/${agentName}`,
      frontmatter: validation.data,
      content,
    });
  }
  return agents;
}

/**
 * Convert an AgentEntry (portable Markdown format) to Codex TOML format.
 * Inverse of readAgentsFromToml: frontmatter fields become TOML keys,
 * body content becomes developer_instructions multiline string.
 */
export function agentToCodexToml(agentContent: string): string {
  const parsed = matter(agentContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;
  const body = parsed.content.trim();

  const tomlObj: Record<string, unknown> = { ...fm };
  if (body) {
    tomlObj.developer_instructions = body;
  }

  return stringify(tomlObj) + "\n";
}
