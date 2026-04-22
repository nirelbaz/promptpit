import { Box, Text, useApp } from "ink";
import { Frame } from "../chrome.js";
import { ListPicker } from "../primitives.js";
import { useNav } from "../nav.js";
import { ScopePicker, type ScopeChoice } from "./scope-picker.js";

interface EmptyStateProps {
  cwd: string;
  scopeLabel: string;
  onScope?: (choice: ScopeChoice) => void;
}

type Choice = "widen-scope" | "quit";

export function EmptyState({ cwd, scopeLabel, onScope }: EmptyStateProps) {
  const nav = useNav();
  const { exit } = useApp();
  return (
    <Frame
      crumbs={["Stacks", "Empty"]}
      right={scopeLabel}
      keys={[["↑↓", "nav"], ["↵", "select"], ["q", "quit"]]}
    >
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Box>
          <Text>No AI config found in </Text>
          <Text bold>{cwd}</Text>
          <Text dimColor> (scope: {scopeLabel}).</Text>
        </Box>
      </Box>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text dimColor>A <Text color="cyan">stack</Text> bundles AI-tool config (skills, rules, agents, MCP) so you can install it across Claude Code, Cursor, Codex…</Text>
      </Box>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>Next steps</Text>
        <Box marginTop={1}><Text color="cyan">pit init</Text><Text dimColor>                 scaffold a new stack in this directory</Text></Box>
        <Box><Text color="cyan">pit install </Text><Text>&lt;github:org/repo&gt;</Text><Text dimColor>  pull an existing stack from GitHub</Text></Box>
        <Box><Text color="cyan">pit collect</Text><Text dimColor>              bundle this project's existing AI config into a stack</Text></Box>
      </Box>
      <ListPicker<Choice>
        options={[
          { value: "widen-scope", label: "Widen scope (maybe it's elsewhere)", hint: "scan more of your filesystem" },
          { value: "quit", label: "Quit" },
        ]}
        onSelect={(v) => {
          // `exit()` triggers Ink's proper unmount; bare process.exit(0)
          // can leave stdin in raw mode on some terminals.
          if (v === "quit") { exit(); return; }
          nav.push(() => <ScopePicker onPick={(choice) => onScope?.(choice)} />);
        }}
        onCancel={() => exit()}
      />
    </Frame>
  );
}
