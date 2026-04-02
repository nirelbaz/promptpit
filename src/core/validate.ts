import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "../adapters/adapter-utils.js";
import {
  stackManifestSchema,
  mcpConfigSchema,
  skillFrontmatterSchema,
} from "../shared/schema.js";
import { validateEnvNames } from "../core/security.js";
import { readFileOrNull } from "../shared/utils.js";
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

function addDiag(
  diagnostics: Diagnostic[],
  file: string,
  level: "error" | "warning",
  message: string,
): void {
  diagnostics.push({ file, level, message, source: "pit" });
}

export async function validateStack(stackDir: string): Promise<ValidateResult> {
  const diagnostics: Diagnostic[] = [];

  // Fire agnix early so subprocess startup overlaps with file I/O
  const agnixPromise = runAgnix(stackDir);

  // Read all files in parallel
  const skillsDir = path.join(stackDir, "skills");
  const [manifestRaw, agentRaw, skillFiles, mcpRaw, envRaw] = await Promise.all([
    readFileOrNull(path.join(stackDir, "stack.json")),
    readFileOrNull(path.join(stackDir, "agent.promptpit.md")),
    fg("*/SKILL.md", { cwd: skillsDir, absolute: true }).catch(() => [] as string[]),
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

  // --- agnix (optional) ---
  const agnixResult = await agnixPromise;

  const errors = diagnostics.filter((d) => d.level === "error").length
    + agnixResult.diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length
    + agnixResult.diagnostics.filter((d) => d.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    diagnostics,
    agnix: agnixResult,
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
