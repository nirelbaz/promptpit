import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import { SAFE_MATTER_OPTIONS, parseJsonc, readCommandsFromDir, detectCommandParamSyntax } from "./adapter-utils.js";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
  DryRunEntry,
} from "./types.js";
import type { StackBundle, RuleEntry, RuleFrontmatter } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readAgentsFromDir, readMcpFromSettings, writeWithMarkers, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, fileDryRunEntry, resolveRuleDest } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, ".github", "copilot-instructions.md"),
    skills: path.join(root, ".github", "instructions"),
    mcp: path.join(root, ".vscode", "mcp.json"),
    rules: path.join(root, ".github", "instructions"),
    agents: path.join(root, ".github", "agents"),
    prompts: path.join(root, ".github", "prompts"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".github", "copilot-instructions.md"),
    skills: path.join(home, ".github", "instructions"),
    mcp: path.join(home, ".vscode", "mcp.json"),
    rules: path.join(home, ".github", "instructions"),
    agents: path.join(home, ".github", "agents"),
    prompts: path.join(home, ".github", "prompts"),
  };
}

// Translate SKILL.md content to Copilot .instructions.md format
export function skillToInstructionsMd(skillContent: string): string {
  const parsed = matter(skillContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  // Map skill context/globs to Copilot's applyTo field
  let applyTo = "**";
  if (fm.context) {
    applyTo = Array.isArray(fm.context) ? fm.context.join(", ") : String(fm.context);
  }

  return `---\napplyTo: "${applyTo}"\n---\n\n${parsed.content.trim()}\n`;
}

// Preserve most agent frontmatter for Copilot — model is supported in IDE context
// (VS Code, JetBrains, Eclipse, Xcode) but stripped by cloud Coding Agent
export function agentToGitHubAgent(agentContent: string): string {
  const parsed = matter(agentContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  const copilotFm: Record<string, unknown> = {};
  if (fm.name) copilotFm.name = fm.name;
  if (fm.description) copilotFm.description = fm.description;
  if (fm.tools) copilotFm.tools = fm.tools;
  if (fm.model) copilotFm.model = fm.model;

  const yamlStr = yaml.dump(copilotFm, { schema: yaml.JSON_SCHEMA }).trim();

  return `---\n${yamlStr}\n---\n\n${parsed.content.trim()}\n`;
}

// Translate portable rule format to Copilot .instructions.md format (globs → applyTo)
export function ruleToInstructionsMd(ruleContent: string): string {
  const parsed = matter(ruleContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  let applyTo = "**";
  if (fm.alwaysApply) {
    applyTo = "**";
  } else if (fm.globs) {
    applyTo = Array.isArray(fm.globs) ? fm.globs.join(", ") : String(fm.globs);
  }

  return matter.stringify(parsed.content.trim() + "\n", { applyTo });
}

// Translate Copilot .prompt.md back to portable format
// Strip Copilot-specific frontmatter fields (model, tools, agent), keep description
export function promptMdToCommand(promptContent: string): string {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(promptContent, SAFE_MATTER_OPTIONS as never);
  } catch {
    return promptContent;
  }

  if (Object.keys(parsed.data).length === 0) {
    return promptContent;
  }

  const portableFm: Record<string, unknown> = {};
  const fm = parsed.data as Record<string, unknown>;
  if (fm.description) portableFm.description = fm.description;

  if (Object.keys(portableFm).length === 0) {
    return parsed.content.trim();
  }

  return matter.stringify(parsed.content.trim() + "\n", portableFm);
}

// Infer MCP server type from config shape
function inferServerType(
  server: Record<string, unknown>,
): "stdio" | "http" {
  if (server.url || server.serverUrl) return "http";
  return "stdio";
}

// Translate mcpServers format to Copilot's servers format
// Copilot uses root key "servers" and requires a "type" field per entry
function translateMcpServers(
  mcpServers: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    servers[name] = {
      type: inferServerType(config),
      ...config,
    };
  }
  return servers;
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.skills)) found.push(p.skills);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const mcpServers = await readMcpFromSettings(p.mcp, "servers");
  // Read both *.agent.md and plain *.md — real-world repos use both formats
  const agents = await readAgentsFromDir(p.agents!, { glob: "*.md", ext: ".agent.md" });

  // Read scoped instructions as rules
  const rules: RuleEntry[] = [];
  if (await exists(p.rules)) {
    const instructionFiles = await fg("**/*.instructions.md", {
      cwd: p.rules,
      absolute: true,
    });
    for (const file of instructionFiles) {
      const raw = await readFileOrNull(file);
      if (!raw) continue;
      // Use default parser — local Copilot config files, not untrusted input
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(raw);
      } catch {
        continue;
      }
      // Include subdirectory in name to avoid collisions (e.g., review-guide/frontend → review-guide-frontend)
      const relPath = path.relative(p.rules, file);
      const ruleName = relPath.replace(/\.instructions\.md$/, "").replace(/[/\\]/g, "-");
      const fm = parsed.data as Record<string, unknown>;
      const portableFm: RuleFrontmatter = {
        name: ruleName,
        description: typeof fm.description === "string" ? fm.description : ruleName,
      };
      if (fm.applyTo) {
        portableFm.globs = typeof fm.applyTo === "string" ? [fm.applyTo] : fm.applyTo as string[];
      }
      // Rebuild content with portable frontmatter so downstream adapters
      // see globs (not applyTo) when translating rule.content
      const portableContent = matter.stringify(parsed.content.trim() + "\n", portableFm);
      rules.push({
        name: ruleName,
        path: `rules/${ruleName}`,
        frontmatter: portableFm,
        content: portableContent,
      });
    }
  }

  const rawCommands = await readCommandsFromDir(
    p.prompts!,
    { glob: "**/*.prompt.md", ext: ".prompt.md" },
  );
  const commands = rawCommands.map((cmd) => ({
    ...cmd,
    content: promptMdToCommand(cmd.content),
  }));

  return {
    adapterId: "copilot",
    agentInstructions,
    skills: [],
    agents,
    mcpServers,
    rules,
    commands,
  };
}

