import { Command } from "commander";
import { collectStack } from "./commands/collect.js";
import { initCommand } from "./commands/init.js";
import { installStack } from "./commands/install.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { validateCommand, ExitError } from "./commands/validate.js";
import { checkCommand } from "./commands/check.js";
import path from "node:path";
import { log } from "./shared/io.js";

declare const __APP_VERSION__: string;

const program = new Command();

program
  .name("pit")
  .description(
    "Portable AI agent stacks — collect, install, and share across Claude Code, Cursor, and more",
  )
  .version(__APP_VERSION__);

program
  .command("init")
  .description("Scaffold a new .promptpit/ stack from scratch")
  .argument("[dir]", "Project directory to initialize", ".")
  .option("-o, --output <path>", "Output directory", ".promptpit")
  .option("--force", "Overwrite existing stack.json")
  .addHelpText("after", `
Examples:
  pit init                    # scaffold in current directory
  pit init ./my-project       # scaffold in a specific directory
`)
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
  .option("-v, --verbose", "Show full diffs in dry-run output")
  .addHelpText("after", `
Examples:
  pit collect                 # bundle from current directory
  pit collect --dry-run       # preview what would be bundled
  pit collect --dry-run -v    # preview with full diffs
`)
  .action(async (dir: string, opts: { output: string; dryRun?: boolean; verbose?: boolean }) => {
    try {
      const root = path.resolve(dir);
      const outputDir = path.resolve(root, opts.output);
      await collectStack(root, outputDir, { dryRun: opts.dryRun, verbose: opts.verbose });
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
  .option("-v, --verbose", "Show full diffs in dry-run output")
  .option("--force", "Overwrite existing content outside markers")
  .addHelpText("after", `
Examples:
  pit install                          # from .promptpit/ in current dir
  pit install ./path/to/.promptpit     # from a local stack
  pit install github:org/stack@v1.0    # from GitHub
  pit install --dry-run                # preview without writing
  pit install --global                 # install to user-level paths
`)
  .action(
    async (
      source: string | undefined,
      target: string,
      opts: { global?: boolean; dryRun?: boolean; force?: boolean; verbose?: boolean },
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
  .addHelpText("after", `
Examples:
  pit status                  # show sync state
  pit status --json           # machine-readable output
  pit status --short          # one-line summary
`)
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
  .addHelpText("after", `
Examples:
  pit watch                   # watch and re-translate on change
`)
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

program
  .command("validate")
  .description("Check if a stack is well-formed")
  .argument("[dir]", "Stack directory to validate", ".promptpit")
  .option("--json", "Output as JSON")
  .addHelpText("after", `
Examples:
  pit validate                # validate .promptpit/ in current dir
  pit validate ./my-stack     # validate a specific stack
  pit validate --json         # machine-readable output
`)
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const stackDir = path.resolve(dir);
      await validateCommand(stackDir, opts);
    } catch (err: unknown) {
      if (err instanceof ExitError) {
        process.exit(1);
      }
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program
  .command("check")
  .description("CI integration: verify installed config is fresh and in sync")
  .argument("[dir]", "Project directory to check", ".")
  .option("--json", "Output as JSON")
  .addHelpText("after", `
Examples:
  pit check                   # verify freshness + drift
  pit check --json            # machine-readable for CI
`)
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const root = path.resolve(dir);
      const result = await checkCommand(root, opts);
      if (!result.pass) {
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program.parse();
