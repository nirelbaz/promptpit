import { Command } from "commander";
import { collectStack } from "./commands/collect.js";
import { installStack } from "./commands/install.js";
import path from "node:path";
import { log } from "./shared/io.js";

const program = new Command();

program
  .name("pit")
  .description(
    "Portable AI agent stacks — collect, install, and share across Claude Code, Cursor, and more",
  )
  .version("0.1.0");

program
  .command("collect")
  .description(
    "Bundle your project's AI tool configs into a .promptpit/ stack",
  )
  .argument("[dir]", "Project directory to collect from", ".")
  .option("-o, --output <path>", "Output directory", ".promptpit")
  .option("--dry-run", "Show what would be collected without writing")
  .action(async (dir: string, opts: { output: string; dryRun?: boolean }) => {
    try {
      const root = path.resolve(dir);
      const outputDir = path.resolve(root, opts.output);
      await collectStack(root, outputDir, { dryRun: opts.dryRun });
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program
  .command("install")
  .description("Install a stack into your project")
  .argument("<source>", "Stack source: local path or github:owner/repo[@ref]")
  .argument("[target]", "Target project directory", ".")
  .option(
    "--global",
    "Install to user-level paths (available to all projects)",
  )
  .option("--dry-run", "Show what would be installed without writing")
  .option("--force", "Overwrite existing content outside markers")
  .action(
    async (
      source: string,
      target: string,
      opts: { global?: boolean; dryRun?: boolean; force?: boolean },
    ) => {
      try {
        const targetDir = path.resolve(target);
        await installStack(source, targetDir, opts);
      } catch (err: unknown) {
        if (err instanceof Error) {
          log.error(err.message);
        }
        process.exit(1);
      }
    },
  );

program.parse();
