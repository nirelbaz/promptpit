import { note } from "@clack/prompts";
import type { ActionContext } from "../stack-menu.js";
import { reconcileAll } from "../../core/reconcile.js";
import { computeDiff } from "../../commands/diff.js";

export async function statusDiffAction(ctx: ActionContext): Promise<void> {
  if (ctx.stack.kind !== "managed") {
    note("Status & diff only applies to pit-managed stacks.");
    return;
  }

  const reconciled = await reconcileAll(ctx.stack.root);
  const diff = await computeDiff(ctx.stack.root, {});

  const lines: string[] = [];
  for (const s of reconciled.stacks) {
    lines.push(`${s.stack}@${s.version}  ${s.overallState}`);
    for (const a of s.adapters) {
      const drifted = a.artifacts.filter((x) => x.state === "drifted").length;
      lines.push(`  ${a.adapterId}  ${a.state}  (${drifted} drifted)`);
    }
  }
  lines.push("");
  if (diff.hasDrift) {
    const totalDriftedArtifacts = diff.stacks.reduce(
      (n, s) => n + s.adapters.reduce((m, a) => m + a.artifacts.length, 0),
      0,
    );
    lines.push(`${totalDriftedArtifacts} drifted artifact(s)`);
  } else {
    lines.push("All in sync.");
  }
  note(lines.join("\n"));
}
