import path from "node:path";
import { readFile } from "node:fs/promises";
import { readManifest, writeManifest, computeSkillHash } from "../core/manifest.js";
import { getAdapter } from "../adapters/registry.js";
import { stripMarkerBlock } from "../shared/markers.js";
import { readFileOrNull, exists, removeFileOrSymlink, writeFileEnsureDir } from "../shared/utils.js";
import { removeMcpFromJson } from "../adapters/adapter-utils.js";
import { removeMcpSectionsFromToml } from "../adapters/toml-utils.js";
import { canonicalSkillBase } from "../core/skill-store.js";
import { isSkillShared, isArtifactShared, agentFileName, ruleFileNames, removeCheckedFile, removeEmptyDir } from "../core/artifact-ops.js";
import { log, printDryRunReport } from "../shared/io.js";
import type { InstallManifest } from "../shared/schema.js";
import type { DryRunEntry } from "../adapters/types.js";
import type { DryRunSection } from "../shared/io.js";

export interface UninstallOptions {
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function uninstallStack(
  stackName: string,
  target: string,
  opts: UninstallOptions,
): Promise<void> {
  // Read manifest and find entry
  const manifest = await readManifest(target);
  const entry = manifest.installs.find((e) => e.stack === stackName);

  if (!entry) {
    const installed = manifest.installs.map((e) => e.stack);
    if (installed.length === 0) {
      throw new Error("No stacks are installed. Nothing to uninstall.");
    }
    throw new Error(
      `Stack "${stackName}" is not installed.\n\nInstalled stacks:\n${installed.map((s) => `  - ${s}`).join("\n")}`,
    );
  }

  if (!opts.dryRun) {
    log.info(`Uninstalling ${stackName}@${entry.stackVersion}...`);
  }

  const dryRunSections: DryRunSection[] = [];
  const dirsToClean = new Set<string>();
  let removedCount = 0;
  let sharedCount = 0;
  let modifiedCount = 0;

  // Track which canonical skills have been processed (avoid double-removal across adapters)
  const processedCanonicalSkills = new Set<string>();

  // Process each adapter
  for (const [adapterId, record] of Object.entries(entry.adapters)) {
    let adapter;
    try {
      adapter = getAdapter(adapterId);
    } catch {
      log.warn(`Unknown adapter "${adapterId}" in manifest — skipping`);
      continue;
    }
    const p = adapter.paths.project(target);
    const dryRunEntries: DryRunEntry[] = [];

    // --- Instructions (marker blocks) ---
    if (record.instructions && p.config) {
      const content = await readFileOrNull(p.config);
      if (content != null) {
        const stripped = stripMarkerBlock(content, stackName);
        if (stripped !== content) {
          if (stripped.trim() === "") {
            if (opts.dryRun) {
              dryRunEntries.push({ file: p.config, action: "remove", detail: "empty after marker removal" });
            } else {
              await removeFileOrSymlink(p.config);
              removedCount++;
            }
          } else {
            if (opts.dryRun) {
              dryRunEntries.push({
                file: p.config,
                action: "modify",
                detail: "strip marker block",
                ...(opts.verbose && { oldContent: content, newContent: stripped }),
              });
            } else {
              await writeFileEnsureDir(p.config, stripped);
              removedCount++;
            }
          }
        }
      }
    }

    // --- Skills ---
    if (record.skills) {
      for (const [skillName, skillRecord] of Object.entries(record.skills)) {
        if (isSkillShared(manifest, stackName, skillName)) {
          log.info(`Keeping skill "${skillName}" — also used by another stack`);
          sharedCount++;
          if (opts.dryRun) {
            dryRunEntries.push({
              file: path.join(p.skills, skillName, "SKILL.md"),
              action: "skip",
              detail: "shared with another stack",
            });
          }
          continue;
        }

        // Remove adapter skill files (strategy-dependent)
        if (adapter.capabilities.skillLinkStrategy === "symlink") {
          // Symlink adapters: remove the symlink directory (safe — it's a pointer)
          const adapterSkillDir = path.join(p.skills, skillName);
          if (opts.dryRun) {
            if (await exists(adapterSkillDir)) {
              dryRunEntries.push({ file: path.join(adapterSkillDir, "SKILL.md"), action: "remove" });
            }
          } else {
            await removeFileOrSymlink(adapterSkillDir);
            removedCount++;
          }
          dirsToClean.add(p.skills);
        } else if (adapter.capabilities.skillLinkStrategy === "translate-copy") {
          // Translate-copy adapters (Copilot): remove the translated file.
          // Always removed (generated artifact, like marker blocks).
          const translatedFile = path.join(p.skills, `${skillName}.instructions.md`);
          if (opts.dryRun) {
            if (await exists(translatedFile)) {
              dryRunEntries.push({ file: translatedFile, action: "remove" });
            }
          } else {
            await removeFileOrSymlink(translatedFile);
            removedCount++;
          }
          dirsToClean.add(p.skills);
        }

        // Remove canonical skill directory (once per skill, not per adapter)
        if (!processedCanonicalSkills.has(skillName)) {
          processedCanonicalSkills.add(skillName);
          const canonicalDir = path.join(canonicalSkillBase(target), skillName);
          const canonicalSkillPath = path.join(canonicalDir, "SKILL.md");
          const canonicalContent = await readFileOrNull(canonicalSkillPath);
          if (canonicalContent != null) {
            if (!opts.force) {
              // Recompute composite hash including supporting files from manifest
              const supportingFilePaths = skillRecord.supportingFiles ?? [];
              const supportingFiles = [];
              for (const relPath of supportingFilePaths) {
                const absPath = path.join(canonicalDir, relPath);
                try {
                  const content = await readFile(absPath);
                  supportingFiles.push({ relativePath: relPath, content });
                } catch {
                  // Supporting file missing — treat as modified
                  break;
                }
              }
              const currentHash = computeSkillHash(canonicalContent, supportingFiles.length > 0 ? supportingFiles : undefined);
              if (currentHash !== skillRecord.hash) {
                log.warn(`Skipping modified canonical skill: ${canonicalSkillPath}`);
                modifiedCount++;
                continue;
              }
            }
            if (!opts.dryRun) {
              await removeFileOrSymlink(canonicalDir);
            }
          }
        }
      }
    }

    // --- Agents (native) ---
    if (record.agents && adapter.capabilities.agents === "native" && p.agents) {
      for (const [agentName, agentRecord] of Object.entries(record.agents)) {
        if (isArtifactShared(manifest, stackName, adapterId, "agents", agentName)) {
          log.info(`Keeping agent "${agentName}" — also used by another stack`);
          sharedCount++;
          continue;
        }

        const agentPath = path.join(p.agents, agentFileName(adapterId, agentName));
        const status = await removeCheckedFile(agentPath, agentRecord.hash, opts);
        if (status === "removed") {
          if (opts.dryRun) {
            dryRunEntries.push({ file: agentPath, action: "remove" });
          } else {
            removedCount++;
          }
        } else if (status === "skipped-modified") {
          log.warn(`Skipping modified agent: ${agentPath}`);
          modifiedCount++;
          if (opts.dryRun) {
            dryRunEntries.push({ file: agentPath, action: "skip", detail: "modified since install" });
          }
        }
      }
      dirsToClean.add(p.agents);
    }

    // --- Rules ---
    if (record.rules && adapter.capabilities.rules && p.rules) {
      for (const [ruleName, ruleRecord] of Object.entries(record.rules)) {
        if (isArtifactShared(manifest, stackName, adapterId, "rules", ruleName)) {
          log.info(`Keeping rule "${ruleName}" — also used by another stack`);
          sharedCount++;
          continue;
        }

        // Try both prefixed and unprefixed paths
        const candidates = ruleFileNames(adapterId, ruleName);
        for (const fileName of candidates) {
          const rulePath = path.join(p.rules, fileName);
          const status = await removeCheckedFile(rulePath, ruleRecord.hash, opts);
          if (status === "removed") {
            if (opts.dryRun) {
              dryRunEntries.push({ file: rulePath, action: "remove" });
            } else {
              removedCount++;
            }
            break;
          } else if (status === "skipped-modified") {
            log.warn(`Skipping modified rule: ${rulePath}`);
            modifiedCount++;
            if (opts.dryRun) {
              dryRunEntries.push({ file: rulePath, action: "skip", detail: "modified since install" });
            }
            break;
          }
        }
      }
      dirsToClean.add(p.rules);
    }

    // --- Commands ---
    if (record.commands && adapter.capabilities.commands && p.commands) {
      for (const [commandName, commandRecord] of Object.entries(record.commands)) {
        if (isArtifactShared(manifest, stackName, adapterId, "commands", commandName)) {
          log.info(`Keeping command "${commandName}" — also used by another stack`);
          sharedCount++;
          continue;
        }

        const commandPath = path.join(p.commands, `${commandName}.md`);
        const status = await removeCheckedFile(commandPath, commandRecord.hash, opts);
        if (status === "removed") {
          if (opts.dryRun) {
            dryRunEntries.push({ file: commandPath, action: "remove" });
          } else {
            removedCount++;
          }
        } else if (status === "skipped-modified") {
          log.warn(`Skipping modified command: ${commandPath}`);
          modifiedCount++;
          if (opts.dryRun) {
            dryRunEntries.push({ file: commandPath, action: "skip", detail: "modified since install" });
          }
        }
      }
      dirsToClean.add(p.commands);
    }

    // --- MCP servers ---
    if (record.mcp) {
      const serverNames: string[] = [];
      for (const name of Object.keys(record.mcp)) {
        if (isArtifactShared(manifest, stackName, adapterId, "mcp", name)) {
          log.info(`Keeping MCP server "${name}" — also used by another stack`);
          sharedCount++;
        } else {
          serverNames.push(name);
        }
      }

      if (serverNames.length > 0) {
        if (adapter.capabilities.mcpFormat === "toml") {
          // TOML (Codex)
          const raw = await readFileOrNull(p.mcp);
          if (raw) {
            if (opts.dryRun) {
              dryRunEntries.push({
                file: p.mcp,
                action: "modify",
                detail: `remove ${serverNames.length} MCP server${serverNames.length !== 1 ? "s" : ""}`,
              });
            } else {
              const updated = removeMcpSectionsFromToml(raw, serverNames);
              await writeFileEnsureDir(p.mcp, updated);
              removedCount++;
            }
          }
        } else {
          // JSON (Claude Code, Cursor, Standards, Copilot)
          if (opts.dryRun) {
            if (await exists(p.mcp)) {
              dryRunEntries.push({
                file: p.mcp,
                action: "modify",
                detail: `remove ${serverNames.length} MCP server${serverNames.length !== 1 ? "s" : ""}`,
              });
            }
          } else {
            const result = await removeMcpFromJson(p.mcp, serverNames, adapter.capabilities.mcpRootKey);
            if (result.modified || result.deleted) removedCount++;
          }
        }
      }
    }

    if (dryRunEntries.length > 0) {
      dryRunSections.push({ label: adapter.displayName, entries: dryRunEntries });
    }
  }

  // --- Canonical skills dry-run entries ---
  if (opts.dryRun) {
    const canonicalBase = canonicalSkillBase(target);
    const canonicalEntries: DryRunEntry[] = [];
    for (const skillName of processedCanonicalSkills) {
      const canonicalDir = path.join(canonicalBase, skillName);
      if (await exists(canonicalDir)) {
        canonicalEntries.push({ file: canonicalDir, action: "remove" });
      }
    }
    if (canonicalEntries.length > 0) {
      dryRunSections.push({ label: "Canonical skills", entries: canonicalEntries });
    }
  }
  dirsToClean.add(canonicalSkillBase(target));

  // --- Manifest cleanup ---
  const manifestPath = path.join(target, ".promptpit", "installed.json");
  const remaining = manifest.installs.filter((e) => e.stack !== stackName);

  if (opts.dryRun) {
    const detail = remaining.length === 0 ? "remove file (no stacks remaining)" : "remove entry";
    dryRunSections.push({
      label: "Other",
      entries: [{ file: manifestPath, action: remaining.length === 0 ? "remove" : "modify", detail }],
    });

    printDryRunReport(
      `Dry run — would uninstall ${stackName}@${entry.stackVersion}:`,
      dryRunSections,
      !!opts.verbose,
    );
    return;
  }

  if (remaining.length === 0) {
    await removeFileOrSymlink(manifestPath);
  } else {
    await writeManifest(target, { ...manifest, installs: remaining });
  }

  // --- Empty directory cleanup ---
  for (const dir of dirsToClean) {
    await removeEmptyDir(dir);
  }

  log.success(`Uninstalled ${stackName}@${entry.stackVersion} (${removedCount} artifact${removedCount !== 1 ? "s" : ""} removed)`);
  if (sharedCount > 0) {
    log.info(`${sharedCount} artifact(s) kept (shared with other stacks).`);
  }
  if (modifiedCount > 0) {
    log.info(`${modifiedCount} artifact(s) skipped (modified since install). Use --force to override.`);
  }
}
