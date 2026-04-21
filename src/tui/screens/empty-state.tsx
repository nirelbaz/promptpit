// Landing when `scan()` returns no stacks. Offers concrete next actions
// rather than just "nothing here" — most first-time users hit this screen
// and need a nudge toward `init` or a wider scan.
import { Box, Text } from "ink";
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
          { value: "init", label: "Create a new stack here", hint: "pit init" },
          { value: "scan-path", label: "Scan a different path…", hint: "coming in v0.6.0", disabled: true },
          { value: "scan-all", label: "Scan everywhere", hint: "--all · slow" },
          { value: "install", label: "Install a stack from GitHub…", hint: "coming in v0.6.0", disabled: true },
          { value: "quit", label: "Quit" },
        ]}
        onSelect={(v) => {
          if (v === "quit") { nav.pop(); process.exit(0); }
          // MVP: these just flash "coming soon"; Chunks 2/3 wire real flows.
          nav.push(() => <Flash message={`"${v}" is coming in a later release`} tone="info" />);
        }}
        onCancel={() => nav.pop()}
      />
    </Frame>
  );
}
