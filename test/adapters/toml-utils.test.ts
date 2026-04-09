import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMcpFromToml, writeMcpToToml, readAgentsFromToml } from "../../src/adapters/toml-utils.js";
import { computeMcpServerHash } from "../../src/core/manifest.js";
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

  it("writes HTTP MCP servers with url field", () => {
    const servers: McpConfig = {
      exa: { url: "https://mcp.exa.ai/mcp" },
    };
    const result = writeMcpToToml("", servers);
    expect(result).toContain("[mcp_servers.exa]");
    expect(result).toContain('url = "https://mcp.exa.ai/mcp"');
    expect(result).not.toContain("command");
  });

  it("writes HTTP MCP servers with serverUrl field", () => {
    const servers: McpConfig = {
      remote: { serverUrl: "https://api.example.com/mcp" },
    };
    const result = writeMcpToToml("", servers);
    expect(result).toContain("[mcp_servers.remote]");
    expect(result).toContain('serverUrl = "https://api.example.com/mcp"');
  });

  it("round-trips HTTP MCP servers through read/write", () => {
    const servers: McpConfig = {
      exa: { url: "https://mcp.exa.ai/mcp" },
      github: { command: "npx", args: ["-y", "server-github"] },
    };
    const written = writeMcpToToml("", servers);
    const reparsed = readMcpFromToml(written);
    expect(reparsed.exa).toEqual({ url: "https://mcp.exa.ai/mcp" });
    expect(reparsed.github).toEqual({ command: "npx", args: ["-y", "server-github"] });
  });

  it("preserves comments in existing config.toml", () => {
    const existing = `# My Codex configuration
model = "o4-mini"
model_reasoning_effort = "medium"

# MCP servers
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/home/me"]
`;
    const servers: McpConfig = {
      github: { command: "npx", args: ["-y", "server-github"] },
    };
    const result = writeMcpToToml(existing, servers);
    expect(result).toContain("# My Codex configuration");
    expect(result).toContain("# MCP servers");
    expect(result).toContain("[mcp_servers.filesystem]");
    expect(result).toContain("[mcp_servers.github]");
  });

  it("preserves non-MCP config sections unchanged", () => {
    const existing = `model = "o4-mini"
approval_policy = "on-request"

[mcp_servers.old]
command = "node"
args = ["old.js"]
`;
    const servers: McpConfig = {
      newserver: { command: "npx", args: ["new.js"] },
    };
    const result = writeMcpToToml(existing, servers);
    // Non-MCP lines preserved verbatim
    expect(result).toContain('model = "o4-mini"');
    expect(result).toContain('approval_policy = "on-request"');
    // Old server section preserved
    expect(result).toContain("[mcp_servers.old]");
    expect(result).toContain('command = "node"');
  });

  it("updates a server without affecting sibling sections", () => {
    const existing = `[mcp_servers.alpha]
command = "npx"
args = ["alpha"]

[mcp_servers.beta]
command = "node"
args = ["beta.js"]
`;
    const servers: McpConfig = {
      alpha: { command: "npx", args: ["alpha-v2"] },
    };
    const result = writeMcpToToml(existing, servers);
    // Alpha updated
    expect(result).toContain('args = ["alpha-v2"]');
    expect(result).not.toContain('args = ["alpha"]');
    // Beta untouched
    expect(result).toContain("[mcp_servers.beta]");
    expect(result).toContain('command = "node"');
    expect(result).toContain('args = ["beta.js"]');
  });

  it("preserves Codex-specific fields in unmanaged servers", () => {
    const existing = `[mcp_servers.fs]
command = "npx"
args = ["-y", "server-fs"]
enabled = true
startup_timeout_sec = 30.0
tool_timeout_sec = 60.0

[mcp_servers.managed]
command = "old"
`;
    const servers: McpConfig = {
      managed: { command: "new", args: ["new.js"] },
    };
    const result = writeMcpToToml(existing, servers);
    // Unmanaged server's Codex-specific fields preserved
    expect(result).toContain("enabled = true");
    expect(result).toContain("startup_timeout_sec = 30.0");
    // Managed server updated
    expect(result).toContain('command = "new"');
    expect(result).not.toContain('command = "old"');
  });

  it("preserves inline comments on section headers", () => {
    const existing = `[mcp_servers.fs] # file system server
command = "npx"
args = ["-y", "server-fs"]
`;
    const servers: McpConfig = {
      other: { command: "node", args: ["other.js"] },
    };
    const result = writeMcpToToml(existing, servers);
    expect(result).toContain("[mcp_servers.fs] # file system server");
  });

  it("BUG-23 end-to-end: hash stability through write→read round-trip", () => {
    const existing = `# My Codex configuration
model = "o4-mini"
model_reasoning_effort = "medium"

# MCP servers
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/home/me"]
env = { ROOT_PATH = "/home/me" }
`;
    const bundleServers: McpConfig = {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_test" },
      },
    };

    // Install writes to TOML
    const written = writeMcpToToml(existing, bundleServers);
    // Status reads back from TOML
    const readBack = readMcpFromToml(written);

    // Hash at install time (from bundle) must match hash at status time (from disk)
    const installHash = computeMcpServerHash(bundleServers.github!);
    const statusHash = computeMcpServerHash(readBack.github!);
    expect(statusHash).toBe(installHash);
  });

  it("updates multiple servers in one call (mix of existing and new)", () => {
    const existing = `[mcp_servers.alpha]
command = "npx"
args = ["alpha"]

[mcp_servers.beta]
command = "node"
args = ["beta.js"]

[mcp_servers.gamma]
command = "python"
args = ["gamma.py"]
`;
    const servers: McpConfig = {
      alpha: { command: "npx", args: ["alpha-v2"] },
      gamma: { command: "python3", args: ["gamma-v2.py"] },
      delta: { command: "deno", args: ["delta.ts"] },
    };
    const result = writeMcpToToml(existing, servers);

    // Alpha updated
    expect(result).toContain('args = ["alpha-v2"]');
    expect(result).not.toContain('args = ["alpha"]');
    // Beta untouched
    expect(result).toContain("[mcp_servers.beta]");
    expect(result).toContain('args = ["beta.js"]');
    // Gamma updated
    expect(result).toContain('command = "python3"');
    expect(result).toContain('args = ["gamma-v2.py"]');
    expect(result).not.toContain('args = ["gamma.py"]');
    // Delta added
    expect(result).toContain("[mcp_servers.delta]");
    expect(result).toContain('command = "deno"');

    // Verify all four parse correctly
    const parsed = readMcpFromToml(result);
    expect(Object.keys(parsed)).toHaveLength(4);
    expect(parsed.alpha!.args).toEqual(["alpha-v2"]);
    expect(parsed.beta!.args).toEqual(["beta.js"]);
    expect(parsed.gamma!.args).toEqual(["gamma-v2.py"]);
    expect(parsed.delta!.args).toEqual(["delta.ts"]);
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
