import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectStack } from "../../src/commands/collect.js";

describe("collect: standards fallback logic", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-collect-agents-"));
    outputDir = path.join(tmpDir, ".promptpit");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads AGENTS.md when it is the only adapter detected", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Instructions\n\nUse strict mode.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("Use strict mode.");
  });

  it("keeps both adapters when content differs (dedup by hash)", async () => {
    await writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# AGENTS instructions\n\nFrom AGENTS.md.\n",
    );
    await writeFile(
      path.join(tmpDir, "CLAUDE.md"),
      "# CLAUDE instructions\n\nFrom CLAUDE.md.\n",
    );

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    expect(agentMd).toContain("From CLAUDE.md.");
    expect(agentMd).toContain("From AGENTS.md.");
  });

  it("deduplicates identical instructions from multiple adapters", async () => {
    const sharedContent = "# Shared instructions\n\nUse strict mode.\n";
    await writeFile(path.join(tmpDir, "AGENTS.md"), sharedContent);
    await writeFile(path.join(tmpDir, "CLAUDE.md"), sharedContent);

    await collectStack(tmpDir, outputDir);

    const agentMd = await readFile(
      path.join(outputDir, "agent.promptpit.md"),
      "utf-8",
    );
    // Content appears once (deduped), not twice
    const matches = agentMd.match(/Use strict mode\./g) || [];
    expect(matches.length).toBe(1);
  });

  it("preserves Standards MCP servers not present in other adapters", async () => {
    // Standards has an HTTP server (exa) that Codex TOML can't represent
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
    await writeFile(
      path.join(tmpDir, ".codex", "config.toml"),
      '[mcp_servers.github]\ncommand = "npx"\nargs = ["-y", "@modelcontextprotocol/server-github"]\n',
    );
    await writeFile(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"] },
          exa: { url: "https://mcp.exa.ai/mcp" },
        },
      }),
    );
    await writeFile(path.join(tmpDir, "AGENTS.md"), "# Instructions");

    await collectStack(tmpDir, outputDir);

    const mcpRaw = await readFile(path.join(outputDir, "mcp.json"), "utf-8");
    const mcp = JSON.parse(mcpRaw);
    // exa (Standards-only HTTP server) should be preserved
    expect(mcp.exa).toBeDefined();
    expect(mcp.exa.url).toBe("https://mcp.exa.ai/mcp");
    // github should have the pinned version from Standards (not the unpinned Codex one)
    expect(mcp.github.args[1]).toContain("@2025.4.8");
  });

  it("suppresses MCP overwrite warnings on idempotent re-install", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { installStack } = await import("../../src/commands/install.js");
    // Create a project with CLAUDE.md and a stack with MCP
    await writeFile(path.join(tmpDir, "CLAUDE.md"), "");
    const stackDir = await mkdtemp(path.join(tmpdir(), "pit-stack-mcp-"));
    await writeFile(path.join(stackDir, "stack.json"), JSON.stringify({
      name: "mcp-test", version: "1.0.0",
    }));
    await writeFile(path.join(stackDir, "mcp.json"), JSON.stringify({
      postgres: { command: "npx", args: ["-y", "server-pg"] },
    }));

    // First install
    await installStack(stackDir, tmpDir, {});
    // Second install — should produce no warnings
    const consoleSpy = (await import("vitest")).vi.spyOn(console, "warn").mockImplementation(() => {});
    await installStack(stackDir, tmpDir, {});
    const warnings = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    consoleSpy.mockRestore();
    expect(warnings).not.toContain("overwriting");
    await rm(stackDir, { recursive: true });
  });
});
