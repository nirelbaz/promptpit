import path from "node:path";
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { reconcileAll, type ReconcileOutput } from "../../core/reconcile.js";
import { computeDiff, type DiffResult } from "../../commands/diff.js";
import { log } from "../../shared/io.js";
import { safe } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "loading" }
  | { kind: "not-applicable" }
  | { kind: "done"; reconciled: ReconcileOutput; diff: DiffResult | null; diffError?: string }
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
    // allSettled so a diff failure (e.g. unreadable adapter file) doesn't
    // also discard the reconcile output — the UI surfaces reconcile alone
    // with a soft-error banner on the diff half.
    log.withMutedWarnings(() =>
      Promise.allSettled([reconcileAll(stack.root), computeDiff(stack.root, {})]),
    )
      .then(({ result: [rec, dif] }) => {
        if (cancelled) return;
        if (rec.status === "rejected") {
          setState({ kind: "error", message: errorMessage(rec.reason) });
          return;
        }
        if (dif.status === "rejected") {
          setState({ kind: "done", reconciled: rec.value, diff: null, diffError: errorMessage(dif.reason) });
          return;
        }
        setState({ kind: "done", reconciled: rec.value, diff: dif.value });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
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
      {state.kind === "done" && <ResultBody reconciled={state.reconciled} diff={state.diff} diffError={state.diffError} stackRoot={stack.root} />}
      {state.kind !== "loading" && (
        <ListPicker options={[{ value: "back", label: "Back" }]} onSelect={() => nav.pop()} onCancel={() => nav.pop()} />
      )}
    </Frame>
  );
}

function ResultBody({ reconciled, diff, diffError, stackRoot }: { reconciled: ReconcileOutput; diff: DiffResult | null; diffError?: string; stackRoot: string }) {
  // DiffResult.stacks[].adapters[].artifacts is already filtered to drifted
  // entries by computeDiff, but be defensive — count only state: "drifted"
  // so future changes to computeDiff's filter don't silently inflate the
  // number the user sees on the summary line.
  const totalDriftedArtifacts = diff
    ? diff.stacks.reduce(
        (n, s) => n + s.adapters.reduce(
          (m, a) => m + a.artifacts.filter((x) => x.state === "drifted").length,
          0,
        ),
        0,
      )
    : 0;
  return (
    <>
      {reconciled.stacks.map((s) => (
        <Box key={s.stack} paddingX={1} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold>{safe(s.stack)}</Text>
            <Text dimColor>  @{safe(s.version)}  </Text>
            <Text color={s.overallState === "drifted" ? "yellow" : s.overallState === "synced" ? "green" : "gray"}>
              {s.overallState}
            </Text>
          </Box>
          {s.adapters.map((a) => {
            const drifted = a.artifacts.filter((x) => x.state === "drifted").length;
            const color = a.state === "drifted" ? "yellow" : a.state === "synced" ? "green" : "gray";
            return (
              <Box key={a.adapterId}>
                <Box width={16}><Text dimColor>  {safe(a.adapterId)}</Text></Box>
                <Text color={color}>{a.state}</Text>
                {drifted > 0 && <Text dimColor>  ({drifted} drifted)</Text>}
              </Box>
            );
          })}
        </Box>
      ))}
      {diff ? (
        diff.hasDrift ? (
          <Box paddingX={1} marginBottom={1} flexDirection="column">
            <Text color="yellow">⚠ {totalDriftedArtifacts} drifted artifact{totalDriftedArtifacts === 1 ? "" : "s"}</Text>
            <DriftedArtifactList diff={diff} stackRoot={stackRoot} />
            <Text dimColor>Run <Text color="cyan">pit diff</Text> for the full unified diff.</Text>
          </Box>
        ) : (
          <Box paddingX={1} marginBottom={1}>
            <Text color="green">✓ </Text><Text>All in sync.</Text>
          </Box>
        )
      ) : (
        <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="yellow">
          <Box><Text color="yellow">⚠ </Text><Text bold>Diff unavailable</Text></Box>
          <Text dimColor>{safe(diffError ?? "unknown error")}</Text>
          <Text dimColor>Status above reflects reconcile; diff details omitted.</Text>
        </Box>
      )}
    </>
  );
}

function DriftedArtifactList({ diff, stackRoot }: { diff: DiffResult; stackRoot: string }) {
  // Flatten the nested stacks→adapters→artifacts shape so the user sees a
  // single scannable list. Unified diff bodies are intentionally omitted
  // here — they blow out the TUI layout on any non-trivial diff. The CLI
  // pointer at the bottom covers the "show me the diff" case.
  const rows: Array<{ stack: string; adapterId: string; type: string; name: string; path: string }> = [];
  for (const s of diff.stacks) {
    for (const a of s.adapters) {
      for (const art of a.artifacts) {
        if (art.state === "drifted") {
          rows.push({ stack: s.stack, adapterId: a.adapterId, type: art.type, name: art.name, path: art.path });
        }
      }
    }
  }
  if (rows.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {rows.map((r, i) => (
        <Box key={i}>
          <Box width={14}><Text color="gray">{safe(r.adapterId)}</Text></Box>
          <Box width={10}><Text dimColor>{safe(r.type)}</Text></Box>
          <Text bold wrap="truncate-end">{safe(r.name)}</Text>
          <Text dimColor wrap="truncate-end">  {safe(relativizePath(r.path, stackRoot))}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** Show artifact paths relative to the stack root ("./…/") instead of absolute —
 *  eats the `/Users/nirelbaz/Documents/app/` prefix that dominates every row
 *  and shoves the interesting bit off the right edge on narrow terminals.
 *  Falls back to the original path if it isn't under the stack root (rare;
 *  could happen with symlink-resolved roots on some setups). */
function relativizePath(abs: string, stackRoot: string): string {
  const rel = path.relative(stackRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return abs;
  return `./${rel}`;
}
