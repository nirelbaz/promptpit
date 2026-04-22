import path from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import type { ScannedStack } from "../../shared/schema.js";
import { safe } from "../../shared/text.js";
import { homeify, toForwardSlash, describeStackPath } from "../path-display.js";

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

const NAME_WIDTH_MIN = 20;
const NAME_WIDTH_CAP = 40;
const NAME_GAP = 2;
const SUB_INDENT = "       "; // 7 spaces — aligns under name column
const NESTED_SUBPATH_WIDTH = 44;

interface RenderItem {
  stack: ScannedStack;
  /** cwd-relative or `~`-normalized absolute path. `null` when the stack is
   *  the cwd itself (redundant — skip the path line). */
  displayPath: string | null;
}

export function glyphFor(kind: ScannedStack["kind"]): string {
  switch (kind) {
    case "managed":   return "●";
    case "unmanaged": return "○";
    case "global":    return "◉";
  }
}

export function renderStackList(opts: RenderOptions): string {
  const { cwd, stacks, scopeLabel, version = "", filterActive = false } = opts;
  const home = homedir();
  const header = version
    ? `pit ${version} · ${scopeLabel}`
    : `pit · ${scopeLabel}`;

  if (stacks.length === 0) {
    return filterActive
      ? "No stacks match the active filters."
      : renderEmpty(cwd, scopeLabel, home);
  }

  const { local, global } = partition(stacks, cwd, home);
  const nameWidth = computeNameWidth(stacks);
  const lines: string[] = [header, ""];

  for (const item of local) lines.push(...renderRow(item, nameWidth));
  if (global.length > 0) {
    lines.push(chalk.dim("─── global ───"));
    lines.push("");
    for (const item of global) lines.push(...renderRow(item, nameWidth));
  }

  lines.push(...renderLegend());
  return lines.join("\n");
}

function renderEmpty(cwd: string, scope: string, home: string): string {
  return [
    `No AI config found in ${homeify(cwd, home)} or global paths (${scope}).`,
    "",
    "What do you want to do?",
    "  ●  Create a new stack here         (pit init)",
    "  ○  Scan a different path…          (--path)",
    "  ○  Scan everywhere                 (--all)",
    "  ○  Install a stack from GitHub…    (pit install github:…)",
    "  ○  Quit",
  ].join("\n");
}

function partition(
  stacks: ScannedStack[],
  cwd: string,
  home: string,
): { local: RenderItem[]; global: RenderItem[] } {
  const cwdR = path.resolve(cwd);
  const local: Array<{ item: RenderItem; depth: number }> = [];
  const global: RenderItem[] = [];
  for (const s of stacks) {
    if (s.kind === "global") {
      global.push({ stack: s, displayPath: homeify(s.root, home) });
      continue;
    }
    const { display, depth } = describeStackPath(cwdR, s.root, s.name, home);
    local.push({ item: { stack: s, displayPath: display }, depth });
  }
  local.sort(
    (a, b) => a.depth - b.depth || a.item.stack.root.localeCompare(b.item.stack.root),
  );
  return { local: local.map((x) => x.item), global };
}

function computeNameWidth(stacks: ScannedStack[]): number {
  let max = NAME_WIDTH_MIN;
  for (const s of stacks) max = Math.max(max, s.name.length);
  return Math.min(max, NAME_WIDTH_CAP);
}

/** Right column of the header line — status for local rows, path for global
 *  rows (the ◉ glyph + section header already say "global"; no need to repeat). */
function rightColumn(item: RenderItem): string {
  const { stack: s, displayPath } = item;
  if (s.kind === "global") return chalk.dim(safe(displayPath ?? ""));
  if (s.kind === "managed") {
    // `promptpit` is schema-optional regardless of kind — a malformed scan
    // could produce `kind: "managed"` without it. Fall back rather than throw.
    const version = s.promptpit?.stackVersion ?? "?";
    return chalk.cyan(`managed · v${safe(version)}`);
  }
  return chalk.dim("unmanaged");
}

function renderRow(item: RenderItem, nameWidth: number): string[] {
  const { stack: s, displayPath } = item;
  const nameCol = safe(s.name).padEnd(nameWidth) + " ".repeat(NAME_GAP);
  const lines = [`  ${glyphFor(s.kind)}  ${nameCol}${rightColumn(item)}`];

  // Path line only for non-global rows with a non-cwd root — global inlines
  // the path above, cwd root (`displayPath === null`) would just be `.`.
  if (s.kind !== "global" && displayPath !== null) {
    lines.push(chalk.dim(`${SUB_INDENT}${safe(displayPath)}`));
  }

  for (const a of s.adapters) {
    const counts = renderCounts(a.artifacts);
    const drift = a.drift === "drifted" ? chalk.yellow(" drifted") : "";
    lines.push(`${SUB_INDENT}${safe(a.id).padEnd(15)} ${counts}${drift}`);
  }

  // Collapse same-subpath annotations: a nested folder picked up by two
  // adapters (e.g. claude-code + standards) gets one line with a joined list.
  // Set-valued to dedupe duplicate adapterIds from repeated annotations.
  const bySubpath = new Map<string, Set<string>>();
  for (const ann of s.unmanagedAnnotations) {
    const ids = bySubpath.get(ann.subpath) ?? new Set<string>();
    ids.add(safe(ann.adapterId));
    bySubpath.set(ann.subpath, ids);
  }
  for (const [subpath, ids] of bySubpath) {
    const display = toForwardSlash(`./${safe(subpath)}`).padEnd(NESTED_SUBPATH_WIDTH);
    lines.push(chalk.dim(`${SUB_INDENT}└─ ${display}${[...ids].join(", ")}`));
  }

  if (s.unsupportedTools.length > 0) {
    const ids = s.unsupportedTools.map((t) => safe(t)).join(", ");
    lines.push(chalk.dim(`${SUB_INDENT}└─ unsupported: ${ids}`));
  }
  lines.push("");
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

function renderLegend(): string[] {
  return [
    chalk.dim("legend:  ● managed   ○ unmanaged   ◉ global   └─ nested config folded into parent"),
    chalk.dim("         s=skills  a=agents  rules  cmd=commands  mcp  inst=instructions"),
  ];
}
