// Ink replacement for the clack validate action. Runs validateStack()
// against the selected stack's .promptpit/ and renders a pass/fail card
// with per-file diagnostics. Scanning happens on mount so the user sees
// a spinner while the IO completes.
import path from "node:path";
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { validateStack, type ValidateResult } from "../../core/validate.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "loading" }
  | { kind: "not-applicable" }
  | { kind: "done"; result: ValidateResult }
  | { kind: "error"; message: string };

export function ValidateScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const [state, setState] = useState<State>(() =>
    stack.kind === "managed" ? { kind: "loading" } : { kind: "not-applicable" },
  );

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    const stackDir = path.join(stack.root, ".promptpit");
    validateStack(stackDir)
      .then((result) => {
        if (!cancelled) setState({ kind: "done", result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [state.kind, stack.root]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Validate"]}
      keys={[["↵", "back"], ["esc", "back"]]}
    >
      <SectionTitle hint=".promptpit/ schema + agnix checks">Validate</SectionTitle>
      {state.kind === "loading" && (
        <Box paddingX={1}><Spinner label="Running validators…" /></Box>
      )}
      {state.kind === "not-applicable" && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>Validate only applies to pit-managed stacks. </Text>
          <Text>This stack has no </Text>
          <Text color="cyan">.promptpit/</Text>
          <Text>.</Text>
        </Box>
      )}
      {state.kind === "error" && (
        <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="red">
          <Box><Text color="red">✖ </Text><Text bold>Validate failed to run</Text></Box>
          <Text dimColor>{state.message}</Text>
        </Box>
      )}
      {state.kind === "done" && <ResultCard result={state.result} />}
      {state.kind !== "loading" && (
        <ListPicker options={[{ value: "back", label: "Back" }]} onSelect={() => nav.pop()} onCancel={() => nav.pop()} />
      )}
    </Frame>
  );
}

function ResultCard({ result }: { result: ValidateResult }) {
  const summary = result.valid
    ? "Valid"
    : `${result.errors} error${result.errors === 1 ? "" : "s"}, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}`;
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor={result.valid ? "green" : "yellow"}>
        <Box>
          {result.valid
            ? <><Text color="green">✓ </Text><Text bold>{summary}</Text></>
            : <><Text color="yellow">⚠ </Text><Text bold>{summary}</Text></>}
        </Box>
      </Box>
      {result.diagnostics.length > 0 && (
        <Box paddingX={1} marginBottom={1} flexDirection="column">
          <Text bold>Diagnostics</Text>
          {result.diagnostics.map((d, i) => (
            <Box key={i}>
              <Box width={9}>
                <Text color={d.level === "error" ? "red" : "yellow"}>{d.level.toUpperCase()}</Text>
              </Box>
              <Text>{d.file}</Text>
              <Text dimColor>  {d.message}</Text>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}
