import { describe, it, expect } from "vitest";
import { readMcpFromToml, writeMcpToToml } from "../../src/adapters/toml-utils.js";
import type { McpConfig } from "../../src/shared/schema.js";

describe("readMcpFromToml", () => {
  it("parses MCP servers from config.toml content", () => {
    const toml = `
model = "o4-mini"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path"]

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_test" }
`;
    const result = readMcpFromToml(toml);
    expect(result).toEqual({
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      },
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_test" },
      },
    });
  });

  it("returns empty object when no mcp_servers section", () => {
    const toml = `model = "o4-mini"\napproval_policy = "on-request"\n`;
    expect(readMcpFromToml(toml)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(readMcpFromToml("")).toEqual({});
  });

  it("returns empty object for malformed TOML", () => {
    expect(readMcpFromToml("[broken\nkey = ")).toEqual({});
  });

  it("drops codex-specific fields not in McpConfig schema", () => {
    const toml = `
[mcp_servers.fs]
command = "npx"
args = ["-y", "server-fs"]
enabled = true
startup_timeout_sec = 30.0
tool_timeout_sec = 60.0
enabled_tools = ["read_file"]
`;
    const result = readMcpFromToml(toml);
    expect(result).toEqual({
      fs: {
        command: "npx",
        args: ["-y", "server-fs"],
      },
    });
    expect((result as Record<string, unknown>).fs).not.toHaveProperty("enabled");
    expect((result as Record<string, unknown>).fs).not.toHaveProperty("startup_timeout_sec");
  });
});

describe("writeMcpToToml", () => {
  it("merges MCP servers into existing config.toml content", () => {
    const existing = `model = "o4-mini"\napproval_policy = "on-request"\n`;
    const servers: McpConfig = {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      },
    };
    const result = writeMcpToToml(existing, servers);
    expect(result).toContain('model = "o4-mini"');
    expect(result).toContain("[mcp_servers.filesystem]");
    expect(result).toContain('command = "npx"');
  });

  it("preserves existing MCP servers when merging new ones", () => {
    const existing = `
[mcp_servers.existing]
command = "node"
args = ["server.js"]
`;
    const servers: McpConfig = {
      newserver: {
        command: "npx",
        args: ["-y", "new-server"],
      },
    };
    const result = writeMcpToToml(existing, servers);
    expect(result).toContain("[mcp_servers.existing]");
    expect(result).toContain("[mcp_servers.newserver]");
  });

  it("writes env as inline table", () => {
    const servers: McpConfig = {
      github: {
        command: "npx",
        args: ["-y", "server-github"],
        env: { GITHUB_TOKEN: "tok_123" },
      },
    };
    const result = writeMcpToToml("", servers);
    expect(result).toContain("[mcp_servers.github]");
    expect(result).toContain('command = "npx"');
    expect(result).toContain("GITHUB_TOKEN");
  });

  it("throws on malformed existing TOML", () => {
    const servers: McpConfig = { fs: { command: "npx" } };
    expect(() => writeMcpToToml("[broken\nkey = ", servers)).toThrow(
      "Failed to parse existing config.toml",
    );
  });

  it("overwrites existing server with same name", () => {
    const existing = `[mcp_servers.gh]\ncommand = "old"\nargs = ["old.js"]\n`;
    const servers: McpConfig = { gh: { command: "new", args: ["new.js"] } };
    const result = writeMcpToToml(existing, servers);
    expect(result).toContain('command = "new"');
    expect(result).not.toContain('command = "old"');
  });

  it("round-trips: read then write produces parseable TOML", () => {
    const original = `[mcp_servers.gh]\ncommand = "npx"\nargs = ["-y", "server-gh"]\n`;
    const parsed = readMcpFromToml(original);
    const written = writeMcpToToml("", parsed);
    const reparsed = readMcpFromToml(written);
    expect(reparsed).toEqual(parsed);
  });

  it("creates new config when existing is empty", () => {
    const servers: McpConfig = {
      fs: { command: "npx", args: ["server-fs"] },
    };
    const result = writeMcpToToml("", servers);
    expect(result).toContain("[mcp_servers.fs]");
    expect(result).toContain('command = "npx"');
  });
});
