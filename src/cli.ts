import { Command } from "commander";
import { collectStack } from "./commands/collect.js";
import { initCommand } from "./commands/init.js";
import { installStack } from "./commands/install.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import path from "node:path";
import { log } from "./shared/io.js";

const program = new Command();

program
  .name("pit")
  .description(
    "Portable AI agent stacks — collect, install, and share across Claude Code, Cursor, and more",
  )
  .version("0.3.0");

program
  .command("init")
  .description("Scaffold a new .promptpit/ stack from scratch")
  .argument("[dir]", "Project directory to initialize", ".")
  .option("-o, --output <path>", "Output directory", ".promptpit")
  .option("--force", "Overwrite existing stack.json")
  .action(async (dir: string, opts: { output: string; force?: boolean }) => {
    try {
      const root = path.resolve(dir);
      await initCommand(root, opts);
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

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
  .argument("[source]", "Stack source: local path or github:owner/repo[@ref] (default: .promptpit)")
  .argument("[target]", "Target project directory", ".")
  .option(
    "--global",
    "Install to user-level paths (available to all projects)",
  )
  .option("--dry-run", "Show what would be installed without writing")
  .option("--force", "Overwrite existing content outside markers")
  .action(
    async (
      source: string | undefined,
      target: string,
      opts: { global?: boolean; dryRun?: boolean; force?: boolean },
    ) => {
      try {
        const resolvedSource = source ?? ".promptpit";
        const targetDir = path.resolve(target);
        await installStack(resolvedSource, targetDir, opts);
      } catch (err: unknown) {
        if (err instanceof Error) {
          log.error(err.message);
        }
        process.exit(1);
      }
    },
  );

program
  .command("status")
  .description("Show what stacks are installed and what's drifted")
  .argument("[dir]", "Project directory to check", ".")
  .option("--json", "Output as JSON (porcelain mode)")
  .option("--short", "One-line summary per stack")
  .option("-v, --verbose", "Show detailed per-adapter inventory with file paths")
  .action(async (dir: string, opts: { json?: boolean; short?: boolean; verbose?: boolean }) => {
    try {
      const root = path.resolve(dir);
      await statusCommand(root, opts);
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program
  .command("watch")
  .description("Watch .agents/skills/ and re-translate on change")
  .argument("[dir]", "Project directory to watch", ".")
  .action(async (dir: string) => {
    try {
      const root = path.resolve(dir);
      await watchCommand(root);
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program.parse();
