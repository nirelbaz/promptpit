export type ActionKey =
  | "install-from" | "install-to" | "adapt"
  | "update" | "status-diff" | "collect" | "collect-drift"
  | "artifacts" | "validate" | "uninstall"
  | "open" | "delete-bundle" | "delete-files"
  | "copy-to" | "resolve-conflicts" | "review-overrides" | "show-extends"
  | "back";

export interface ActionOption {
  value: ActionKey;
  label: string;
  hint: string;
}

// Single source of truth for every menu row the TUI can render. Keep the hint
// strings short and action-oriented — they show as the greyed-out suffix under
// the cursor in @clack/prompts select menus. Changing wording here updates every
// menu at once (managed / unmanaged / global share this map).
export const ACTION_HINTS: Record<ActionKey, { label: string; hint: string }> = {
  "install-from":     { label: "Install from…",                  hint: "pull a stack into this location" },
  "install-to":       { label: "Install to…",                    hint: "install this stack into another project" },
  "adapt":            { label: "Adapt…",                         hint: "install this stack using a different tool, same or other project" },
  "update":           { label: "Update",                         hint: "pull upstream changes for this stack's extends" },
  "status-diff":      { label: "Status & diff",                  hint: "show drift and unified diffs for installed artifacts" },
  "collect":          { label: "Collect…",                       hint: "bundle this project's AI config into .promptpit/" },
  "collect-drift":    { label: "Collect drift",                  hint: "accept local changes as the new bundle source of truth" },
  "artifacts":        { label: "Artifacts…",                     hint: "drill into individual skills, rules, agents, commands, MCP, instructions" },
  "validate":         { label: "Validate",                       hint: "run schema + agnix checks on the bundle" },
  "uninstall":        { label: "Uninstall…",                     hint: "remove installed artifacts; bundle stays" },
  "open":             { label: "Open",                           hint: "reveal folder in Finder / file manager" },
  "delete-bundle":    { label: "Delete bundle…",                 hint: "remove .promptpit/; orphans installed files" },
  "delete-files":     { label: "Delete files…",                  hint: "remove the loose AI config files from this project" },
  "copy-to":          { label: "Copy to…",                       hint: "duplicate the loose AI config into another project" },
  "resolve-conflicts":{ label: "Resolve extends conflicts",      hint: "prompt per unresolved conflict in the extends chain" },
  "review-overrides": { label: "Review overrides / exclusions",  hint: "inspect / reset saved install-time choices" },
  "show-extends":     { label: "Show extends chain",             hint: "render the resolved upstream graph with versions + commits" },
  "back":             { label: "Back",                           hint: "return to the previous menu" },
};

export function hintFor(key: ActionKey): string {
  return ACTION_HINTS[key].hint;
}

const MANAGED_ORDER: ActionKey[] = [
  "install-from", "install-to", "adapt", "update", "status-diff",
  "collect-drift", "artifacts", "validate", "uninstall", "open",
  "delete-bundle", "back",
];

// `artifacts` is intentionally absent for unmanaged stacks in MVP: the per-artifact
// drilldown only works against `installed.json`, which unmanaged stacks don't have.
// Re-enabling for unmanaged requires a separate "loose-config drilldown" path —
// tracked as v2 in docs/superpowers/specs/2026-04-20-new-ux-design.md §15.
const UNMANAGED_ORDER: ActionKey[] = [
  "install-from", "collect", "copy-to", "adapt",
  "open", "delete-files", "back",
];

const GLOBAL_ORDER: ActionKey[] = ["install-from", "artifacts", "open", "back"];

export function optionsForMenu(kind: "managed" | "unmanaged" | "global"): ActionOption[] {
  const order = kind === "managed" ? MANAGED_ORDER : kind === "unmanaged" ? UNMANAGED_ORDER : GLOBAL_ORDER;
  return order.map((value) => ({ value, label: ACTION_HINTS[value].label, hint: ACTION_HINTS[value].hint }));
}
