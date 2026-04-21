import { Command } from "commander";
import { collectStack } from "./commands/collect.js";
import { initCommand } from "./commands/init.js";
import { installStack } from "./commands/install.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { validateCommand, ExitError } from "./commands/validate.js";
import { checkCommand } from "./commands/check.js";
import { diffCommand } from "./commands/diff.js";
import type { DiffOptions } from "./commands/diff.js";
import { uninstallStack } from "./commands/uninstall.js";
import { updateStacks } from "./commands/update.js";
import { lsCommand } from "./commands/ls.js";
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
  .option("-n, --name <name>", "Stack name (skip prompt)")
  .option("-y, --yes", "Accept all defaults, no prompts (CI-friendly)")
  .addHelpText("after", `
Examples:
  pit init                    # scaffold in current directory
  pit init ./my-project       # scaffold in a specific directory
  pit init -y                 # non-interactive with defaults
  pit init -y --name my-stack # non-interactive with custom name
`)
  .action(async (dir: string, opts: { output: string; force?: boolean; name?: string; yes?: boolean }) => {
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
  .option("--include-extends", "Fetch and flatten extends into the bundle")
  .option("--select", "Interactively pick artifacts to include (requires TTY)")
  .addHelpText("after", `
Examples:
  pit collect                 # bundle from current directory
  pit collect --dry-run       # preview what would be bundled
  pit collect --dry-run -v    # preview with full diffs
  pit collect --include-extends  # flatten extends into the bundle
  pit collect --select        # pick which artifacts to include
`)
  .action(async (dir: string, opts: { output: string; dryRun?: boolean; verbose?: boolean; includeExtends?: boolean; select?: boolean }) => {
    try {
      const root = path.resolve(dir);
      const outputDir = path.resolve(root, opts.output);
      await collectStack(root, outputDir, {
        dryRun: opts.dryRun,
        verbose: opts.verbose,
        includeExtends: opts.includeExtends,
        select: opts.select,
      });
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
  .option(
    "--force-standards",
    "Write .mcp.json and AGENTS.md even when detected tools read them natively",
  )
  .option(
    "--prefer-universal",
    "Use universal files (.mcp.json, AGENTS.md) instead of tool-specific equivalents",
  )
  .option("--save", "Add the source to extends in .promptpit/stack.json")
  .option("--trust", "Trust remote stack scripts (skip consent prompt)")
  .option("--ignore-scripts", "Skip lifecycle scripts (preinstall/postinstall)")
  .option(
    "--ignore-script-errors",
    "Continue install even if lifecycle scripts fail",
  )
  .option("--pre-install <script>", "Run a shell command before installing files")
  .option("--post-install <script>", "Run a shell command after installing files")
  .option(
    "--interactive",
    "Prompt to resolve extends conflicts (requires TTY)",
  )
  .option(
    "--select",
    "Interactively pick artifacts to install (requires TTY)",
  )
  .option(
    "--reset-exclusions",
    "Clear the saved exclusions list before installing",
  )
  .addHelpText("after", `
Examples:
  pit install                          # from .promptpit/ in current dir
  pit install ./path/to/.promptpit     # from a local stack
  pit install github:org/stack@v1.0    # from GitHub
  pit install --dry-run                # preview without writing
  pit install --global                 # install to user-level paths
  pit install github:org/stack --save  # install + add to extends
  pit install github:org/stack --post-install ./setup  # run setup after install
  pit install --interactive            # resolve conflicts interactively
  pit install --select                 # pick which artifacts to install
  pit install --reset-exclusions       # reinstate artifacts previously deselected
`)
  .action(
    async (
      source: string | undefined,
      target: string,
      opts: {
        global?: boolean;
        dryRun?: boolean;
        force?: boolean;
        verbose?: boolean;
        forceStandards?: boolean;
        preferUniversal?: boolean;
        save?: boolean;
        trust?: boolean;
        ignoreScripts?: boolean;
        ignoreScriptErrors?: boolean;
        preInstall?: string;
        postInstall?: string;
        interactive?: boolean;
        select?: boolean;
        resetExclusions?: boolean;
      },
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
  .command("uninstall")
  .description("Remove an installed stack and its artifacts")
  .argument("<stack>", "Name of the installed stack to remove")
  .argument("[dir]", "Project directory", ".")
  .option("--force", "Remove files even if modified since install")
  .option("--dry-run", "Preview what would be removed without writing")
  .option("-v, --verbose", "Show full diffs in dry-run output")
  .addHelpText("after", `
Examples:
  pit uninstall my-stack            # remove my-stack from current dir
  pit uninstall my-stack --dry-run  # preview what would be removed
  pit uninstall my-stack --force    # remove even modified files
`)
  .action(async (stack: string, dir: string, opts: { force?: boolean; dryRun?: boolean; verbose?: boolean }) => {
    try {
      const targetDir = path.resolve(dir);
      await uninstallStack(stack, targetDir, opts);
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Update installed stacks to their latest versions")
  .argument("[stack]", "Update a specific stack by name (default: all)")
  .argument("[dir]", "Project directory", ".")
  .option("--check", "Only check for updates, don't apply")
  .option("--dry-run", "Show what would change without writing")
  .option("-f, --force", "Overwrite drifted artifacts (default: skip them)")
  .option("-v, --verbose", "Show detailed diffs for changed artifacts")
  .option("--ignore-scripts", "Skip lifecycle scripts")
  .option("--trust", "Trust remote stack scripts (skip consent prompt)")
  .option("--json", "Machine-readable output (for --check)")
  .option(
    "--interactive",
    "Prompt per drifted+changed artifact (requires TTY)",
  )
  .addHelpText("after", `
Examples:
  pit update                  # update all installed stacks
  pit update my-stack         # update a specific stack
  pit update --check          # check for updates without applying
  pit update --dry-run        # preview what would change
  pit update --force          # overwrite drifted artifacts
  pit update --interactive    # resolve drift conflicts interactively
  pit update --check --json   # machine-readable update check
`)
  .action(async (stack: string | undefined, dir: string, opts: {
    check?: boolean;
    dryRun?: boolean;
    force?: boolean;
    verbose?: boolean;
    ignoreScripts?: boolean;
    trust?: boolean;
    json?: boolean;
    interactive?: boolean;
  }) => {
    try {
      const root = path.resolve(dir);
      const result = await updateStacks(root, { ...opts, stackName: stack });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      }

      if (opts.check && result.stacks.some((s) =>
        s.added.length > 0 || s.modified.length > 0 || s.removed.length > 0
      )) {
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show what stacks are installed and what's drifted")
  .argument("[dir]", "Project directory to check", ".")
  .option("--json", "Output as JSON (porcelain mode)")
  .option("--short", "One-line summary per stack")
  .option("-v, --verbose", "Show detailed per-adapter inventory with file paths")
  .option("--skip-upstream", "Skip checking upstream extends for updates (offline mode)")
  .addHelpText("after", `
Examples:
  pit status                  # show sync state
  pit status --json           # machine-readable output
  pit status --short          # one-line summary
  pit status --skip-upstream  # skip network checks (offline mode)
`)
  .action(async (dir: string, opts: { json?: boolean; short?: boolean; verbose?: boolean; skipUpstream?: boolean }) => {
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
  .command("diff")
  .description("Show text diffs between installed config and .promptpit/ source")
  .argument("[name]", "Filter by artifact name")
  .argument("[dir]", "Project directory", ".")
  .option("--type <type>", "Filter by artifact type (instructions|skill|agent|rule|command|mcp)")
  .option("-a, --adapter <id>", "Show diffs for a specific adapter")
  .option("--json", "Output as JSON")
  .addHelpText("after", `
Examples:
  pit diff                        # all drifted artifacts
  pit diff my-skill               # diff for a specific artifact
  pit diff --type skill            # all drifted skills
  pit diff --adapter cursor        # only Cursor adapter drifts
  pit diff --json                  # machine-readable output
`)
  .action(async (name: string | undefined, dir: string, opts: { type?: string; adapter?: string; json?: boolean }) => {
    try {
      const root = path.resolve(dir);
      const hasDrift = await diffCommand(root, { ...opts, name, type: opts.type as DiffOptions["type"] });
      if (hasDrift) {
        process.exit(1);
      }
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

Enhanced validation powered by agnix (https://github.com/nichochar/agnix) when installed.
Install with: npm i -D agnix
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

program
  .command("ls")
  .description("List AI-config stacks in scope")
  .argument("[dir]", "Directory to scan from", ".")
  .option("--scope <scope>", "Scope: current | global")
  .option("--path <dir>", "Scan a specific root")
  .option("--deep", "Remove depth cap")
  .option("--all", "Shorthand for --path ~ --deep")
  .option("--managed", "Only pit-managed stacks")
  .option("--unmanaged", "Only stacks without .promptpit/")
  .option("--drifted", "Only drifted managed stacks")
  .option("--kind <kind>", "global | project")
  .option("--short", "One-line per stack")
  .option("--json", "ScannedStack[] for scripting")
  .option("--strict", "Exit 1 if any drift")
  .addHelpText("after", `
Examples:
  pit ls                       # scan current tree + global
  pit ls --scope current       # skip global scan
  pit ls --managed             # only pit-managed stacks
  pit ls --drifted --strict    # CI: fail if any drift
  pit ls --json                # machine-readable output
  pit ls --all                 # scan the whole machine
`)
  .action(async (dir: string, opts: {
    scope?: "current" | "global";
    path?: string;
    deep?: boolean;
    all?: boolean;
    managed?: boolean;
    unmanaged?: boolean;
    drifted?: boolean;
    kind?: "global" | "project";
    short?: boolean;
    json?: boolean;
    strict?: boolean;
  }) => {
    try {
      const root = path.resolve(dir);
      const code = await lsCommand(root, opts);
      if (code !== 0) process.exit(code);
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message);
      }
      process.exit(1);
    }
  });

// Bare `pit` (no subcommand) opens the interactive TUI. Under a pipe or
// redirect the TUI itself prints an error and exits 1 — Commander's built-in
// `--help` still handles the help flag.
program.action(async () => {
  const { menuCommand } = await import("./commands/menu.js");
  const code = await menuCommand(process.cwd());
  if (code !== 0) process.exit(code);
});

program.parse();
