import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "./adapter-utils.js";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readMcpFromSettings, writeWithMarkers, rethrowPermissionError } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, ".github", "copilot-instructions.md"),
    skills: path.join(root, ".github", "instructions"),
    mcp: path.join(root, ".vscode", "mcp.json"),
    rules: path.join(root, ".github", "instructions"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".github", "copilot-instructions.md"),
    skills: path.join(home, ".github", "instructions"),
    mcp: path.join(home, ".vscode", "mcp.json"),
    rules: path.join(home, ".github", "instructions"),
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
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    // Write instructions to .github/copilot-instructions.md
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "copilot",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }

    // Install skills as .github/instructions/*.instructions.md (translate-copy)
    for (const skill of stack.skills) {
      const instructionContent = skillToInstructionsMd(skill.content);
      const dest = path.join(p.skills, `${skill.name}.instructions.md`);
      if (!opts.dryRun) {
        await writeFileEnsureDir(dest, instructionContent);
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
      config.servers = {
        ...((config.servers as Record<string, unknown>) ?? {}),
        ...translateMcpServers(stack.mcpServers as Record<string, Record<string, unknown>>),
      };
      if (!opts.dryRun) {
        await writeFileEnsureDir(p.mcp, JSON.stringify(config, null, 2));
        filesWritten.push(p.mcp);
      }
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "Copilot paths");
  }

  return { filesWritten, filesSkipped: [], warnings };
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
    agentsmd: true,
    hooks: false,
  },
  detect,
  read,
  write,
};
