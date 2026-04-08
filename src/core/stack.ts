import path from "node:path";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "../adapters/adapter-utils.js";
import {
  stackManifestSchema,
  mcpConfigSchema,
  type StackBundle,
  type StackManifest,
  type McpConfig,
} from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";
import { readSkillsFromDir, readAgentsFromDir, readRulesFromDir, readCommandsFromDir } from "../adapters/adapter-utils.js";


/** Non-throwing read of stack.json — returns null if missing or invalid */
export async function tryReadStackManifest(stackDir: string): Promise<StackManifest | null> {
  const manifestPath = path.join(stackDir, "stack.json");
  const raw = await readFileOrNull(manifestPath);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = stackManifestSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Non-throwing read of mcp.json — returns empty config if missing or invalid */
export async function tryReadMcpConfig(filePath: string): Promise<McpConfig> {
  const raw = await readFileOrNull(filePath);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    const result = mcpConfigSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export async function readStack(stackDir: string): Promise<StackBundle> {
  const manifestPath = path.join(stackDir, "stack.json");
  const manifestRaw = await readFileOrNull(manifestPath);
  if (!manifestRaw) {
    throw new Error(`No stack.json found in ${stackDir}`);
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  const manifestResult = stackManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    const issues = manifestResult.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid stack.json:\n${issues}`);
  }

  const agentPath = path.join(stackDir, "agent.promptpit.md");
  const agentRaw = await readFileOrNull(agentPath);
  let agentInstructions = "";
  if (agentRaw) {
    const parsed = matter(agentRaw, SAFE_MATTER_OPTIONS as never);
    agentInstructions = parsed.content.trim();
  }

  const skillsDir = path.join(stackDir, "skills");
  const skills = await readSkillsFromDir(skillsDir, { includeStandalone: true });

  const agentsDir = path.join(stackDir, "agents");
  const agents = await readAgentsFromDir(agentsDir);

  const rulesDir = path.join(stackDir, "rules");
  const rules = await readRulesFromDir(rulesDir);

  const commandsDir = path.join(stackDir, "commands");
  const commands = await readCommandsFromDir(commandsDir);

  const mcpPath = path.join(stackDir, "mcp.json");
  const mcpServers = await tryReadMcpConfig(mcpPath);

  const envPath = path.join(stackDir, ".env.example");
  const envRaw = await readFileOrNull(envPath);
  const envExample: Record<string, string> = {};
  if (envRaw) {
    for (const line of envRaw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          envExample[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      }
    }
  }

  return {
    manifest: manifestResult.data,
    agentInstructions,
    skills,
    agents,
    rules,
    commands,
    mcpServers,
    envExample,
  };
}

export async function writeStack(
  outputDir: string,
  bundle: StackBundle,
): Promise<void> {
  await writeFileEnsureDir(
    path.join(outputDir, "stack.json"),
    JSON.stringify(bundle.manifest, null, 2),
  );

  if (bundle.agentInstructions) {
    const yamlImport = await import("js-yaml");
    const fmData = {
      name: bundle.manifest.name,
      description: bundle.manifest.description ?? "",
    };
    const frontmatter = `---\n${yamlImport.default.dump(fmData).trim()}\n---\n\n`;
    await writeFileEnsureDir(
      path.join(outputDir, "agent.promptpit.md"),
      frontmatter + bundle.agentInstructions,
    );
  }

  for (const skill of bundle.skills) {
    await writeFileEnsureDir(
      path.join(outputDir, "skills", skill.name, "SKILL.md"),
      skill.content,
    );
  }

  for (const agent of bundle.agents) {
    await writeFileEnsureDir(
      path.join(outputDir, "agents", `${agent.name}.md`),
      agent.content,
    );
  }

  for (const rule of bundle.rules) {
    await writeFileEnsureDir(
      path.join(outputDir, "rules", `${rule.name}.md`),
      rule.content,
    );
  }

  for (const command of bundle.commands) {
    await writeFileEnsureDir(
      path.join(outputDir, "commands", `${command.name}.md`),
      command.content,
    );
  }

  if (Object.keys(bundle.mcpServers).length > 0) {
    await writeFileEnsureDir(
      path.join(outputDir, "mcp.json"),
      JSON.stringify(bundle.mcpServers, null, 2),
    );
  }

  if (Object.keys(bundle.envExample).length > 0) {
    const lines = Object.entries(bundle.envExample)
      .map(([key, comment]) => `${key}=${comment}`)
      .join("\n");
    await writeFileEnsureDir(path.join(outputDir, ".env.example"), lines + "\n");
  }
}
