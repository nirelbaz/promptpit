import path from "node:path";
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { validateStack, type ValidateResult } from "../../core/validate.js";
import { log } from "../../shared/io.js";
import { safe } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
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
    // Mute warnings: validate walks the bundle and emits log.warn for schema
    // diagnostics. Those writes to stderr collide with Ink's cursor tracking
    // and leave ghost Header frames stacked on screen. Diagnostics already
    // surface in the result card — the warn stream is redundant here.
    log.withMutedWarnings(() => validateStack(stackDir))
      .then(({ result }) => {
        if (!cancelled) setState({ kind: "done", result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
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
  // Both pit's own diagnostics and agnix's (Claude Code specialized rules)
  // feed into the error/warning counts. Previously we only rendered pit's —
  // so agnix-only failures showed up as "3 errors" with an empty body.
  const allDiagnostics = [...result.diagnostics, ...result.agnix.diagnostics];
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor={result.valid ? "green" : "yellow"}>
        <Box>
          {result.valid
            ? <><Text color="green">✓ </Text><Text bold>{summary}</Text></>
            : <><Text color="yellow">⚠ </Text><Text bold>{summary}</Text></>}
        </Box>
        {!result.agnix.available && (
          <Text dimColor>agnix not available — some checks skipped</Text>
        )}
      </Box>
      {allDiagnostics.length > 0 && (
        <Box paddingX={1} marginBottom={1} flexDirection="column">
          <Text bold>Diagnostics</Text>
          {allDiagnostics.map((d, i) => (
            <Box key={i}>
              <Box width={9}>
                <Text color={d.level === "error" ? "red" : "yellow"}>{d.level.toUpperCase()}</Text>
              </Box>
              <Box width={4}>
                <Text dimColor>{d.source === "agnix" ? "ag" : "pit"}</Text>
              </Box>
              <Text>{safe(d.file)}</Text>
              {d.rule && <Text dimColor> [{safe(d.rule)}]</Text>}
              <Text dimColor>  {safe(d.message)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}
