// Ink replacement for the clack status-diff action. Runs reconcileAll +
// computeDiff against the stack root and renders a per-adapter state
// table plus a drift count. Lazy — fires both calls on mount.
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { reconcileAll, type ReconcileOutput } from "../../core/reconcile.js";
import { computeDiff, type DiffResult } from "../../commands/diff.js";
import { log } from "../../shared/io.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "loading" }
  | { kind: "not-applicable" }
  | { kind: "done"; reconciled: ReconcileOutput; diff: DiffResult }
  | { kind: "error"; message: string };

export function StatusDiffScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const [state, setState] = useState<State>(() =>
    stack.kind === "managed" ? { kind: "loading" } : { kind: "not-applicable" },
  );

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    // Mute warnings during the Ink render: reconcile + computeDiff emit
    // log.warnOnce lines to stderr on malformed manifests, which races with
    // Ink's cursor-clearing ANSI and leaves ghost Header frames on screen.
    // Same pattern as main-list's scan wrap.
    log.withMutedWarnings(() =>
      Promise.all([reconcileAll(stack.root), computeDiff(stack.root, {})]),
    )
      .then(({ result: [reconciled, diff] }) => {
        if (!cancelled) setState({ kind: "done", reconciled, diff });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [state.kind, stack.root]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Status & diff"]}
      keys={[["↵", "back"], ["esc", "back"]]}
    >
      <SectionTitle hint="what's in sync and what's drifted">Status & diff</SectionTitle>
      {state.kind === "loading" && (
        <Box paddingX={1}><Spinner label="Reconciling installed artifacts…" /></Box>
      )}
      {state.kind === "not-applicable" && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>Status & diff only applies to pit-managed stacks.</Text>
        </Box>
      )}
      {state.kind === "error" && (
        <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="red">
          <Box><Text color="red">✖ </Text><Text bold>Reconcile failed</Text></Box>
          <Text dimColor>{state.message}</Text>
        </Box>
      )}
      {state.kind === "done" && <ResultBody reconciled={state.reconciled} diff={state.diff} />}
      {state.kind !== "loading" && (
        <ListPicker options={[{ value: "back", label: "Back" }]} onSelect={() => nav.pop()} onCancel={() => nav.pop()} />
      )}
    </Frame>
  );
}

function ResultBody({ reconciled, diff }: { reconciled: ReconcileOutput; diff: DiffResult }) {
  // DiffResult.stacks[].adapters[].artifacts is already filtered to drifted
  // entries by computeDiff, but be defensive — count only state: "drifted"
  // so future changes to computeDiff's filter don't silently inflate the
  // number the user sees on the summary line.
  const totalDriftedArtifacts = diff.stacks.reduce(
    (n, s) => n + s.adapters.reduce(
      (m, a) => m + a.artifacts.filter((x) => x.state === "drifted").length,
      0,
    ),
    0,
  );
  return (
    <>
      {reconciled.stacks.map((s) => (
        <Box key={s.stack} paddingX={1} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold>{s.stack}</Text>
            <Text dimColor>  @{s.version}  </Text>
            <Text color={s.overallState === "drifted" ? "yellow" : s.overallState === "synced" ? "green" : "gray"}>
              {s.overallState}
            </Text>
          </Box>
          {s.adapters.map((a) => {
            const drifted = a.artifacts.filter((x) => x.state === "drifted").length;
            const color = a.state === "drifted" ? "yellow" : a.state === "synced" ? "green" : "gray";
            return (
              <Box key={a.adapterId}>
                <Box width={16}><Text dimColor>  {a.adapterId}</Text></Box>
                <Text color={color}>{a.state}</Text>
                {drifted > 0 && <Text dimColor>  ({drifted} drifted)</Text>}
              </Box>
            );
          })}
        </Box>
      ))}
      <Box paddingX={1} marginBottom={1}>
        {diff.hasDrift
          ? <Text color="yellow">⚠ {totalDriftedArtifacts} drifted artifact{totalDriftedArtifacts === 1 ? "" : "s"}</Text>
          : <><Text color="green">✓ </Text><Text>All in sync.</Text></>}
      </Box>
    </>
  );
}
