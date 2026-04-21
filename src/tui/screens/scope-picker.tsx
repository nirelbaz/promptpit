// Scope widen picker. MVP behaviour: the chosen value just returns to the
// caller, which triggers a rescan with the default scope. Wiring the
// path/all choices through to scan() with different cwd/depth is tracked
// separately (see docs/superpowers/specs/2026-04-20-new-ux-design.md §6).
import { Frame } from "../chrome.js";
import { ListPicker } from "../primitives.js";
import { useNav } from "../nav.js";

export type ScopeChoice = "current" | "global" | "path" | "all";

export function ScopePicker({ onPick }: { onPick?: (choice: ScopeChoice) => void }) {
  const nav = useNav();
  const commit = (choice: ScopeChoice) => {
    onPick?.(choice);
    nav.pop();
  };
  return (
    <Frame
      crumbs={["Stacks", "Scope"]}
      keys={[["↑↓", "nav"], ["↵", "select"], ["esc", "back"]]}
    >
      <ListPicker<ScopeChoice>
        options={[
          { value: "current", label: "Current tree + global", hint: "depth 5 under cwd + ~/.claude etc." },
          { value: "global", label: "Global only" },
          { value: "path", label: "A specific path…", disabled: true, hint: "coming soon" },
          { value: "all", label: "Everywhere (deep)", hint: "slow on large home directories" },
        ]}
        onSelect={commit}
        onCancel={() => nav.pop()}
      />
    </Frame>
  );
}
