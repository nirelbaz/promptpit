import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import { parse, stringify } from "smol-toml";
import type { McpConfig, McpServerConfig, AgentEntry } from "../shared/schema.js";
import { readFileOrNull } from "../shared/utils.js";
import { inferAgentDefaults } from "./adapter-utils.js";
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
    if (typeof command !== "string") continue;

    const entry: McpServerConfig = { command };
    if (Array.isArray(server.args)) {
      entry.args = server.args.map(String);
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

/**
 * Merge MCP servers into a config.toml string.
 * Preserves all existing config sections. Merges new servers into
 * the mcp_servers section (existing servers are preserved, new ones added).
 */
export function writeMcpToToml(
  existingContent: string,
  servers: McpConfig,
): string {
  let config: Record<string, unknown> = {};
  if (existingContent.trim()) {
    try {
      config = parse(existingContent) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to parse existing config.toml: ${(err as Error).message}`,
      );
    }
  }

  const existing =
    (config.mcp_servers as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = { ...existing };

  for (const [name, server] of Object.entries(servers)) {
    const entry: Record<string, unknown> = { command: server.command };
    if (server.args) entry.args = server.args;
    if (server.env) entry.env = server.env;
    merged[name] = entry;
  }

  config.mcp_servers = merged;
  return stringify(config) + "\n";
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
