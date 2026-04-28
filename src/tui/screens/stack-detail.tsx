import { spawn } from "node:child_process";
import { Box, Text } from "ink";
import { Frame } from "../chrome.js";
import { ListPicker, type ListOption } from "../primitives.js";
import { useNav } from "../nav.js";
import { useFreshStack } from "../scan-context.js";
import { optionsForMenu, type ActionKey } from "../action-hints.js";
import { glyphFor, glyphColorFor, rightChipFor } from "../stack-presentation.js";
import { safe } from "../../shared/text.js";
import type { ScannedStack } from "../../shared/schema.js";
import { ValidateScreen } from "./validate-screen.js";
import { StatusDiffScreen } from "./status-diff-screen.js";
import { CollectScreen } from "./collect-screen.js";
import { Flash } from "./flash.js";

// Actions not yet wired push a Flash that tells the user which release will
// include them — clearer than silently no-op'ing, less spammy than throwing.
const COMING_SOON: Partial<Record<ActionKey, string>> = {
  "install-from":     "Install wizard coming in v0.6",
  "install-to":       "Install-to wizard coming in v0.6",
  "adapt":            "Adapt wizard coming in v0.6",
  "update":           "Update wizard coming in v0.6",
  "collect-drift":    "Collect-drift coming in v0.6",
  "artifacts":        "Per-artifact drilldown coming in v0.7",
  "uninstall":        "Uninstall wizard coming in v0.6",
  "delete-bundle":    "Delete-bundle coming in v0.7",
  "delete-files":     "Delete-files coming in v0.7",
  "copy-to":          "Copy-to coming in v0.7",
  "resolve-conflicts":"Conflict resolution coming in v0.6",
  "review-overrides": "Overrides review coming in v0.7",
  "show-extends":     "Extends chain viewer coming in v0.7",
};

function platformOpenCommand(p: NodeJS.Platform): string {
  if (p === "darwin") return "open";
  if (p === "win32") return "explorer";
  return "xdg-open";
}

export function StackDetail({ stack: initial }: { stack: ScannedStack }) {
  const nav = useNav();
  // Re-resolve from the active scan so a rescan triggered by a child screen
  // (e.g. CollectScreen flipping unmanaged → managed) updates the chip,
  // action menu, and adapter list when this screen comes back into view.
  const stack = useFreshStack(initial);
  const options: ListOption<ActionKey>[] = optionsForMenu(stack.kind).map((o) => ({
    value: o.value,
    label: o.label,
    hint: o.hint,
    disabled: Boolean(COMING_SOON[o.value]),
  }));

  const chip = rightChipFor(stack);

  return (
    <Frame
      crumbs={["Stacks", stack.name]}
      right={chip.text}
      keys={[["↑↓", "nav"], ["↵", "select"], ["esc", "back"]]}
    >
      <Box flexDirection="column" paddingX={1} marginBottom={1} borderStyle="round" borderColor="gray">
        <Box>
          <Text color={glyphColorFor(stack.kind)}>{glyphFor(stack.kind)} </Text>
          <Text bold wrap="truncate-end">{safe(stack.name)}</Text>
          {stack.kind === "managed" && stack.promptpit?.stackVersion && (
            <Text dimColor wrap="truncate-end">  v{safe(stack.promptpit.stackVersion)}</Text>
          )}
          {stack.overallDrift === "drifted" && <Text color="yellow">  · drifted</Text>}
        </Box>
        <Text dimColor wrap="truncate-end">{safe(stack.root)}</Text>
        {stack.kind === "managed" && stack.promptpit?.source && (
          <Box marginTop={1}>
            <Text dimColor>source: </Text>
            <Text color="cyan" wrap="truncate-end">{safe(stack.promptpit.source)}</Text>
          </Box>
        )}
        {stack.adapters.length > 0 && (
          <Box>
            <Text dimColor>tools:  </Text>
            <Text wrap="truncate-end">{stack.adapters.map((a) => safe(a.id)).join(", ")}</Text>
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
  if (key === "collect") { nav.push(() => <CollectScreen stack={stack} />); return; }
  if (key === "open") {
    // openFolder's 'error' event fires asynchronously — we can't know here
    // whether the launch actually succeeded. "Requested" means "asked the OS
    // to open this"; errors (missing open/xdg-open/explorer) surface on the
    // real stderr after the TUI exits via runTui's buffered flush.
    openFolder(stack.root);
    nav.push(() => (
      <Flash
        message={`Requested open for ${safe(stack.root)}`}
        crumbs={["Stacks", stack.name, "…"]}
      />
    ));
    return;
  }

  const msg = COMING_SOON[key];
  if (msg) {
    nav.push(() => <Flash message={msg} tone="info" crumbs={["Stacks", stack.name, "…"]} />);
  }
}

/** Reveal the stack root in the platform's file manager. The 'error' listener
 *  is load-bearing: without it, a failed spawn emits an uncaught ChildProcess
 *  error event that crashes Node out from under the Ink alt-screen. */
function openFolder(root: string): void {
  const cmd = platformOpenCommand(process.platform);
  const child = spawn(cmd, [root], { detached: true, stdio: "ignore" });
  child.on("error", () => { /* async surface; caller already showed Flash */ });
  child.unref();
}
