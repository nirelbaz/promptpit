import chalk from "chalk";
import { validateStack, type ValidateResult, type Diagnostic } from "../core/validate.js";
import { log } from "../shared/io.js";

export interface ValidateOptions {
  json?: boolean;
}

export class ExitError extends Error {
  constructor() {
    super("Validation failed");
    this.name = "ExitError";
  }
}

function statusIcon(level: "pass" | "error" | "warning"): string {
  switch (level) {
    case "pass": return chalk.green("✓");
    case "error": return chalk.red("✖");
    case "warning": return chalk.yellow("⚠");
  }
}

function fileStatus(file: string, diagnostics: Diagnostic[]): void {
  const fileDiags = diagnostics.filter((d) => d.file === file);
  const hasError = fileDiags.some((d) => d.level === "error");
  const hasWarning = fileDiags.some((d) => d.level === "warning");

  if (hasError) {
    const msgs = fileDiags
      .filter((d) => d.level === "error")
      .map((d) => d.message)
      .join("; ");
    console.log(`  ${statusIcon("error")} ${file} ${chalk.red("— " + msgs)}`);
  } else if (hasWarning) {
    const msgs = fileDiags.map((d) => d.message).join("; ");
    console.log(`  ${statusIcon("warning")} ${file} ${chalk.yellow("— " + msgs)}`);
  } else {
    console.log(`  ${statusIcon("pass")} ${file}`);
  }
}

function formatHuman(result: ValidateResult, stackDir: string): void {
  console.log();
  console.log(`Validating ${stackDir} ...`);
  console.log();

  const filesWithDiags = new Set(result.diagnostics.map((d) => d.file));
  const displayFiles = [
    "stack.json",
    "agent.promptpit.md",
    ...[...filesWithDiags].filter((f) => f.startsWith("skills/")).sort(),
    "mcp.json",
    ".env.example",
  ];

  const shownFiles = new Set(displayFiles);
  for (const file of displayFiles) {
    if (file === "stack.json" || filesWithDiags.has(file)) {
      fileStatus(file, result.diagnostics);
    }
  }
  for (const file of filesWithDiags) {
    if (!shownFiles.has(file)) {
      fileStatus(file, result.diagnostics);
    }
  }

  // agnix section
  if (result.agnix.available) {
    const agnixErrors = result.agnix.diagnostics.filter((d) => d.level === "error").length;
    const agnixWarnings = result.agnix.diagnostics.filter((d) => d.level === "warning").length;
    const passed = result.agnix.diagnostics.length === 0;
    if (passed) {
      console.log(`  ${statusIcon("pass")} agnix ${chalk.dim("— all checks passed")}`);
    } else {
      const parts: string[] = [];
      if (agnixErrors > 0) parts.push(`${agnixErrors} error${agnixErrors === 1 ? "" : "s"}`);
      if (agnixWarnings > 0) parts.push(`${agnixWarnings} warning${agnixWarnings === 1 ? "" : "s"}`);
      console.log(`  ${statusIcon(agnixErrors > 0 ? "error" : "warning")} agnix — ${parts.join(", ")}`);
      for (const d of result.agnix.diagnostics) {
        const icon = d.level === "error" ? statusIcon("error") : statusIcon("warning");
        const rule = d.rule ? `${d.rule}: ` : "";
        console.log(`    ${icon} ${rule}${d.message} (${d.file})`);
      }
    }
  } else {
    console.log();
    console.log(chalk.dim("  💡 Tip: install agnix for 385+ adapter-specific checks (npm i -D agnix)"));
  }

  // Summary
  console.log();
  if (result.valid) {
    log.success(`${stackDir} is valid`);
  } else {
    const parts: string[] = [];
    if (result.errors > 0) parts.push(`${result.errors} error${result.errors === 1 ? "" : "s"}`);
    if (result.warnings > 0) parts.push(`${result.warnings} warning${result.warnings === 1 ? "" : "s"}`);
    log.error(parts.join(", "));
  }
  console.log();
}

function formatJson(result: ValidateResult): void {
  console.log(JSON.stringify(result, null, 2));
}

export async function validateCommand(
  stackDir: string,
  opts: ValidateOptions,
): Promise<void> {
  const result = await validateStack(stackDir);

  if (opts.json) {
    formatJson(result);
  } else {
    formatHuman(result, stackDir);
  }

  if (!result.valid) {
    throw new ExitError();
  }
}
