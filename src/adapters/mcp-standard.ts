import path from "node:path";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readMcpFromSettings } from "./adapter-utils.js";

const MCP_FILE = ".mcp.json";

function projectPaths(root: string) {
  return {
    config: path.join(root, MCP_FILE),
    skills: "",
    mcp: path.join(root, MCP_FILE),
  };
}

function userPaths() {
  return { config: "", skills: "", mcp: "" };
}

async function detect(root: string): Promise<DetectionResult> {
  const mcpPath = path.join(root, MCP_FILE);
  if (await exists(mcpPath)) {
    return { detected: true, configPaths: [mcpPath] };
  }
  return { detected: false, configPaths: [] };
}

async function read(root: string): Promise<PlatformConfig> {
  const mcpPath = path.join(root, MCP_FILE);
  const mcpServers = await readMcpFromSettings(mcpPath);

  return {
    adapterId: "mcp-standard",
    agentInstructions: "",
    skills: [],
    mcpServers,
    rules: [],
  };
}

async function write(
  root: string,
  stack: StackBundle,
  opts: WriteOptions,
): Promise<WriteResult> {
  const filesWritten: string[] = [];
  const warnings: string[] = [];

  if (opts.global) {
    // .mcp.json is project-level only
    return { filesWritten, filesSkipped: [], warnings };
  }

  if (Object.keys(stack.mcpServers).length === 0) {
    return { filesWritten, filesSkipped: [], warnings };
  }

  const mcpPath = path.join(root, MCP_FILE);

  if (!opts.dryRun) {
    const existingRaw = await readFileOrNull(mcpPath);
    let existing: Record<string, unknown> = {};
    if (existingRaw) {
      try {
        existing = JSON.parse(existingRaw);
      } catch {
        warnings.push(`Could not parse existing ${mcpPath}, creating new`);
      }
    }
    const currentMcp = (existing.mcpServers as Record<string, unknown>) ?? {};
    for (const name of Object.keys(stack.mcpServers)) {
      if (name in currentMcp) {
        warnings.push(`MCP server "${name}" already exists in .mcp.json — overwriting with stack version`);
      }
    }
    existing.mcpServers = { ...currentMcp, ...stack.mcpServers };
    await writeFileEnsureDir(mcpPath, JSON.stringify(existing, null, 2) + "\n");
    filesWritten.push(mcpPath);
  }

  return { filesWritten, filesSkipped: [], warnings };
}

export const mcpStandardAdapter: PlatformAdapter = {
  id: "mcp-standard",
  displayName: ".mcp.json",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "none",
    rules: false,
    skillFormat: "skill.md",
    mcpStdio: true,
    mcpRemote: false,
    agentsmd: false,
    hooks: false,
  },
  detect,
  read,
  write,
};
