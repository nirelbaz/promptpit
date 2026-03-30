import path from "node:path";
import { homedir } from "node:os";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
} from "./types.js";
import type { StackBundle } from "../shared/schema.js";
import { readFileOrNull, exists } from "../shared/utils.js";
import { writeWithMarkers } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, "AGENTS.md"),
    skills: path.join(root, ".agents", "skills"),
    mcp: path.join(root, ".agents", "mcp.json"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".agents", "AGENTS.md"),
    skills: path.join(home, ".agents", "skills"),
    mcp: path.join(home, ".agents", "mcp.json"),
  };
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";

  return {
    adapterId: "agents-md",
    agentInstructions,
    skills: [],
    mcpServers: {},
    rules: [],
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
    if (stack.agentInstructions) {
      const written = await writeWithMarkers(
        p.config,
        stack.agentInstructions,
        stackName,
        version,
        "agents-md",
        opts.dryRun,
      );
      if (written) filesWritten.push(written);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        const target = opts.global ? "user-level" : "project-level";
        throw new Error(
          `Cannot write to ${target} AGENTS.md. Check file permissions.`,
        );
      }
    }
    throw err;
  }

  return { filesWritten, filesSkipped: [], warnings };
}

export const agentsMdAdapter: PlatformAdapter = {
  id: "agents-md",
  displayName: "AGENTS.md",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skills: false,
    rules: false,
    skillFormat: "md",
    mcpStdio: false,
    mcpRemote: false,
    agentsmd: true,
    hooks: false,
  },
  detect,
  read,
  write,
};
