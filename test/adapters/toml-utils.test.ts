import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMcpFromToml, writeMcpToToml, readAgentsFromToml } from "../../src/adapters/toml-utils.js";
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

  it("reads HTTP MCP servers with url field", () => {
    const toml = `
[mcp_servers.exa]
url = "https://mcp.exa.ai/mcp"
`;
    const result = readMcpFromToml(toml);
    expect(result.exa).toBeDefined();
    expect(result.exa!.url).toBe("https://mcp.exa.ai/mcp");
    expect(result.exa!.command).toBeUndefined();
  });

  it("reads mixed stdio and HTTP servers", () => {
    const toml = `
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.exa]
url = "https://mcp.exa.ai/mcp"
`;
    const result = readMcpFromToml(toml);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.github!.command).toBe("npx");
    expect(result.exa!.url).toBe("https://mcp.exa.ai/mcp");
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

describe("readAgentsFromToml", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-toml-agents-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for nonexistent directory", async () => {
    const agents = await readAgentsFromToml("/tmp/nonexistent-" + Date.now());
    expect(agents).toEqual([]);
  });

  it("skips invalid TOML files", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(path.join(tmpDir, "bad.toml"), "this is not = valid [toml");
    const agents = await readAgentsFromToml(tmpDir);
    expect(agents).toEqual([]);
  });

  it("skips agent with no developer_instructions and no description (validation fails)", async () => {
    await writeFile(
      path.join(tmpDir, "minimal.toml"),
      'model = "gpt-5.4"\nsandbox_mode = "read-only"\n',
    );
    // No developer_instructions means no body to infer description from — Zod rejects
    const agents = await readAgentsFromToml(tmpDir);
    expect(agents).toEqual([]);
  });

  it("accepts agent with explicit description but no developer_instructions", async () => {
    await writeFile(
      path.join(tmpDir, "helper.toml"),
      'model = "gpt-5.4"\ndescription = "A helpful assistant"\n',
    );
    const agents = await readAgentsFromToml(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("helper");
    expect(agents[0].frontmatter.description).toBe("A helpful assistant");
  });

  it("infers name from filename and description from instructions", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      path.join(tmpDir, "docs-researcher.toml"),
      'model = "gpt-5.4"\n\ndeveloper_instructions = """\nVerify APIs against primary documentation.\nCite exact docs.\n"""\n',
    );
    const agents = await readAgentsFromToml(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("docs-researcher");
    expect(agents[0].frontmatter.description).toContain("Verify APIs");
    expect(agents[0].content).toContain("Verify APIs");
  });

  it("preserves passthrough fields like sandbox_mode", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      path.join(tmpDir, "reviewer.toml"),
      'model = "gpt-5.4"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\n\ndeveloper_instructions = """\nReview code.\n"""\n',
    );
    const agents = await readAgentsFromToml(tmpDir);
    const fm = agents[0].frontmatter as Record<string, unknown>;
    expect(fm.model_reasoning_effort).toBe("high");
    expect(fm.sandbox_mode).toBe("read-only");
  });
});
