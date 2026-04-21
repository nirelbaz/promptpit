// Landing when `scan()` returns no stacks. Offers concrete next actions
// rather than just "nothing here" — most first-time users hit this screen
// and need a nudge toward `init` or a wider scan.
import { Box, Text, useApp } from "ink";
import { Frame } from "../chrome.js";
import { ListPicker } from "../primitives.js";
import { useNav } from "../nav.js";
import { Flash } from "./flash.js";

interface EmptyStateProps {
  cwd: string;
  scopeLabel: string;
}

type Choice = "init" | "scan-path" | "scan-all" | "install" | "quit";

export function EmptyState({ cwd, scopeLabel }: EmptyStateProps) {
  const nav = useNav();
  const { exit } = useApp();
  return (
    <Frame
      crumbs={["Stacks", "Empty"]}
      right={scopeLabel}
      keys={[["↑↓", "nav"], ["↵", "select"], ["q", "quit"]]}
    >
      <Box paddingX={1} marginBottom={1}>
        <Text>No AI config found in </Text>
        <Text bold>{cwd}</Text>
        <Text> or global paths.</Text>
      </Box>
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>What do you want to do?</Text>
      </Box>
      <ListPicker<Choice>
        options={[
          { value: "init", label: "Create a new stack here", hint: "coming in v0.6.0", disabled: true },
          { value: "scan-path", label: "Scan a different path…", hint: "coming in v0.6.0", disabled: true },
          { value: "scan-all", label: "Scan everywhere", hint: "coming in v0.6.0", disabled: true },
          { value: "install", label: "Install a stack from GitHub…", hint: "coming in v0.6.0", disabled: true },
          { value: "quit", label: "Quit" },
        ]}
        onSelect={(v) => {
          // Chunk 1 ships nothing actionable from this screen — every non-
          // quit option is disabled so ListPicker can't even land on them.
          // `exit()` triggers Ink's proper unmount; bare process.exit(0)
          // can leave stdin in raw mode on some terminals.
          if (v === "quit") { exit(); return; }
          nav.push(() => <Flash message={`"${v}" is coming in a later release`} tone="info" />);
        }}
        onCancel={() => exit()}
      />
    </Frame>
  );
}
