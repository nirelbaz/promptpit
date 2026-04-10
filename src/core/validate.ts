import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS, inferAgentDefaults, inferRuleDefaults } from "../adapters/adapter-utils.js";
import {
  stackManifestSchema,
  mcpConfigSchema,
  skillFrontmatterSchema,
  agentFrontmatterSchema,
  ruleFrontmatterSchema,
  commandFrontmatterSchema,
} from "../shared/schema.js";
import { validateEnvNames } from "../core/security.js";
import { readFileOrNull } from "../shared/utils.js";
import { parseGitHubSource } from "../sources/github.js";
import fg from "fast-glob";

const execFileAsync = promisify(execFileCb);

export interface Diagnostic {
  file: string;
  level: "error" | "warning";
  message: string;
  source: "pit" | "agnix";
  rule?: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
  agnix: {
    available: boolean;
    diagnostics: Diagnostic[];
  };
}

/** Instruction files larger than this (in bytes) trigger a size warning (~15 KB). */
export const LARGE_INSTRUCTION_THRESHOLD = 15_000;

function addDiag(
  diagnostics: Diagnostic[],
  file: string,
  level: "error" | "warning",
  message: string,
): void {
  diagnostics.push({ file, level, message, source: "pit" });
}

// Claude-Code-specific agnix rules that only apply to Claude-origin agents.
// CC-AG-003: model must be a valid Claude model name
// CC-AG-009: tools must be valid Claude Code tool names
export const CLAUDE_AGENT_RULES = new Set(["CC-AG-003", "CC-AG-009"]);

