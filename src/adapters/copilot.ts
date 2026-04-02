import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import yaml from "js-yaml";
import { SAFE_MATTER_OPTIONS } from "./adapter-utils.js";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
  DryRunEntry,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { agentFrontmatterSchema } from "../shared/schema.js";
import type { AgentEntry } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readMcpFromSettings, writeWithMarkers, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, skillDryRunEntry } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, ".github", "copilot-instructions.md"),
    skills: path.join(root, ".github", "instructions"),
    mcp: path.join(root, ".vscode", "mcp.json"),
    rules: path.join(root, ".github", "instructions"),
    agents: path.join(root, ".github", "agents"),
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

// Translate portable agent to Copilot .agent.md format
// Copilot agents use: name, description, tools (no model field)
export function agentToGitHubAgent(agentContent: string): string {
  const parsed = matter(agentContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  const copilotFm: Record<string, unknown> = {};
  if (fm.name) copilotFm.name = fm.name;
  if (fm.description) copilotFm.description = fm.description;
  if (fm.tools) copilotFm.tools = fm.tools;
  // model is dropped — Copilot doesn't support per-agent model selection

  const yamlStr = yaml.dump(copilotFm, { schema: yaml.JSON_SCHEMA }).trim();

  return `---\n${yamlStr}\n---\n\n${parsed.content.trim()}\n`;
}

async function readCopilotAgents(agentsDir: string): Promise<AgentEntry[]> {
  const agentFiles = await fg("*.agent.md", {
    cwd: agentsDir,
    absolute: true,
  }).catch(() => [] as string[]);

  const agents: AgentEntry[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrNull(file);
    if (!raw) continue;

    const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
    const validation = agentFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) continue;

    const agentName = path.basename(file, ".agent.md");
    agents.push({
      name: agentName,
      path: `agents/${agentName}`,
      frontmatter: validation.data,
      content: raw,
    });
  }
  return agents;
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
  const agents = await readCopilotAgents(p.agents!);

  // Read scoped instructions as rules
  const rules: string[] = [];
  if (await exists(p.rules)) {
    const instructionFiles = await fg("*.instructions.md", {
      cwd: p.rules,
      absolute: true,
    });
    for (const file of instructionFiles) {
      const content = await readFileOrNull(file);
      if (content) rules.push(content);
    }
  }

  return {
    adapterId: "copilot",
    agentInstructions,
    skills: [],
    agents,
    mcpServers,
    rules,
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
        dryRunEntries.push(skillDryRunEntry(dest, await exists(dest), "translate to .instructions.md"));
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
        dryRunEntries.push({
          file: dest,
          action: (await exists(dest)) ? "modify" : "create",
          detail: "translate to .agent.md",
        });
      } else {
        await writeFileEnsureDir(dest, translated);
        filesWritten.push(dest);
      }
    }

    // Write MCP config to .vscode/mcp.json (root key: "servers", type field required)
    if (Object.keys(stack.mcpServers).length > 0) {
      const existingRaw = await readFileOrNull(p.mcp);
      let config: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          config = JSON.parse(existingRaw);
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
  },
  detect,
  read,
  write,
};
