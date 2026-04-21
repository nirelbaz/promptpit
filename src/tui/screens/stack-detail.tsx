// Detail card + per-kind action menu for a single scanned stack.
// Routes action keys to the corresponding screen. Chunk 1 wires Validate,
// Status & diff, Open, and Back — every other action pushes a "coming
// in a later release" flash so the menu itself is fully navigable.
//
// This replaces the clack `stackMenu` function: actions are now screens
// (pushed onto the nav stack), not injected handlers. Simpler composition,
// and every action's render lives with its logic.
import { spawn } from "node:child_process";
import { Box, Text } from "ink";
import { Frame } from "../chrome.js";
import { ListPicker, type ListOption } from "../primitives.js";
import { useNav } from "../nav.js";
import { optionsForMenu, type ActionKey } from "../action-hints.js";
import type { ScannedStack } from "../../shared/schema.js";
import { ValidateScreen } from "./validate-screen.js";
import { StatusDiffScreen } from "./status-diff-screen.js";
import { Flash } from "./flash.js";

// Actions wired in Chunks 2/3. Until then, picking one pushes a Flash
// that tells the user which release will include it — clearer than
// silently doing nothing, less spammy than throwing an error.
const COMING_SOON: Partial<Record<ActionKey, string>> = {
  "install-from":     "Install wizard ships in the next release",
  "install-to":       "Install-to wizard ships in the next release",
  "adapt":            "Adapt wizard ships in the next release",
  "update":           "Update wizard ships in the next release",
  "collect":          "Collect wizard ships in the next release",
  "collect-drift":    "Collect-drift ships in the next release",
  "artifacts":        "Per-artifact drilldown ships in the final release",
  "uninstall":        "Uninstall wizard ships in the next release",
  "delete-bundle":    "Delete-bundle ships in the final release",
  "delete-files":     "Delete-files ships in the final release",
  "copy-to":          "Copy-to ships in the final release",
  "resolve-conflicts":"Conflict resolution ships in the next release",
  "review-overrides": "Overrides review ships in the final release",
  "show-extends":     "Extends chain viewer ships in the final release",
};

function platformOpenCommand(p: NodeJS.Platform): string {
  if (p === "darwin") return "open";
  if (p === "win32") return "explorer";
  return "xdg-open";
}

export function StackDetail({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const options: ListOption<ActionKey>[] = optionsForMenu(stack.kind).map((o) => ({
    value: o.value,
    label: o.label,
    hint: o.hint,
    disabled: Boolean(COMING_SOON[o.value]),
  }));

  const glyph = stack.kind === "managed" ? "●" : stack.kind === "unmanaged" ? "○" : "◉";
  const glyphColor = stack.kind === "managed" ? "green" : stack.kind === "unmanaged" ? "gray" : "cyan";
  const rightChip = stack.kind === "managed"
    ? `managed · v${stack.promptpit?.stackVersion ?? "?"}`
    : stack.kind;

  return (
    <Frame
      crumbs={["Stacks", stack.name]}
      right={rightChip}
      keys={[["↑↓", "nav"], ["↵", "select"], ["esc", "back"]]}
    >
      <Box flexDirection="column" paddingX={1} marginBottom={1} borderStyle="round" borderColor="gray">
        <Box>
          <Text color={glyphColor}>{glyph} </Text>
          <Text bold wrap="truncate-end">{stack.name}</Text>
          {stack.kind === "managed" && stack.promptpit?.stackVersion && (
            <Text dimColor wrap="truncate-end">  v{stack.promptpit.stackVersion}</Text>
          )}
          {stack.overallDrift === "drifted" && <Text color="yellow">  · drifted</Text>}
        </Box>
        <Text dimColor wrap="truncate-end">{stack.root}</Text>
        {stack.kind === "managed" && stack.promptpit?.source && (
          <Box marginTop={1}>
            <Text dimColor>source: </Text>
            <Text color="cyan" wrap="truncate-end">{stack.promptpit.source}</Text>
          </Box>
        )}
        {stack.adapters.length > 0 && (
          <Box>
            <Text dimColor>tools:  </Text>
            <Text wrap="truncate-end">{stack.adapters.map((a) => a.id).join(", ")}</Text>
          </Box>
        )}
      </Box>
      <ListPicker<ActionKey>
        options={options}
        onSelect={(key) => handleAction(key, stack, nav)}
        onCancel={() => nav.pop()}
      />
    </Frame>
  );
}

function handleAction(
  key: ActionKey,
  stack: ScannedStack,
  nav: ReturnType<typeof useNav>,
): void {
  if (key === "back") { nav.pop(); return; }
  if (key === "validate") { nav.push(() => <ValidateScreen stack={stack} />); return; }
  if (key === "status-diff") { nav.push(() => <StatusDiffScreen stack={stack} />); return; }
  if (key === "open") {
    const ok = openFolder(stack.root);
    const flash = ok
      ? <Flash message={`Opened ${stack.root}`} crumbs={["Stacks", stack.name, "…"]} />
      : <Flash message={`Couldn't launch your file manager. Try: open "${stack.root}"`} tone="warn" crumbs={["Stacks", stack.name, "…"]} />;
    nav.push(() => flash);
    return;
  }

  const msg = COMING_SOON[key];
  if (msg) {
    nav.push(() => <Flash message={msg} tone="info" crumbs={["Stacks", stack.name, "…"]} />);
  }
}

/** Reveal the stack root in the platform's file manager. Args array — no
 *  shell — so a path containing metacharacters can't be misinterpreted.
 *  Returns true if spawn started (not whether the file manager opened —
 *  detached/stdio:ignore means we can't tell). Returns false if Node
 *  couldn't even launch the binary (ENOENT on minimal containers).
 *
 *  The 'error' listener is load-bearing: without it, a failed spawn emits
 *  an uncaught ChildProcess error event that crashes Node out from under
 *  the Ink alt-screen. */
function openFolder(root: string): boolean {
  const cmd = platformOpenCommand(process.platform);
  try {
    const child = spawn(cmd, [root], { detached: true, stdio: "ignore" });
    child.on("error", () => { /* swallow — surfaced via Flash tone in caller */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
