import path from "node:path";
import { homedir } from "node:os";
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

const NAME_WIDTH_MIN = 20;
const NAME_WIDTH_CAP = 40;
const NAME_GAP = 2;
const SUB_INDENT = "       "; // 7 spaces — aligns under name column
const NESTED_SUBPATH_WIDTH = 44;
const OUTSIDE_CWD_DEPTH = Number.POSITIVE_INFINITY;

// Strip control characters (including ANSI CSI sequences, carriage returns,
// backspace, bell) from author-controlled strings before rendering. Bundle
// manifests, adapter ids, and subpaths come from untrusted GitHub sources —
// without this, a malicious name like `evil\x1b[2J` could clear the user's
// terminal or overwrite lines to spoof managed/drift status.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;
function safe(s: string): string {
  return s.replace(CONTROL_CHARS_RE, "");
}

/** Normalize path separators for display. On Windows, `path.relative` and
 *  `path.sep` produce `\`-separated paths; mixing them with the `./` prefix
 *  and the trailing `/` we append looks ugly (`.\foo\bar/`). Show forward
 *  slashes everywhere in the UI, regardless of OS. */
function toDisplaySeparator(p: string): string {
  return path.sep === "\\" ? p.replace(/\\/g, "/") : p;
}

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
    const { display, depth } = describePath(cwdR, s.root, home, s.name);
    local.push({ item: { stack: s, displayPath: display }, depth });
  }
  local.sort(
    (a, b) => a.depth - b.depth || a.item.stack.root.localeCompare(b.item.stack.root),
  );
  return { local: local.map((x) => x.item), global };
}

/** Compute how a stack root presents relative to cwd. Returns `display = null`
 *  when the path would be redundant with the stack name (either root === cwd,
 *  or the single-segment path is just the stack name). */
function describePath(
  cwdR: string,
  root: string,
  home: string,
  name: string,
): { display: string | null; depth: number } {
  const rootR = path.resolve(root);
  if (rootR === cwdR) return { display: null, depth: 0 };
  const rel = path.relative(cwdR, rootR);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const segs = rel.split(path.sep);
    const depth = segs.length;
    // The last segment almost always matches the stack name (stack names
    // default to the folder basename), so repeating it next to the name
    // column adds no info. Drop it and keep a trailing "/" to signal "inside
    // this directory". Hide entirely when the whole path is just the name.
    if (segs[segs.length - 1] === name) {
      if (segs.length === 1) return { display: null, depth };
      return {
        display: toDisplaySeparator(`./${segs.slice(0, -1).join(path.sep)}/`),
        depth,
      };
    }
    return { display: toDisplaySeparator(`./${rel}`), depth };
  }
  // Ancestor or sibling of cwd — show `~`-normalized absolute to avoid
  // confusing `../../foo` paths and keep ordering after all nested rows.
  return { display: homeify(rootR, home), depth: OUTSIDE_CWD_DEPTH };
}

/** Replace `$HOME` prefix with `~`. Shorter, platform-neutral, doesn't leak
 *  usernames in screenshots or bug reports. */
function homeify(p: string, home: string): string {
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
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
    const display = toDisplaySeparator(`./${safe(subpath)}`).padEnd(NESTED_SUBPATH_WIDTH);
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
