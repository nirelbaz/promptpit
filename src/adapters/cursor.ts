import path from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "./adapter-utils.js";
import type {
  PlatformAdapter,
  PlatformConfig,
  DetectionResult,
  WriteResult,
  WriteOptions,
  DryRunEntry,
} from "./types.js";
import type { StackBundle, RuleEntry, RuleFrontmatter } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir, exists } from "../shared/utils.js";
import { readSkillsFromDir, readMcpFromSettings, writeWithMarkers, mergeMcpIntoJson, rethrowPermissionError, markersDryRunEntry, mcpDryRunEntry, fileDryRunEntry, buildInlineContent } from "./adapter-utils.js";

function projectPaths(root: string) {
  return {
    config: path.join(root, ".cursorrules"),
    skills: path.join(root, ".cursor", "skills"),
    mcp: path.join(root, ".cursor", "mcp.json"),
    rules: path.join(root, ".cursor", "rules"),
  };
}

function userPaths() {
  const home = homedir();
  return {
    config: path.join(home, ".cursor", ".cursorrules"),
    skills: path.join(home, ".cursor", "skills"),
    mcp: path.join(home, ".cursor", "mcp.json"),
    rules: path.join(home, ".cursor", "rules"),
  };
}

export function skillToMdc(skillContent: string, _skillName: string): string {
  const parsed = matter(skillContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  const mdcFrontmatter: Record<string, unknown> = {};
  if (fm.description) mdcFrontmatter.description = fm.description;
  if (fm.context) {
    mdcFrontmatter.globs = Array.isArray(fm.context)
      ? fm.context.join(",")
      : fm.context;
  }

  const fmLines = Object.entries(mdcFrontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `---\n${fmLines}\n---\n\n${parsed.content.trim()}\n`;
}

// Translate portable rule format to Cursor .mdc format
export function ruleToMdc(ruleContent: string): string {
  const parsed = matter(ruleContent, SAFE_MATTER_OPTIONS as never);
  const fm = parsed.data as Record<string, unknown>;

  const mdcFm: Record<string, unknown> = {};
  if (fm.description) mdcFm.description = fm.description;
  if (fm.alwaysApply != null) mdcFm.alwaysApply = fm.alwaysApply;
  if (fm.globs) {
    mdcFm.globs = Array.isArray(fm.globs) ? fm.globs.join(", ") : fm.globs;
  }

  return matter.stringify(parsed.content.trim() + "\n", mdcFm);
}

async function detect(root: string): Promise<DetectionResult> {
  const p = projectPaths(root);
  const found: string[] = [];

  if (await exists(p.config)) found.push(p.config);
  if (await exists(p.skills)) found.push(p.skills);
  if (await exists(p.rules)) found.push(p.rules);
  if (await exists(p.mcp)) found.push(p.mcp);

  return { detected: found.length > 0, configPaths: found };
}

async function read(root: string): Promise<PlatformConfig> {
  const p = projectPaths(root);

  const agentInstructions = (await readFileOrNull(p.config)) ?? "";
  const mcpServers = await readMcpFromSettings(p.mcp, "mcpServers");
  const skills = (await exists(p.skills)) ? await readSkillsFromDir(p.skills) : [];

  const rules: RuleEntry[] = [];
  if (await exists(p.rules)) {
    const ruleFiles = await fg("*.{mdc,md}", { cwd: p.rules, absolute: true });
    for (const file of ruleFiles) {
      const raw = await readFileOrNull(file);
      if (!raw) continue;
      // Use default gray-matter parser (not SAFE_MATTER_OPTIONS) because .mdc files
      // are local Cursor configs, not untrusted input, and often contain unquoted
      // glob patterns like **/*.test.ts that JSON_SCHEMA YAML rejects
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(raw);
      } catch {
        continue;
      }
      const ext = path.extname(file);
      const ruleName = path.basename(file, ext);
      // Map Cursor's globs/alwaysApply/description to portable format
      const fm = parsed.data as Record<string, unknown>;
      const portableFm: RuleFrontmatter = {
        name: ruleName,
        description: typeof fm.description === "string" ? fm.description : ruleName,
      };
      if (fm.globs) {
        portableFm.globs = typeof fm.globs === "string" ? fm.globs.split(",").map((g: string) => g.trim()) : fm.globs as string[];
      }
      if (fm.alwaysApply != null) {
        portableFm.alwaysApply = !!fm.alwaysApply;
      }
      rules.push({
        name: ruleName,
        path: `rules/${ruleName}`,
        frontmatter: portableFm,
        content: raw,
      });
    }
  }

  return {
    adapterId: "cursor",
    agentInstructions,
    skills,
    agents: [],
    mcpServers,
    rules,
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
  const dryRunEntries: DryRunEntry[] = [];
  const stackName = stack.manifest.name;
  const version = stack.manifest.version;

  try {
    const content = buildInlineContent(stack.agentInstructions, stack.agents);
    if (content) {
      const result = await writeWithMarkers(
        p.config,
        content,
        stackName,
        version,
        "cursor",
        opts.dryRun,
      );
      if (result.written) filesWritten.push(result.written);
      if (opts.dryRun) {
        dryRunEntries.push(markersDryRunEntry(p.config, result, opts.verbose));
      }
    }

    for (const skill of stack.skills) {
      const mdcContent = skillToMdc(skill.content, skill.name);
      const dest = path.join(p.rules!, `${skill.name}.mdc`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .mdc"));
      } else {
        await writeFileEnsureDir(dest, mdcContent);
        filesWritten.push(dest);
      }
    }

    for (const rule of stack.rules) {
      const prefixedName = rule.name.startsWith("rule-") ? rule.name : `rule-${rule.name}`;
      const dest = path.join(p.rules!, `${prefixedName}.mdc`);
      if (opts.dryRun) {
        dryRunEntries.push(fileDryRunEntry(dest, await exists(dest), "translate to .mdc"));
      } else {
        const mdcContent = ruleToMdc(rule.content);
        await writeFileEnsureDir(dest, mdcContent);
        filesWritten.push(dest);
      }
    }

    const mcpResult = await mergeMcpIntoJson(p.mcp, stack.mcpServers, warnings, opts.dryRun);
    if (mcpResult.written) filesWritten.push(mcpResult.written);
    const mcpCount = Object.keys(stack.mcpServers).length;
    if (opts.dryRun && mcpCount > 0) {
      dryRunEntries.push(mcpDryRunEntry(p.mcp, mcpCount, mcpResult, opts.verbose));
    }
  } catch (err: unknown) {
    rethrowPermissionError(err, !!opts.global, "Cursor paths");
  }

  return { filesWritten, filesSkipped: [], warnings, ...(opts.dryRun && { dryRunEntries }) };
}

export const cursorAdapter: PlatformAdapter = {
  id: "cursor",
  displayName: "Cursor",
  paths: { project: projectPaths, user: userPaths },
  capabilities: {
    skillLinkStrategy: "translate-copy",
    rules: true,
    skillFormat: "mdc",
    mcpStdio: true,
    mcpRemote: true,
    mcpFormat: "json",
    mcpRootKey: "mcpServers",
    agentsmd: true,
    hooks: false,
    agents: "inline",
  },
  detect,
  read,
  write,
};
