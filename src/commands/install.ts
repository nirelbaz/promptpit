import path from "node:path";
import { readStack } from "../core/stack.js";
import { installCanonical } from "../core/skill-store.js";
import { readManifest, writeManifest, upsertInstall, buildAdapterRecords } from "../core/manifest.js";
import { detectAdapters } from "../adapters/registry.js";
import { validateEnvNames } from "../core/security.js";
import { writeFileEnsureDir, removeDir, readFileOrNull, exists } from "../shared/utils.js";
import { log, spinner, printDryRunReport } from "../shared/io.js";
import { parseGitHubSource, cloneAndResolve, getRepoCommitSha } from "../sources/github.js";
import type { AdapterWriteContext } from "../core/manifest.js";
import { collectScripts, executeScripts } from "../core/scripts.js";
import { applyExcluded } from "../core/merger.js";
import { pickExclusions } from "../core/select.js";
import {
  chooseOne,
  requireInteractive,
} from "../shared/interactive.js";
import type { WriteOptions, DryRunEntry } from "../adapters/types.js";
import type { DryRunSection } from "../shared/io.js";
import type { InstallEntry, StackBundle } from "../shared/schema.js";
import type { ConflictEntry } from "../core/resolve.js";
import { canonicalSkillBase } from "../core/skill-store.js";

export interface InstallOptions {
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
}

