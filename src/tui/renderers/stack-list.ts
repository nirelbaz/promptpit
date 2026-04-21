import path from "node:path";
import chalk from "chalk";
import type { ScannedStack } from "../../shared/schema.js";

export interface RenderOptions {
  cwd: string;
  stacks: ScannedStack[];
  scopeLabel: string;
  version?: string;
  /** When true, an empty `stacks` array reflects active filters masking
   *  otherwise-valid results — not an empty tree. Changes the empty message
   *  from the onboarding card to a one-line "no match" notice. */
  filterActive?: boolean;
}

const DIVIDER = "─".repeat(65);

export function glyphFor(kind: ScannedStack["kind"]): string {
  switch (kind) {
    case "managed":   return "●";
    case "unmanaged": return "○";
    case "global":    return "◉";
  }
}

export function renderStackList(opts: RenderOptions): string {
  const { cwd, stacks, scopeLabel, version = "", filterActive = false } = opts;
  const header = version
    ? `pit ${version} · scope: ${scopeLabel}`
    : `pit · scope: ${scopeLabel}`;

  if (stacks.length === 0) {
    return filterActive
      ? "No stacks match the active filters."
      : renderEmpty(cwd, scopeLabel);
  }

  const grouped = group(stacks, cwd);
  const lines: string[] = [header, DIVIDER];
  for (const [groupLabel, rows] of grouped) {
    lines.push("");
    lines.push(chalk.dim(`  ${groupLabel}`));
    for (const s of rows) lines.push(...renderRow(s));
  }
  lines.push(DIVIDER);
  lines.push(
    chalk.dim("  legend:  s=skills  a=agents  rules  cmd=commands  mcp  inst=instructions file"),
  );
  return lines.join("\n");
}

function renderEmpty(cwd: string, scope: string): string {
  return [
    `No AI config found in ${cwd} or global paths (${scope}).`,
    "",
    "What do you want to do?",
    "  ●  Create a new stack here         (pit init)",
    "  ○  Scan a different path…          (--path)",
    "  ○  Scan everywhere                 (--all)",
    "  ○  Install a stack from GitHub…    (pit install github:…)",
    "  ○  Quit",
  ].join("\n");
}

function group(stacks: ScannedStack[], cwd: string): Array<[string, ScannedStack[]]> {
  const groups = new Map<string, ScannedStack[]>();
  const cwdR = path.resolve(cwd);
  for (const s of stacks) {
    const rootR = path.resolve(s.root);
    const label =
      s.kind === "global" ? "global" :
      (rootR === cwdR || rootR.startsWith(cwdR + path.sep))
        ? `current folder (${s.root})` :
      path.dirname(s.root);
    const arr = groups.get(label) ?? [];
    arr.push(s);
    groups.set(label, arr);
  }

  const entries = [...groups.entries()];
  entries.sort(([a], [b]) => {
    if (a.startsWith("current")) return -1;
    if (b.startsWith("current")) return 1;
    if (a === "global") return 1;
    if (b === "global") return -1;
    return a.localeCompare(b);
  });
  return entries;
}

function renderRow(s: ScannedStack): string[] {
  const glyph = glyphFor(s.kind);
  const status =
    s.kind === "managed" ? chalk.cyan(`pit-managed · v${s.promptpit!.stackVersion}`) :
    s.kind === "unmanaged" ? chalk.dim("unmanaged") :
    chalk.dim(s.root);

  const nameCol = s.name.padEnd(30);
  const lines = [`  ${glyph}  ${nameCol}${status}`];

  for (const a of s.adapters) {
    const counts = renderCounts(a.artifacts);
    const drift = a.drift === "drifted" ? chalk.yellow(" drifted") : "";
    lines.push(`     ${a.id.padEnd(15)} ${counts}${drift}`);
  }
  for (const ann of s.unmanagedAnnotations) {
    lines.push(chalk.dim(`     + ${ann.subpath.padEnd(20)} unmanaged  ${ann.adapterId}`));
  }
  // `unsupportedTools` is defaulted by the zod schema to [], but callers
  // constructing ScannedStack directly (tests, early TUI code paths) may
  // not provide it — guard against undefined.
  if (s.unsupportedTools && s.unsupportedTools.length > 0) {
    lines.push(chalk.dim(`     + unsupported: ${s.unsupportedTools.join(", ")}`));
  }
  return lines;
}

function renderCounts(a: ScannedStack["adapters"][number]["artifacts"]): string {
  const parts: string[] = [];
  if (a.skills) parts.push(`${a.skills}s`);
  if (a.agents) parts.push(`${a.agents}a`);
  if (a.rules) parts.push(`${a.rules} rules`);
  if (a.commands) parts.push(`${a.commands} cmd`);
  if (a.mcp) parts.push(`${a.mcp} mcp`);
  if (a.instructions) parts.push("inst");
  return parts.join(" · ");
}
