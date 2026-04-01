import path from "node:path";
import matter from "gray-matter";
import { SAFE_MATTER_OPTIONS } from "../adapters/adapter-utils.js";
import {
  stackManifestSchema,
  mcpConfigSchema,
  skillFrontmatterSchema,
  isDangerousEnvName,
} from "../shared/schema.js";
import { readFileOrNull } from "../shared/utils.js";
import fg from "fast-glob";

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

  // --- stack.json (required) ---
  const manifestPath = path.join(stackDir, "stack.json");
  const manifestRaw = await readFileOrNull(manifestPath);
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
          addDiag(
            diagnostics,
            "stack.json",
            "error",
            `${issue.path.join(".")}: ${issue.message}`,
          );
        }
      }
    }
  }

  // --- agent.promptpit.md (optional) ---
  const agentPath = path.join(stackDir, "agent.promptpit.md");
  const agentRaw = await readFileOrNull(agentPath);
  if (agentRaw) {
    try {
      matter(agentRaw, SAFE_MATTER_OPTIONS as never);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      addDiag(diagnostics, "agent.promptpit.md", "error", `Invalid frontmatter: ${msg}`);
    }
  }

  // --- skills/*/SKILL.md (optional) ---
  const skillsDir = path.join(stackDir, "skills");
  const skillFiles = await fg("*/SKILL.md", { cwd: skillsDir, absolute: true }).catch(
    () => [] as string[],
  );
  for (const file of skillFiles) {
    const skillName = path.basename(path.dirname(file));
    const relPath = `skills/${skillName}/SKILL.md`;
    const raw = await readFileOrNull(file);
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
  const mcpPath = path.join(stackDir, "mcp.json");
  const mcpRaw = await readFileOrNull(mcpPath);
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
          addDiag(
            diagnostics,
            "mcp.json",
            "error",
            `${issue.path.join(".")}: ${issue.message}`,
          );
        }
      }
    }
  }

  // --- .env.example (optional, warnings only) ---
  const envPath = path.join(stackDir, ".env.example");
  const envRaw = await readFileOrNull(envPath);
  if (envRaw) {
    for (const line of envRaw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const name = trimmed.slice(0, eqIdx);
        if (isDangerousEnvName(name)) {
          addDiag(diagnostics, ".env.example", "warning", `Dangerous env name: ${name}`);
        }
      }
    }
  }

  // --- agnix (optional, implemented in Task 4) ---
  const agnixResult = await runAgnix(stackDir);

  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings: warnings + agnixResult.diagnostics.filter((d) => d.level === "warning").length,
    diagnostics,
    agnix: agnixResult,
  };
}

// Placeholder — implemented in Task 4
async function runAgnix(_stackDir: string): Promise<ValidateResult["agnix"]> {
  return { available: false, diagnostics: [] };
}
