import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import yaml from "js-yaml";
import { log } from "../shared/io.js";
import { exists, writeFileEnsureDir } from "../shared/utils.js";
import { stackManifestSchema, type StackManifest } from "../shared/schema.js";

export interface InitOptions {
  force?: boolean;
  output?: string;
}

export interface Prompter {
  question(query: string): Promise<string>;
  close(): void;
}

function createPrompter(): Prompter {
  return createInterface({ input: stdin, output: stdout });
}

async function ask(
  rl: Prompter,
  label: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function askYesNo(rl: Prompter, label: string): Promise<boolean> {
  const answer = await ask(rl, `${label} (y/N)`);
  return answer.toLowerCase() === "y";
}

export async function initCommand(
  dir: string,
  opts: InitOptions = {},
  prompter?: Prompter,
): Promise<void> {
  const resolvedDir = path.resolve(dir);
  const outputDir = path.resolve(resolvedDir, opts.output ?? ".promptpit");

  if (!opts.force && (await exists(path.join(outputDir, "stack.json")))) {
    throw new Error(
      `${path.join(opts.output ?? ".promptpit", "stack.json")} already exists. Use --force to overwrite.`,
    );
  }

  const rl = prompter ?? createPrompter();

  try {
    const dirDefault = path.basename(resolvedDir)
      .replace(/[^a-zA-Z0-9_@.\-/]/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "") || "my-stack";
    const name = await ask(rl, "Stack name", dirDefault);
    const version = await ask(rl, "Version", "0.1.0");
    const description = await ask(rl, "Description");
    const author = await ask(rl, "Author");

    const manifestData: Record<string, unknown> = { name, version };
    if (description) manifestData.description = description;
    if (author) manifestData.author = author;

    const result = stackManifestSchema.safeParse(manifestData);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid stack config:\n${issues}`);
    }

    const manifest: StackManifest = result.data;

    const includeInstructions = await askYesNo(rl, "Create agent instructions file?");
    const includeMcp = await askYesNo(rl, "Create MCP config?");
    const includeEnv = await askYesNo(rl, "Create .env.example?");

    // Collect all file writes
    const writes: Promise<void>[] = [];

    writes.push(
      writeFileEnsureDir(
        path.join(outputDir, "stack.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      ),
    );

    if (includeInstructions) {
      const fmData = { name: manifest.name, description: manifest.description ?? "" };
      const frontmatter = `---\n${yaml.dump(fmData).trim()}\n---\n\n`;
      const body = "# Agent Instructions\n\n<!-- Add your project-wide agent instructions here -->\n";
      writes.push(
        writeFileEnsureDir(
          path.join(outputDir, "agent.promptpit.md"),
          frontmatter + body,
        ),
      );
    }

    writes.push(
      writeFileEnsureDir(path.join(outputDir, "skills", ".gitkeep"), ""),
    );

    writes.push(
      writeFileEnsureDir(path.join(outputDir, "rules", ".gitkeep"), ""),
    );

    if (includeMcp) {
      writes.push(
        writeFileEnsureDir(
          path.join(outputDir, "mcp.json"),
          JSON.stringify({}, null, 2) + "\n",
        ),
      );
    }

    if (includeEnv) {
      writes.push(
        writeFileEnsureDir(
          path.join(outputDir, ".env.example"),
          "# Add environment variables required by your stack\n",
        ),
      );
    }

    await Promise.all(writes);

    log.success(`Initialized stack in ${path.relative(resolvedDir, outputDir) || outputDir}`);

    const steps: string[] = [];
    if (includeInstructions) {
      steps.push("Write your agent instructions in .promptpit/agent.promptpit.md");
    }
    steps.push("Add skills to .promptpit/skills/<name>/SKILL.md");
    steps.push("Add conditional rules to .promptpit/rules/<name>.md");
    steps.push("Run 'pit validate' to check for issues");
    steps.push("Run 'pit install' to install the stack into your project");

    log.info("Next steps:");
    steps.forEach((s, i) => log.info(`  ${i + 1}. ${s}`));
    log.info("");
    log.info("Already have AI tool configs? Run 'pit collect' instead to bundle them automatically.");
  } finally {
    if (!prompter) {
      rl.close();
    }
  }
}
