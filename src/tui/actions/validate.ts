import path from "node:path";
import { note } from "@clack/prompts";
import type { ActionContext } from "../stack-menu.js";
import { validateStack } from "../../core/validate.js";
import { log } from "../../shared/io.js";

export async function validateAction(ctx: ActionContext): Promise<void> {
  if (ctx.stack.kind !== "managed") {
    log.info("Validate only applies to pit-managed stacks. This stack has no .promptpit/.");
    return;
  }
  const stackDir = path.join(ctx.stack.root, ".promptpit");
  const result = await validateStack(stackDir);
  const head = result.valid
    ? "✓ Valid"
    : `✖ ${result.errors} error(s), ${result.warnings} warning(s)`;
  const body =
    result.diagnostics
      .map((d) => `${d.level.toUpperCase()} ${d.file}: ${d.message}`)
      .join("\n") || "(no diagnostics)";
  note(`${head}\n\n${body}`);
}
