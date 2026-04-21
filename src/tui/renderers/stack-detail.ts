import chalk from "chalk";
import type { ScannedStack } from "../../shared/schema.js";

export interface DetailOptions {
  driftedArtifactCount?: number;
  installedAtRelative?: string;
  toolsListStr?: string;
}

export function renderStackDetail(s: ScannedStack, opts: DetailOptions = {}): string {
  const head = s.kind === "managed"
    ? `${s.name}  ${s.root}          pit-managed · v${s.promptpit!.stackVersion}`
    : `${s.name}  ${s.root}          ${chalk.dim(s.kind)}`;
  const lines: string[] = [head];
  if (s.kind === "managed") {
    const src = s.promptpit?.source ?? "local (no extends)";
    lines.push(`    source:     ${src}`);
    if (opts.installedAtRelative) {
      const tools = opts.toolsListStr ?? s.adapters.map((a) => a.id).join(", ");
      lines.push(`    installed:  ${opts.installedAtRelative} · ${tools}`);
    }
    if (opts.driftedArtifactCount !== undefined && opts.driftedArtifactCount > 0) {
      lines.push(chalk.yellow(`    drift:      ${opts.driftedArtifactCount} artifacts modified since install`));
    }
  } else {
    const adapters = s.adapters.map((a) => a.id).join(", ") || "(none detected)";
    lines.push(`    detected:   ${adapters}`);
  }
  return lines.join("\n");
}
