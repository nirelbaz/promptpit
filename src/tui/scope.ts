import type { Prompter } from "../shared/interactive.js";

export type ScopeChoice = "current" | "global" | "path" | "all";

// MVP: the return value only triggers a rescan in the main loop. Wiring the
// path/all choices through to `scan()` with a different cwd/depth is deferred
// to a later task (see docs/superpowers/specs/2026-04-20-new-ux-design.md §6).
export async function askScope(prompter: Prompter): Promise<ScopeChoice> {
  return prompter.select<ScopeChoice>({
    message: "Scope",
    options: [
      { value: "current", label: "Current tree + global (default)", hint: "depth 5 under cwd + ~/.claude etc." },
      { value: "global", label: "Global only" },
      { value: "path", label: "A specific path…" },
      { value: "all", label: "Everywhere (deep)" },
    ],
    initialValue: "current",
  });
}
