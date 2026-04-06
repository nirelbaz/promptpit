import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, lstat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { codexAdapter } from "../../src/adapters/codex.js";
import { readStack } from "../../src/core/stack.js";

const VALID_STACK = path.resolve("test/__fixtures__/stacks/valid-stack");

describe("Codex CLI adapter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-codex-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("detect", () => {
    it("detects when .codex/ directory and AGENTS.md exist", async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(path.join(tmpDir, "AGENTS.md"), "# Instructions");
      const result = await codexAdapter.detect(tmpDir);
      expect(result.detected).toBe(true);
    });

    it("detects when .codex/ directory exists with config", async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(path.join(tmpDir, ".codex", "config.toml"), "");
      const result = await codexAdapter.detect(tmpDir);
      expect(result.detected).toBe(true);
    });

    it("does not detect AGENTS.md alone without .codex/ directory", async () => {
      await writeFile(path.join(tmpDir, "AGENTS.md"), "# Instructions");
      const result = await codexAdapter.detect(tmpDir);
      expect(result.detected).toBe(false);
    });

    it("returns false for empty project", async () => {
      const result = await codexAdapter.detect(tmpDir);
      expect(result.detected).toBe(false);
    });
  });

  describe("read", () => {
    it("reads instructions from AGENTS.md", async () => {
      await writeFile(path.join(tmpDir, "AGENTS.md"), "# My Instructions");
      const config = await codexAdapter.read(tmpDir);
      expect(config.adapterId).toBe("codex");
      expect(config.agentInstructions).toBe("# My Instructions");
    });

    it("reads skills from .codex/skills/", async () => {
      const skillDir = path.join(tmpDir, ".codex", "skills", "my-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
      );
      const config = await codexAdapter.read(tmpDir);
      expect(config.skills).toHaveLength(1);
      expect(config.skills[0].name).toBe("my-skill");
    });

    it("reads MCP servers from .codex/config.toml", async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".codex", "config.toml"),
        '[mcp_servers.github]\ncommand = "npx"\nargs = ["-y", "server-github"]\n',
      );
      const config = await codexAdapter.read(tmpDir);
      expect(config.mcpServers).toEqual({
        github: { command: "npx", args: ["-y", "server-github"] },
      });
    });

    it("returns empty config for unconfigured project", async () => {
      const config = await codexAdapter.read(tmpDir);
      expect(config.agentInstructions).toBe("");
      expect(config.skills).toEqual([]);
      expect(config.mcpServers).toEqual({});
    });
  });

  describe("write", () => {
    it("writes instructions to AGENTS.md with markers", async () => {
      const bundle = await readStack(VALID_STACK);
      await codexAdapter.write(tmpDir, bundle, {});
      const content = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("promptpit:start:test-stack");
      expect(content).toContain("promptpit:end:test-stack");
    });

    it("symlinks skills from canonical path", async () => {
      const canonDir = path.join(tmpDir, ".agents", "skills", "browse");
      await mkdir(canonDir, { recursive: true });
      await writeFile(path.join(canonDir, "SKILL.md"), "---\nname: browse\ndescription: Browse\n---\n# Browse");
      const canonicalSkillPaths = new Map([["browse", path.join(canonDir, "SKILL.md")]]);

      const bundle = await readStack(VALID_STACK);
      const result = await codexAdapter.write(tmpDir, bundle, { canonicalSkillPaths });

      const skillDest = path.join(tmpDir, ".codex", "skills", "browse", "SKILL.md");
      expect(result.filesWritten).toContain(skillDest);

      if (process.platform !== "win32") {
        const stat = await lstat(skillDest);
        expect(stat.isSymbolicLink()).toBe(true);
      }
    });

    it("writes MCP servers to .codex/config.toml", async () => {
      const bundle = await readStack(VALID_STACK);
      await codexAdapter.write(tmpDir, bundle, {});
      const tomlPath = path.join(tmpDir, ".codex", "config.toml");
      const content = await readFile(tomlPath, "utf-8");
      expect(content).toContain("[mcp_servers.postgres]");
      expect(content).toContain('command = "npx"');
    });

    it("preserves existing config.toml content when merging MCP", async () => {
      await mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".codex", "config.toml"),
        'model = "o4-mini"\napproval_policy = "on-request"\n\n[mcp_servers.existing]\ncommand = "node"\nargs = ["old.js"]\n',
      );
      const bundle = await readStack(VALID_STACK);
      await codexAdapter.write(tmpDir, bundle, {});
      const content = await readFile(path.join(tmpDir, ".codex", "config.toml"), "utf-8");
      expect(content).toContain("o4-mini");
      expect(content).toContain("[mcp_servers.existing]");
      expect(content).toContain("[mcp_servers.postgres]");
    });

    it("respects dryRun option", async () => {
      const bundle = await readStack(VALID_STACK);
      const result = await codexAdapter.write(tmpDir, bundle, { dryRun: true });
      expect(result.filesWritten).toEqual([]);
      // Verify no files were created on disk
      const agentsMd = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8").catch(() => null);
      const configToml = await readFile(path.join(tmpDir, ".codex", "config.toml"), "utf-8").catch(() => null);
      expect(agentsMd).toBeNull();
      expect(configToml).toBeNull();
    });
  });

  describe("inline agent writing", () => {
    it("includes agents in marker block when writing instructions", async () => {
      const bundle = await readStack(VALID_STACK);
      await writeFile(path.join(tmpDir, "AGENTS.md"), "");
      await codexAdapter.write(tmpDir, bundle, {});
      const content = await readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("## Custom Agents");
      expect(content).toContain("### reviewer");
      expect(content).toContain("security-focused code reviewer");
    });

    it("does not include agents section when bundle has no agents", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "pit-codex-"));
      await writeFile(
        path.join(dir, "stack.json"),
        JSON.stringify({ name: "no-agents", version: "1.0.0" }),
      );
      await writeFile(
        path.join(dir, "agent.promptpit.md"),
        "---\nname: no-agents\n---\n\nTest instructions.\n",
      );
      const bundle = await readStack(dir);
      const target = await mkdtemp(path.join(tmpdir(), "pit-codex-target-"));
      await writeFile(path.join(target, "AGENTS.md"), "");
      await codexAdapter.write(target, bundle, {});
      const content = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("## Custom Agents");
      await rm(dir, { recursive: true });
      await rm(target, { recursive: true });
    });

    it("writes agents section when agentInstructions is empty but agents exist (else branch)", async () => {
      // This exercises the buildInlineContent else branch:
      // agentInstructions is "" → content starts "" → replaced by agentSection alone
      const target = await mkdtemp(path.join(tmpdir(), "pit-codex-agents-only-"));
      const bundle = {
        manifest: { name: "agents-only", version: "1.0.0", skills: [], compatibility: [] },
        agentInstructions: "",
        skills: [],
        agents: [
          {
            name: "helper",
            path: "agents/helper",
            frontmatter: { name: "helper", description: "General helper" },
            content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
          },
        ],
        rules: [],
        mcpServers: {},
        envExample: {},
      };
      await codexAdapter.write(target, bundle, {});
      const content = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(content).toContain("## Custom Agents");
      expect(content).toContain("### helper");
      expect(content).toContain("Help with tasks.");
      await rm(target, { recursive: true });
    });
  });

  describe("capabilities", () => {
    it("uses symlink strategy for skills", () => {
      expect(codexAdapter.capabilities.skillLinkStrategy).toBe("symlink");
    });

    it("uses skill.md format", () => {
      expect(codexAdapter.capabilities.skillFormat).toBe("skill.md");
    });

    it("supports MCP stdio", () => {
      expect(codexAdapter.capabilities.mcpStdio).toBe(true);
    });
  });

  describe("paths", () => {
    it("returns correct project paths", () => {
      const p = codexAdapter.paths.project("/test");
      expect(p.config).toBe("/test/AGENTS.md");
      expect(p.skills).toBe("/test/.codex/skills");
      expect(p.mcp).toBe("/test/.codex/config.toml");
    });

    it("returns correct user paths", () => {
      const p = codexAdapter.paths.user();
      const home = homedir();
      expect(p.config).toBe(path.join(home, ".codex", "AGENTS.md"));
      expect(p.skills).toBe(path.join(home, ".codex", "skills"));
      expect(p.mcp).toBe(path.join(home, ".codex", "config.toml"));
    });
  });
});