export async function validateStack(stackDir: string): Promise<ValidateResult> {
  const diagnostics: Diagnostic[] = [];
  let compatibility: string[] | undefined;
  let manifest: { extends?: string[]; instructionStrategy?: string } | undefined;

  // Fire agnix early so subprocess startup overlaps with file I/O
  const agnixPromise = runAgnix(stackDir);

  // Read all files in parallel
  const skillsDir = path.join(stackDir, "skills");
  const agentsDir = path.join(stackDir, "agents");
  const rulesDir = path.join(stackDir, "rules");
  const commandsDir = path.join(stackDir, "commands");
  const [manifestRaw, agentRaw, skillFiles, agentFiles, ruleFiles, commandFiles, mcpRaw, envRaw] = await Promise.all([
    readFileOrNull(path.join(stackDir, "stack.json")),
    readFileOrNull(path.join(stackDir, "agent.promptpit.md")),
    fg("*/SKILL.md", { cwd: skillsDir, absolute: true }).catch(() => [] as string[]),
    fg("*.md", { cwd: agentsDir, absolute: true }).catch(() => [] as string[]),
    fg("*.md", { cwd: rulesDir, absolute: true }).catch(() => [] as string[]),
    fg("**/*.md", { cwd: commandsDir, absolute: true }).catch(() => [] as string[]),
    readFileOrNull(path.join(stackDir, "mcp.json")),
    readFileOrNull(path.join(stackDir, ".env.example")),
  ]);

  // --- stack.json (required) ---
  if (!manifestRaw) {
    addDiag(diagnostics, "stack.json", "error", "File not found (required)");
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestRaw);
    } catch {
      addDiag(diagnostics, "stack.json", "error", "Invalid JSON");
    }
    if (parsed !== undefined) {
      const result = stackManifestSchema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(diagnostics, "stack.json", "error", `${issue.path.join(".")}: ${issue.message}`);
        }
      } else {
        compatibility = result.data.compatibility;
        manifest = result.data;
      }
    }
  }

  // --- agent.promptpit.md (optional) ---
  if (agentRaw) {
    try {
      matter(agentRaw, SAFE_MATTER_OPTIONS as never);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, "agent.promptpit.md", "error", `Invalid frontmatter: ${msg}`);
    }
    const sizeBytes = Buffer.byteLength(agentRaw, "utf-8");
    if (sizeBytes > LARGE_INSTRUCTION_THRESHOLD) {
      const sizeKB = (sizeBytes / 1024).toFixed(1);
      addDiag(
        diagnostics,
        "agent.promptpit.md",
        "warning",
        `Instruction file is unusually large (${sizeKB} KB). Files over ${Math.round(LARGE_INSTRUCTION_THRESHOLD / 1024)} KB consume significant context window space. Consider splitting into rules or skills.`,
      );
    }
  }

  // --- skills/*/SKILL.md (optional) ---
  const skillContents = await Promise.all(
    skillFiles.map(async (file) => ({
      file,
      skillName: path.basename(path.dirname(file)),
      raw: await readFileOrNull(file),
    })),
  );
  for (const { skillName, raw } of skillContents) {
    const relPath = `skills/${skillName}/SKILL.md`;
    if (!raw) continue;
    try {
      const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
      const result = skillFrontmatterSchema.safeParse(parsed.data);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(diagnostics, relPath, "error", `${issue.path.join(".")}: ${issue.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, relPath, "error", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- agents/*.md (optional) ---
  const agentContents = await Promise.all(
    agentFiles.map(async (file) => ({
      file,
      agentName: path.basename(file, ".md"),
      raw: await readFileOrNull(file),
    })),
  );
  for (const { agentName, raw } of agentContents) {
    const relPath = `agents/${agentName}.md`;
    if (!raw) continue;
    try {
      const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
      const data = inferAgentDefaults(parsed.data as Record<string, unknown>, agentName, parsed.content);
      const result = agentFrontmatterSchema.safeParse(data);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(diagnostics, relPath, "error", `${issue.path.join(".")}: ${issue.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, relPath, "error", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- rules/*.md (optional) ---
  const ruleContents = await Promise.all(
    ruleFiles.map(async (file) => ({
      file,
      ruleName: path.basename(file, ".md"),
      raw: await readFileOrNull(file),
    })),
  );
  for (const { ruleName, raw } of ruleContents) {
    const relPath = `rules/${ruleName}.md`;
    if (!raw) continue;
    try {
      const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
      const dataWithName = inferRuleDefaults(parsed.data as Record<string, unknown>, ruleName);
      const result = ruleFrontmatterSchema.safeParse(dataWithName);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(diagnostics, relPath, "error", `${issue.path.join(".")}: ${issue.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, relPath, "error", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- commands/**/*.md (optional, warnings only) ---
  const commandContents = await Promise.all(
    commandFiles.map(async (file) => ({
      file,
      relPath: path.relative(commandsDir, file),
      raw: await readFileOrNull(file),
    })),
  );
  for (const { relPath, raw } of commandContents) {
    const displayPath = `commands/${relPath}`;
    if (!raw) continue;
    try {
      const parsed = matter(raw, SAFE_MATTER_OPTIONS as never);
      if (Object.keys(parsed.data).length > 0) {
        const result = commandFrontmatterSchema.safeParse(parsed.data);
        if (!result.success) {
          for (const issue of result.error.issues) {
            addDiag(diagnostics, displayPath, "warning", `Frontmatter: ${issue.path.join(".")}: ${issue.message}`);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, displayPath, "warning", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- mcp.json (optional) ---
  if (mcpRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mcpRaw);
    } catch {
      addDiag(diagnostics, "mcp.json", "error", "Invalid JSON");
    }
    if (parsed !== undefined) {
      const result = mcpConfigSchema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          addDiag(diagnostics, "mcp.json", "error", `${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }
  }

  // --- .env.example (optional, warnings only) ---
  if (envRaw) {
    const envVars: Record<string, string> = {};
    for (const line of envRaw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
    for (const name of validateEnvNames(envVars)) {
      addDiag(diagnostics, ".env.example", "warning", `Dangerous env name: ${name}`);
    }
  }

  // --- extends entries (syntax only, no resolution) ---
  if (manifest?.extends) {
    const seen = new Set<string>();
    for (const entry of manifest.extends) {
      if (seen.has(entry)) {
        addDiag(diagnostics, "stack.json", "warning", `Duplicate extends entry: "${entry}"`);
      }
      seen.add(entry);

      const gh = parseGitHubSource(entry);
      if (!gh && !entry.startsWith(".") && !entry.startsWith("/")) {
        addDiag(
          diagnostics,
          "stack.json",
          "warning",
          `Extends entry "${entry}" is not a recognized format. ` +
          `Expected github:owner/repo[@ref] or a relative/absolute path.`,
        );
      }
    }
  }

  // --- instructionStrategy without extends ---
  if (manifest?.instructionStrategy && (!manifest.extends || manifest.extends.length === 0)) {
    addDiag(
      diagnostics,
      "stack.json",
      "warning",
      `instructionStrategy "${manifest.instructionStrategy}" is set but extends is empty — it has no effect.`,
    );
  }

  // --- agnix (optional) ---
  const agnixResult = await agnixPromise;

  // Suppress Claude-specific agent rules for multi-platform stacks.
  // A stack is Claude-only when compatibility is explicitly ["claude-code"].
  // Otherwise (multi-platform or undeclared), these rules produce false positives
  // on agents with Copilot/Codex-native tool and model names.
  const isClaudeOnly = compatibility?.length === 1 && compatibility[0] === "claude-code";
  const filteredAgnix: ValidateResult["agnix"] = !isClaudeOnly
    ? {
        available: agnixResult.available,
        diagnostics: agnixResult.diagnostics.filter(
          (d) => !(d.rule && CLAUDE_AGENT_RULES.has(d.rule) && d.file.startsWith("agents/")),
        ),
      }
    : agnixResult;

  const errors = diagnostics.filter((d) => d.level === "error").length
    + filteredAgnix.diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length
    + filteredAgnix.diagnostics.filter((d) => d.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    diagnostics,
    agnix: filteredAgnix,
  };
}

export function mapAgnixDiagnostic(d: {
  level: string;
  rule?: string;
  file: string;
  message: string;
}): Diagnostic {
  return {
    file: d.file,
    level: d.level === "error" ? "error" : "warning",
    message: d.message,
    source: "agnix",
    rule: d.rule,
  };
}

async function execAgnix(bin: string, stackDir: string) {
  return execFileAsync(bin, ["--format", "json", "validate", stackDir], {
    timeout: 15_000,
  }).catch((err: { stdout?: string; stderr?: string }) => {
    // agnix exits 1 on validation errors but still outputs JSON to stdout
    if (err.stdout) return { stdout: err.stdout, stderr: err.stderr ?? "" };
    throw err;
  });
}

async function runAgnix(stackDir: string): Promise<ValidateResult["agnix"]> {
  // Try local install first, fall back to global (bare name resolved via PATH)
  const localBin = path.resolve("node_modules", ".bin", "agnix");
  let stdout: string;
  try {
    ({ stdout } = await execAgnix(localBin, stackDir));
  } catch {
    try {
      ({ stdout } = await execAgnix("agnix", stackDir));
    } catch {
      return { available: false, diagnostics: [] };
    }
  }

  try {
    const parsed = JSON.parse(stdout);
    if (!parsed.diagnostics || !Array.isArray(parsed.diagnostics)) {
      return { available: true, diagnostics: [] };
    }
    const diagnostics: Diagnostic[] = parsed.diagnostics.map(mapAgnixDiagnostic);
    return { available: true, diagnostics };
  } catch {
    // JSON parse failed — skip gracefully
    return { available: false, diagnostics: [] };
  }
}
