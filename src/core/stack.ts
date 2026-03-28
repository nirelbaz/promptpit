import path from "node:path";
import matter from "gray-matter";
import {
  stackManifestSchema,
  mcpConfigSchema,
  type StackBundle,
  type McpConfig,
} from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readSkillsFromDir } from "../adapters/adapter-utils.js";

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
    const parsed = matter(agentRaw);
    agentInstructions = parsed.content.trim();
  }

  const skillsDir = path.join(stackDir, "skills");
  const skills = (await exists(skillsDir))
    ? await readSkillsFromDir(skillsDir)
    : [];

  const mcpPath = path.join(stackDir, "mcp.json");
  const mcpRaw = await readFileOrNull(mcpPath);
  let mcpServers: McpConfig = {};
  if (mcpRaw) {
    try {
      const parsed = JSON.parse(mcpRaw);
      const mcpResult = mcpConfigSchema.safeParse(parsed);
      if (mcpResult.success) {
        mcpServers = mcpResult.data;
      }
    } catch {
      // Invalid MCP JSON — skip
    }
  }

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
    const frontmatter = `---\nname: ${bundle.manifest.name}\ndescription: ${bundle.manifest.description ?? ""}\n---\n\n`;
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
