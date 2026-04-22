// Scan state hoisted above NavProvider so it survives push/pop. When the
// user dives into StackDetail → StatusDiff and returns, MainList remounts
// but the scan result, scope choice, and cursor position are preserved.
// Rescans are explicit (press `r` or pick a new scope) rather than
// automatic on every return trip.
import path from "node:path";
import { homedir } from "node:os";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { scan } from "../core/scan.js";
import { loadConfig } from "../core/config.js";
import { log } from "../shared/io.js";
import { errorMessage } from "../shared/utils.js";
import type { ScannedStack, PitConfig } from "../shared/schema.js";
import type { ScopeChoice } from "./screens/scope-picker.js";

const GLOBAL_ROOTS = [
  path.join(homedir(), ".claude"),
  path.join(homedir(), ".cursor"),
  path.join(homedir(), ".codex"),
  path.join(homedir(), ".github"),
  path.join(homedir(), ".agents", "skills"),
];

const DEEP_SCAN_DEPTH = 8;

export type ScanState =
  | { kind: "loading" }
  | { kind: "ready"; stacks: ScannedStack[]; suppressed: number; config: PitConfig }
  | { kind: "error"; message: string };

export interface ScanApi {
  cwd: string;
  state: ScanState;
  scope: ScopeChoice;
  cursor: number;
  setCursor: (c: number | ((prev: number) => number)) => void;
  setScope: (c: ScopeChoice) => void;
  /** Trigger a rescan with the current scope. Used by `r` keybind. */
  rescan: () => void;
}

const ScanContext = createContext<ScanApi | null>(null);

export function scopeLabel(scope: ScopeChoice, defaultDepth: number): string {
  switch (scope) {
    case "current": return `current tree (depth ${defaultDepth}) + global`;
    case "global":  return "global only";
    case "all":     return `everywhere (depth ${DEEP_SCAN_DEPTH})`;
    case "path":    return "specific path";
  }
}

export function ScanProvider({ cwd, children }: { cwd: string; children: ReactNode }) {
  const [state, setState] = useState<ScanState>({ kind: "loading" });
  const [scope, setScopeRaw] = useState<ScopeChoice>("current");
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.kind === "loading" ? prev : { kind: "loading" }));
    (async () => {
      const config = await loadConfig(homedir(), { silent: true });
      const globalRoots = config.ui.showGlobalRow ? GLOBAL_ROOTS : [];
      const scanOpts = scope === "global"
        ? { cwd, globalRoots, depth: 0, ignoreGlobs: config.scan.ignore, skipLocal: true }
        : scope === "all"
          ? { cwd: homedir(), globalRoots: [], depth: DEEP_SCAN_DEPTH, ignoreGlobs: config.scan.ignore }
          : { cwd, globalRoots, depth: config.scan.defaultDepth, ignoreGlobs: config.scan.ignore };
      const { result: stacks, suppressed } = await log.withMutedWarnings(() => scan(scanOpts));
      if (!cancelled) setState({ kind: "ready", stacks, suppressed, config });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
    });
    return () => { cancelled = true; };
  }, [cwd, scope, tick]);

  const rescan = useCallback(() => setTick((t) => t + 1), []);
  const setScope = useCallback((c: ScopeChoice) => {
    // Always rescan. If the scope actually changed, the effect reruns via the
    // `scope` dep and the tick bump is a harmless coincidence (React batches
    // both updates into one render). If it didn't change, the rescan is what
    // triggers the effect — otherwise "pick current → current" feels broken.
    setScopeRaw(c);
    rescan();
  }, [rescan]);

  const api = useMemo<ScanApi>(
    () => ({ cwd, state, scope, cursor, setCursor, setScope, rescan }),
    [cwd, state, scope, cursor, setScope, rescan],
  );

  return <ScanContext.Provider value={api}>{children}</ScanContext.Provider>;
}

export function useScan(): ScanApi {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be called inside ScanProvider");
  return ctx;
}