export async function installStack(
  source: string,
  target: string,
  opts: InstallOptions,
): Promise<void> {
  let resolvedSource = source;
  let tmpDir: string | null = null;

  // --save requires an explicit source (can't save ".promptpit" to extends)
  if (opts.save && source === ".promptpit") {
    throw new Error("Cannot use --save without specifying a stack source.");
  }

  // Default source: resolve .promptpit relative to target directory
  if (source === ".promptpit") {
    resolvedSource = path.resolve(target, ".promptpit");
    if (!(await exists(path.join(resolvedSource, "stack.json")))) {
      throw new Error(
        "No .promptpit/ found in this directory.\n\n" +
          "To create one:\n" +
          "  pit init       scaffold a new stack from scratch\n" +
          "  pit collect    bundle existing AI tool configs\n\n" +
          "Or install from another source:\n" +
          "  pit install ./path/to/.promptpit\n" +
          "  pit install github:user/repo",
      );
    }
  }

  const gh = parseGitHubSource(source);
  if (gh) {
    if (opts.dryRun) {
      log.info("Fetching stack metadata from GitHub (required for dry-run preview)...");
    }
    const resolved = await cloneAndResolve(gh);
    resolvedSource = resolved.stackDir;
    tmpDir = resolved.tmpDir;
  }

  // Capture cloned repo dir before --save may reassign resolvedSource
  const clonedRepoDir = gh ? path.dirname(resolvedSource) : undefined;

  try {
    const spin = spinner("Reading stack bundle...");

    let bundle = await readStack(resolvedSource);
    spin.succeed(
      `Stack: ${bundle.manifest.name}@${bundle.manifest.version}`,
    );

    // --save: save to extends FIRST, then resolve the full chain
    if (opts.save) {
      const localStackJsonPath = path.join(target, ".promptpit", "stack.json");
      const localRaw = await readFileOrNull(localStackJsonPath);
      if (!localRaw) {
        throw new Error(
          'No stack.json found. Run "pit init" first, or install without --save.',
        );
      }
      const localManifest = JSON.parse(localRaw);
      const existingExtends: string[] = localManifest.extends ?? [];
      if (!existingExtends.includes(source)) {
        localManifest.extends = [...existingExtends, source];
        await writeFileEnsureDir(
          localStackJsonPath,
          JSON.stringify(localManifest, null, 2) + "\n",
        );
        log.info(`Added "${source}" to extends in .promptpit/stack.json`);
      } else {
        log.info(`"${source}" already in extends, skipping.`);
      }

      // Now install from local .promptpit (which has the updated extends)
      resolvedSource = path.resolve(target, ".promptpit");
      const updatedBundle = await readStack(resolvedSource);
      bundle = updatedBundle;
    }

    // Read existing install manifest up front so we can apply saved
    // overrides/exclusions to the resolved bundle before writing.
    const existingManifest = await readManifest(target);
    const existingEntry = existingManifest.installs.find(
      (e: InstallEntry) => e.stack === bundle.manifest.name,
    );

    // Resolve extends if present
    let finalBundle = bundle;
    let resolvedExtendsEntries: Array<{
      source: string;
      version?: string;
      resolvedCommit?: string;
      resolvedAt: string;
    }> = [];
    let resolvedNodes: Array<{ source: string; stackDir: string; bundle: StackBundle }> = [];
    // Conflict resolutions chosen interactively or pre-resolved from
    // stack.json / installed.json. Written back to the manifest.
    const newInstallOverrides: Record<string, string> = {
      ...(existingEntry?.overrides ?? {}),
    };

    if (bundle.manifest.extends && bundle.manifest.extends.length > 0) {
      const resolveSpin = spinner("Resolving extends...");
      const { resolveGraph, mergeGraph, applyOverrides } = await import(
        "../core/resolve.js"
      );
      const graph = await resolveGraph(resolvedSource);
      // Skip root instructions when installing from local .promptpit/ — they're
      // already in the target file (produced by pit collect from the same file).
      // For external installs (github: or other paths), include all instructions.
      const isLocalSource = source === ".promptpit" || !!opts.save;
      const merged = mergeGraph(graph, {
        instructionStrategy: bundle.manifest.instructionStrategy ?? "concatenate",
        skipRootInstructions: isLocalSource,
      });
      resolveSpin.succeed(
        `Resolved ${graph.nodes.length - 1} extended stack(s)`,
      );

      // Apply declarative resolutions in precedence order:
      //   1. stack.json overrides (stack author's intent — authoritative)
      //   2. installed.json overrides (user's prior interactive choice)
      const stackOverrides = bundle.manifest.overrides;
      const manifestOverrides = existingEntry?.overrides;

      // stack.json is authoritative: drop any manifest entries it has
      // claimed so we don't keep stale user picks alongside the new
      // declarative resolution.
      if (stackOverrides) {
        for (const key of Object.keys(stackOverrides)) {
          delete newInstallOverrides[key];
        }
      }

      const afterStack = applyOverrides(merged, graph, stackOverrides);
      for (const w of afterStack.warnings) log.warn(w);
      const afterManifest = applyOverrides(
        { bundle: afterStack.bundle, sources: afterStack.sources, conflicts: afterStack.unresolved },
        graph,
        manifestOverrides,
      );
      for (const w of afterManifest.warnings) log.warn(w);

      let resolvedBundle = afterManifest.bundle;
      let unresolved: ConflictEntry[] = afterManifest.unresolved;

      // Interactive resolution for whatever remains. Only enforce the TTY
      // requirement when there are actually conflicts to prompt on —
      // otherwise `--interactive` on a clean extends chain would error
      // confusingly in CI.
      if (opts.interactive && unresolved.length > 0) {
        requireInteractive("--interactive");
        const resolved = await promptConflictResolutions(unresolved);
        // Re-run applyOverrides with the new picks merged into manifest
        // overrides so the bundle reflects the choices.
        const interactiveOverrides: Record<string, string> = {};
        for (const conflict of unresolved) {
          const key = `${conflict.type}:${conflict.name}`;
          const pick = resolved.get(key);
          if (!pick) continue;
          // Only record non-default picks so we don't bloat the manifest
          // with no-op entries.
          if (pick !== conflict.winner) {
            interactiveOverrides[key] = pick;
            newInstallOverrides[key] = pick;
          }
        }
        if (Object.keys(interactiveOverrides).length > 0) {
          const merged2 = {
            bundle: resolvedBundle,
            sources: afterManifest.sources,
            conflicts: unresolved,
          };
          const afterInteractive = applyOverrides(
            merged2,
            graph,
            interactiveOverrides,
          );
          for (const w of afterInteractive.warnings) log.warn(w);
          resolvedBundle = afterInteractive.bundle;
          unresolved = afterInteractive.unresolved;
        }
      } else if (opts.interactive) {
        log.info("No unresolved extends conflicts.");
      }

      // Warn about anything still unresolved (falls back to last-declared-wins).
      for (const conflict of unresolved) {
        log.warn(
          `${conflict.type} "${conflict.name}" defined in both ${path.basename(conflict.from)} and ${path.basename(conflict.winner)} — using ${path.basename(conflict.winner)}`,
        );
      }

      finalBundle = resolvedBundle;

      const depNodes = graph.nodes.filter((n) => n.depth > 0);

      resolvedExtendsEntries = depNodes.map((n) => ({
          source: n.source,
          version: n.bundle.manifest.version,
          resolvedCommit: n.resolvedCommit,
          resolvedAt: new Date().toISOString(),
        }));

      resolvedNodes = depNodes;
    } else if (opts.interactive) {
      // No extends = no conflicts. Silent no-op rather than forcing a TTY.
      log.info("No extends to resolve — --interactive is a no-op.");
    }

    // --- Selective install ---
    // Apply saved exclusions first (so deselections persist across runs),
    // then optionally prompt for a new exclusion set.
    const savedExcluded = opts.resetExclusions
      ? []
      : existingEntry?.excluded ?? [];
    if (savedExcluded.length > 0) {
      finalBundle = applyExcluded(finalBundle, savedExcluded);
    }
    let newExcluded: string[] | undefined = savedExcluded.length > 0
      ? savedExcluded
      : undefined;
    if (opts.select) {
      requireInteractive("--select");
      newExcluded = await pickExclusions(finalBundle, savedExcluded);
      if (newExcluded.length > 0) {
        finalBundle = applyExcluded(finalBundle, newExcluded);
      }
    }

    // --save + --interactive: persist overrides to local stack.json too.
    if (opts.save && opts.interactive) {
      const localStackJsonPath = path.join(target, ".promptpit", "stack.json");
      const localRaw = await readFileOrNull(localStackJsonPath);
      if (localRaw) {
        const localManifest = JSON.parse(localRaw);
        const mergedOverrides = {
          ...(localManifest.overrides ?? {}),
          ...newInstallOverrides,
        };
        if (Object.keys(mergedOverrides).length > 0) {
          localManifest.overrides = Object.fromEntries(
            Object.entries(mergedOverrides).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          );
          await writeFileEnsureDir(
            localStackJsonPath,
            JSON.stringify(localManifest, null, 2) + "\n",
          );
          log.info(
            `Saved ${Object.keys(newInstallOverrides).length} override(s) to .promptpit/stack.json`,
          );
        }
      }
    }

    // Validate inbound env var names (security)
    if (Object.keys(finalBundle.envExample).length > 0) {
      const dangerous = validateEnvNames(finalBundle.envExample);
      if (dangerous.length > 0) {
        log.error(
          `Stack contains dangerous env var names: ${dangerous.join(", ")}. ` +
            `These could be used for code injection. Aborting.`,
        );
        throw new Error(
          `Dangerous env var names detected: ${dangerous.join(", ")}`,
        );
      }
    }

    // Warn about inbound MCP servers (security)
    if (Object.keys(finalBundle.mcpServers).length > 0) {
      log.warn(
        `This stack includes ${Object.keys(finalBundle.mcpServers).length} MCP server(s): ` +
          `${Object.keys(finalBundle.mcpServers).join(", ")}. ` +
          `MCP servers run as executables on your machine.`,
      );
    }

    // Collect lifecycle scripts from resolved chain
    const scriptChainEntries = [
      // Dependencies first (deepest-first order from resolveGraph)
      ...resolvedNodes.map((n) => ({
        manifest: n.bundle.manifest,
        stackDir: n.stackDir,
        source: n.source,
      })),
      // Root stack last
      {
        manifest: finalBundle.manifest,
        stackDir: resolvedSource,
        source,
      },
    ];
    const preScripts = collectScripts(scriptChainEntries, "preinstall");
    const postScripts = collectScripts(scriptChainEntries, "postinstall");

    // Append CLI-provided scripts (run after manifest scripts)
    if (opts.preInstall) {
      preScripts.push({
        phase: "preinstall",
        script: opts.preInstall,
        stackDir: resolvedSource,
        stackName: finalBundle.manifest.name,
        stackVersion: finalBundle.manifest.version,
        source,
      });
    }
    if (opts.postInstall) {
      postScripts.push({
        phase: "postinstall",
        script: opts.postInstall,
        stackDir: resolvedSource,
        stackName: finalBundle.manifest.name,
        stackVersion: finalBundle.manifest.version,
        source,
      });
    }

    const isRemoteSource = (src: string) => !!parseGitHubSource(src);

    // Run preinstall scripts (before any files are written)
    if (!opts.ignoreScripts && !opts.dryRun && preScripts.length > 0) {
      await executeScripts(preScripts, {
        targetDir: target,
        isRemote: isRemoteSource,
        trust: opts.trust,
        ignoreScriptErrors: opts.ignoreScriptErrors,
      });
    }

    // Detect target adapters
    const detectSpin = spinner("Detecting AI tools in target...");
    const detected = await detectAdapters(target);

    if (detected.length === 0) {
      detectSpin.warn("No AI tools detected in target");
      log.info("Creating Claude Code config by default");
      const { claudeCodeAdapter } = await import(
        "../adapters/claude-code.js"
      );
      detected.push({
        adapter: claudeCodeAdapter,
        detection: { detected: true, configPaths: [] },
      });
    } else {
      detectSpin.succeed(
        `Target tools: ${detected.map((d) => d.adapter.displayName).join(", ")}`,
      );
    }

    // Always include standards for writing — AGENTS.md + .mcp.json are universal cross-tool outputs
    if (!detected.some((d) => d.adapter.id === "standards")) {
      const { standardsAdapter } = await import("../adapters/standards.js");
      detected.push({
        adapter: standardsAdapter,
        detection: { detected: true, configPaths: [] },
      });
    }

    // Dedup: prevent universal/tool-specific duplication
    if (opts.forceStandards && opts.preferUniversal) {
      throw new Error("--force-standards and --prefer-universal are mutually exclusive");
    }

    // Write skills to canonical .agents/skills/ location
    let canonicalSkillPaths: Map<string, string> | undefined;
    const canonicalEntries: DryRunEntry[] = [];
    if (finalBundle.skills.length > 0) {
      if (opts.dryRun) {
        const base = canonicalSkillBase(target, opts.global);
        for (const skill of finalBundle.skills) {
          const dest = path.join(base, skill.name, "SKILL.md");
          const skillExists = await exists(dest);
          canonicalEntries.push({
            file: dest,
            action: skillExists ? "modify" : "create",
          });
          for (const f of skill.supportingFiles ?? []) {
            const fDest = path.join(base, skill.name, f.relativePath);
            canonicalEntries.push({
              file: fDest,
              action: (await exists(fDest)) ? "modify" : "create",
              detail: "supporting file",
            });
          }
        }
      } else {
        const canonSpin = spinner("Writing canonical skills...");
        canonicalSkillPaths = await installCanonical(target, finalBundle.skills, {
          global: opts.global,
        });
        canonSpin.succeed(
          `Canonical: ${canonicalSkillPaths.size} skills in .agents/skills/`,
        );
      }
    }

    // Build writeOpts with dedup flags
    const writeOpts: WriteOptions = {
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      force: opts.force,
      global: opts.global,
      canonicalSkillPaths,
    };

    if (opts.preferUniversal) {
      writeOpts.preferUniversal = true;
      // Warn about Copilot's opt-in AGENTS.md reading
      const hasCopilot = detected.some((d) => d.adapter.id === "copilot");
      if (hasCopilot) {
        log.warn(
          "Copilot: skipped .github/copilot-instructions.md — ensure chat.useAgentsMdFile is enabled in VS Code settings",
        );
      }
    } else if (!opts.forceStandards) {
      // Single pass: collect adapter names that natively read each universal file
      const mcpReaders: string[] = [];
      const instrReaders: string[] = [];
      for (const d of detected) {
        if (d.adapter.id === "standards") continue;
        if (d.adapter.capabilities.nativelyReads?.mcp) mcpReaders.push(d.adapter.displayName);
        if (d.adapter.capabilities.nativelyReads?.instructions) instrReaders.push(d.adapter.displayName);
      }

      const hasMcp = Object.keys(finalBundle.mcpServers).length > 0;
      const hasInstructions = !!(finalBundle.agentInstructions || finalBundle.agents.length > 0);
      let skippedAny = false;

      if (mcpReaders.length > 0) {
        writeOpts.skipMcp = true;
        if (hasMcp) {
          skippedAny = true;
          log.info(
            `Standards: skipped .mcp.json (${mcpReaders.join(", ")} read${mcpReaders.length === 1 ? "s" : ""} it natively, causing duplicate MCP servers)`,
          );
        }
      }
      if (instrReaders.length > 0) {
        writeOpts.skipInstructions = true;
        if (hasInstructions) {
          skippedAny = true;
          log.info(
            `Standards: skipped AGENTS.md (${instrReaders.join(", ")} read${instrReaders.length === 1 ? "s" : ""} it natively, causing duplicate instructions)`,
          );
        }
      }
      if (skippedAny) {
        log.info(
          "Tip: use --force-standards to write universal files even when detected tools read them natively",
        );
      }
    }

    // Write to each detected adapter

    const adapterSections: DryRunSection[] = [];

    for (const { adapter } of detected) {
      if (opts.dryRun) {
        const result = await adapter.write(target, finalBundle, writeOpts);
        if (result.dryRunEntries && result.dryRunEntries.length > 0) {
          adapterSections.push({
            label: adapter.displayName,
            entries: result.dryRunEntries,
          });
        }
        for (const w of result.warnings) {
          log.warn(w);
        }
      } else {
        const writeSpin = spinner(`Installing to ${adapter.displayName}...`);
        const result = await adapter.write(target, finalBundle, writeOpts);
        writeSpin.succeed(
          `${adapter.displayName}: ${result.filesWritten.length} files written`,
        );
        for (const w of result.warnings) {
          log.warn(w);
        }
      }
    }

    if (opts.dryRun) {
      const otherEntries: DryRunEntry[] = [];

      otherEntries.push({
        file: path.join(target, ".promptpit", "installed.json"),
        action: (await exists(path.join(target, ".promptpit", "installed.json")))
          ? "modify"
          : "create",
        detail: "install manifest",
      });

      const envCount = Object.keys(finalBundle.envExample).length;
      if (envCount > 0) {
        const envPath = path.join(target, ".env");
        const envExists = await exists(envPath);
        otherEntries.push({
          file: envPath,
          action: envExists ? "modify" : "create",
          detail: `${envCount} placeholder${envCount !== 1 ? "s" : ""}`,
        });
      }

      const sections: DryRunSection[] = [];
      if (canonicalEntries.length > 0) {
        sections.push({ label: "Canonical skills", entries: canonicalEntries });
      }
      sections.push(...adapterSections);
      if (otherEntries.length > 0) {
        sections.push({ label: "Other", entries: otherEntries });
      }

      // Show lifecycle scripts in dry-run
      if (!opts.ignoreScripts) {
        const allScripts = [...preScripts, ...postScripts];
        if (allScripts.length > 0) {
          sections.push({
            label: "Lifecycle scripts",
            entries: allScripts.map((s) => ({
              file: `${s.phase}: ${s.script}`,
              action: "run" as const,
              detail: s.stackName,
            })),
          });
        }
      }

      printDryRunReport(
        `Dry run — would install ${finalBundle.manifest.name}@${finalBundle.manifest.version}:`,
        sections,
        !!opts.verbose,
      );
      return;
    }

    // Write manifest (tracks what was installed for status/dedup)
    {
      const manifestSpin = spinner("Writing install manifest...");
      const manifest = await readManifest(target);

      // Build adapter records with content hashes
      const contexts: AdapterWriteContext[] = detected.map(({ adapter }) => ({
        adapter,
        writeOpts,
      }));
      const adapterRecords = buildAdapterRecords(contexts, finalBundle, target);

      // Sort override keys so git merges stay line-level.
      const sortedOverrides =
        Object.keys(newInstallOverrides).length > 0
          ? Object.fromEntries(
              Object.entries(newInstallOverrides).sort(([a], [b]) =>
                a.localeCompare(b),
              ),
            )
          : undefined;

      const entry: InstallEntry = {
        stack: finalBundle.manifest.name,
        stackVersion: finalBundle.manifest.version,
        source: gh ? source : undefined,
        resolvedCommit: clonedRepoDir ? getRepoCommitSha(clonedRepoDir) : undefined,
        installedAt: new Date().toISOString(),
        ...(opts.forceStandards && { installMode: "force-standards" as const }),
        ...(opts.preferUniversal && { installMode: "prefer-universal" as const }),
        ...(resolvedExtendsEntries.length > 0 && { resolvedExtends: resolvedExtendsEntries }),
        adapters: adapterRecords,
        ...(sortedOverrides && { overrides: sortedOverrides }),
        ...(newExcluded && newExcluded.length > 0 && { excluded: newExcluded.slice().sort() }),
      };

      const updated = upsertInstall(manifest, entry);
      await writeManifest(target, updated);
      manifestSpin.succeed("Manifest updated");
    }

    // Write .env file with placeholders (don't overwrite existing)
    if (Object.keys(finalBundle.envExample).length > 0) {
      const envPath = path.join(target, ".env");
      const existing = await readFileOrNull(envPath);
      if (existing != null) {
        const existingKeys = new Set(
          existing.split("\n")
            .map((line) => line.split("=")[0]?.trim())
            .filter(Boolean),
        );
        const missingKeys = Object.keys(finalBundle.envExample).filter(
          (key) => !existingKeys.has(key),
        );
        if (missingKeys.length > 0) {
          const additions = missingKeys
            .map((key) => `${key}= ${finalBundle.envExample[key]}`)
            .join("\n");
          await writeFileEnsureDir(envPath, existing + "\n" + additions + "\n");
          log.info(
            `Appended ${missingKeys.length} new placeholder(s) to existing .env.`,
          );
        } else {
          log.info("All env vars already present in .env, skipping.");
        }
      } else {
        const envLines = Object.entries(finalBundle.envExample)
          .map(([key, comment]) => `${key}= ${comment}`)
          .join("\n");
        await writeFileEnsureDir(envPath, envLines + "\n");
        log.info(
          `Created .env with ${Object.keys(finalBundle.envExample).length} placeholder(s). Fill in your values.`,
        );
      }
    }

    // Run postinstall scripts (after all files are written)
    if (!opts.ignoreScripts && !opts.dryRun && postScripts.length > 0) {
      await executeScripts(postScripts, {
        targetDir: target,
        isRemote: isRemoteSource,
        trust: opts.trust,
        ignoreScriptErrors: opts.ignoreScriptErrors,
      });
    }

    log.success("Stack installed successfully!");
    log.info("Next: Run 'pit status' to verify.");
  } finally {
    if (tmpDir) {
      await removeDir(tmpDir);
    }
  }
}

// --- Interactive conflict resolution ---

/**
 * Prompt the user to pick a winner for each unresolved extends conflict.
 * Returns a `Map<"type:name", chosenSource>` of the user's picks. Defaults
 * to the `winner` (last-declared-wins) if the user selects it.
 */
async function promptConflictResolutions(
  conflicts: ConflictEntry[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i]!;
    const choice = await chooseOne<string>(
      `[${i + 1}/${conflicts.length}] ${conflict.type} "${conflict.name}" — which source wins?`,
      [
        {
          value: conflict.winner,
          label: path.basename(conflict.winner),
          hint: "last-declared (default)",
        },
        {
          value: conflict.from,
          label: path.basename(conflict.from),
        },
      ],
      conflict.winner,
    );
    results.set(`${conflict.type}:${conflict.name}`, choice);
  }

  return results;
}
