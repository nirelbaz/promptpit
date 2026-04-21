import { homedir } from "node:os";
import path from "node:path";
import { scan } from "../core/scan.js";
import { loadConfig } from "../core/config.js";
import { log } from "../shared/io.js";
import { renderStackList, glyphFor } from "../tui/renderers/stack-list.js";
import type { ScannedStack } from "../shared/schema.js";

export interface LsOptions {
  scope?: "current" | "global";
  global?: boolean;
  path?: string;
  deep?: boolean;
  all?: boolean;
  managed?: boolean;
  unmanaged?: boolean;
  drifted?: boolean;
  kind?: "global" | "project";
  short?: boolean;
  json?: boolean;
  strict?: boolean;
}

const GLOBAL_ROOTS = [
  path.join(homedir(), ".claude"),
  path.join(homedir(), ".cursor"),
  path.join(homedir(), ".codex"),
  path.join(homedir(), ".github"),
  path.join(homedir(), ".agents", "skills"),
];

export async function lsCommand(cwd: string, opts: LsOptions): Promise<number> {
  if (opts.managed && opts.unmanaged) {
    throw new Error("--managed and --unmanaged are mutually exclusive");
  }

  const cfg = await loadConfig(homedir(), { silent: true });
  const defaultDepth = cfg.scan.defaultDepth;

  const scanRoot = opts.path ? path.resolve(opts.path) : cwd;
  const depth = opts.deep || opts.all ? Number.POSITIVE_INFINITY : defaultDepth;
  const includeGlobal =
    opts.scope === "global" || (opts.scope !== "current" && opts.global !== false);

  if ((opts.all || opts.deep) && !opts.json && !opts.short) {
    const what = opts.all ? "your whole home directory" : "this tree with no depth limit";
    log.info(`Scanning ${what} — this can take a minute on large trees.`);
  }

  // Silence per-file parse warnings during the read-only artifact count —
  // they belong to `pit validate`, not `pit ls`. Summarize the count below.
  const { result: stacks, suppressed } = await log.withMutedWarnings(() =>
    scan({
      cwd: opts.all ? homedir() : scanRoot,
      globalRoots: includeGlobal ? GLOBAL_ROOTS : [],
      depth,
      ignoreGlobs: cfg.scan.ignore,
      skipLocal: opts.scope === "global",
    }),
  );

  const filtered = applyFilters(stacks, opts);
  const filterActive = !!(opts.managed || opts.unmanaged || opts.drifted || opts.kind);
  const exitCode = opts.strict && filtered.some((s) => s.overallDrift === "drifted") ? 1 : 0;

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return exitCode;
  }

  if (opts.short) {
    if (filterActive && filtered.length === 0) {
      console.error("No stacks match the active filters.");
      return exitCode;
    }
    for (const s of filtered) {
      const glyph = glyphFor(s.kind);
      const version = s.kind === "managed" ? ` · v${s.promptpit!.stackVersion}` : "";
      const drift = s.overallDrift === "drifted" ? " · drifted" : "";
      console.log(`${glyph}  ${s.name}  ${s.root}${version}${drift}`);
    }
    return exitCode;
  }

  const scopeLabel = describeScope(opts, defaultDepth);
  console.log(renderStackList({ cwd, stacks: filtered, scopeLabel, filterActive }));
  if (suppressed > 0) {
    log.info(
      `${suppressed} config file${suppressed === 1 ? "" : "s"} had parse issues — run \`pit validate\` for details.`,
    );
  }
  return exitCode;
}

function applyFilters(stacks: ScannedStack[], opts: LsOptions): ScannedStack[] {
  let out = stacks;
  if (opts.managed) out = out.filter((s) => s.kind === "managed");
  if (opts.unmanaged) out = out.filter((s) => s.kind === "unmanaged");
  if (opts.drifted) out = out.filter((s) => s.overallDrift === "drifted");
  if (opts.kind === "global") out = out.filter((s) => s.kind === "global");
  if (opts.kind === "project") out = out.filter((s) => s.kind !== "global");
  return out;
}

function describeScope(opts: LsOptions, depth: number): string {
  if (opts.all) return "whole machine (~, deep)";
  if (opts.path) return `${opts.path} (depth ${opts.deep ? "∞" : depth})`;
  if (opts.scope === "global") return "global only";
  if (opts.scope === "current") return `current tree (depth ${opts.deep ? "∞" : depth})`;
  return `current tree (depth ${opts.deep ? "∞" : depth}) + global`;
}
