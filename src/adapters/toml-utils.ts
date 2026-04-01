import { parse, stringify } from "smol-toml";
import type { McpConfig, McpServerConfig } from "../shared/schema.js";

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
    if (server.env && Object.keys(server.env).length > 0) {
      entry.env = server.env;
    }
    merged[name] = entry;
  }

  config.mcp_servers = merged;
  return stringify(config) + "\n";
}