async function write(
  root: string,
  stack: StackBundle,
  opts: WriteOptions,
): Promise<WriteResult> {
  const p = opts.global ? userPaths() : projectPaths(root);
  const filesWritten: string[] = [];
  const warnings: string[] = [];
  const dryRunEntries: DryRunEntry[] = [];
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    // Write instructions to .github/copilot-instructions.md
    if (stack.agentInstructions) {
      const result = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "copilot",
        opts.dryRun,
      );
      if (result.written) filesWritten.push(result.written);
      if (opts.dryRun) {
        dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
      }
    }

    // Install skills as .github/instructions/*.instructions.md (translate-copy)
    for (const skill of stack.skills) {
      const instructionContent = skillToInstructionsMd(skill.content);
      const dest = path.join(p.skills, `${skill.name}.instructions.md`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .instructions.md"));
      } else {
        await writeFileEnsureDir(dest, instructionContent);
        filesWritten.push(dest);
      }
    }

    // Write agents to .github/agents/*.agent.md
    for (const agent of stack.agents) {
      const translated = agentToGitHubAgent(agent.content);
      const dest = path.join(p.agents!, `${agent.name}.agent.md`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .agent.md"));
      } else {
        await writeFileEnsureDir(dest, translated);
        filesWritten.push(dest);
      }
    }

    // Write rules to .github/instructions/*.instructions.md
    for (const rule of stack.rules) {
      const dest = await resolveRuleDest(p.rules!, rule.name, ".instructions.md");
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .instructions.md"));
      } else {
        const instructionContent = ruleToInstructionsMd(rule.content);
        await writeFileEnsureDir(dest, instructionContent);
        filesWritten.push(dest);
      }
    }

    // Write commands to .github/prompts/*.prompt.md
    for (const command of stack.commands) {
      const dest = path.join(p.prompts!, `${command.name}.prompt.md`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .prompt.md"));
      } else {
        await writeFileEnsureDir(dest, command.content);
        filesWritten.push(dest);
      }
      const syntax = detectCommandParamSyntax(command.content);
      if (syntax && syntax !== "copilot") {
        warnings.push(
          `Command "${command.name}" uses ${syntax} param syntax — may need manual adjustment for GitHub Copilot`,
        );
      }
    }

    // Write MCP config to .vscode/mcp.json (root key: "servers", type field required)
    if (Object.keys(stack.mcpServers).length > 0) {
      const existingRaw = await readFileOrNull(p.mcp);
      let config: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          config = parseJsonc(existingRaw) as Record<string, unknown>;
        } catch {
          warnings.push(`Could not parse existing ${p.mcp}, creating new`);
        }
      }
      const mcpExisted = existingRaw != null;
      config.servers = {
        ...((config.servers as Record<string, unknown>) ?? {}),
        ...translateMcpServers(stack.mcpServers as Record<string, Record<string, unknown>>),
      };
      const newContent = JSON.stringify(config, null, 2);
      const mcpCount = Object.keys(stack.mcpServers).length;

      if (opts.dryRun) {
        dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, {
          written: null, existed: mcpExisted,
          oldContent: existingRaw ?? undefined, newContent,
        }, opts.verbose));
      } else {
        await writeFileEnsureDir(p.mcp, newContent);
        filesWritten.push(p.mcp);
      }
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "Copilot paths");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}

export const copilotAdapter: PlatformAdapter = {
  id: "copilot",
  displayName: "GitHub Copilot",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "translate-copy",
    rules: true,
    skillFormat: "md",
    mcpStdio: true,
    mcpRemote: true,
    mcpFormat: "json",
    mcpRootKey: "servers",
    agentsmd: true,
    hooks: false,
    agents: "native",
    commands: true,
  },
  detect,
  read,
  write,
};
