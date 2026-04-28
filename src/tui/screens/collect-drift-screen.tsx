import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { useScanOptional } from "../scan-context.js";
import { WizardErrorBody, actionColor } from "../components/wizard-bodies.js";
import {
  collectDriftBack,
  listDriftCandidates,
  type CollectDriftResult,
  type DriftCandidate,
} from "../../core/collect-drift.js";
import { log } from "../../shared/io.js";
import { safe, relativizeFromStackRoot, pluralize } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "intro" }
  | { kind: "scanning" }
  | { kind: "no-drift" }
  | { kind: "configuring"; candidates: DriftCandidate[]; selected: Set<number>; cursor: number; dryRun: boolean }
  | { kind: "running"; selection: DriftCandidate[]; dryRun: boolean }
  | { kind: "done"; result: CollectDriftResult; selection: DriftCandidate[] }
  | { kind: "error"; message: string };

export function CollectDriftScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const scan = useScanOptional();
  const [state, setState] = useState<State>({ kind: "intro" });

  // Scanning: read the current drift list once on entry, then transition.
  useEffect(() => {
    if (state.kind !== "scanning") return;
    let cancelled = false;
    log.withMutedNotices(() => listDriftCandidates(stack.root))
      .then((candidates) => {
        if (cancelled) return;
        if (candidates.length === 0) {
          setState({ kind: "no-drift" });
          return;
        }
        setState({
          kind: "configuring",
          candidates,
          // Default: every drift selected. The user untoggles what they
          // *don't* want pulled back. Mirrors the spec §9 mockup.
          selected: new Set(candidates.map((_, i) => i)),
          cursor: 0,
          dryRun: false,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
      });
    return () => { cancelled = true; };
  }, [state.kind, stack.root]);

  // Run collect-drift when a `running` state is entered.
  const running = state.kind === "running" ? state : null;
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    log.withMutedNotices(() =>
      collectDriftBack(
        stack.root,
        running.selection.map((s) => ({ adapterId: s.adapterId, type: s.type, name: s.name })),
        { dryRun: running.dryRun },
      ),
    )
      .then((result) => {
        if (cancelled) return;
        setState({ kind: "done", result, selection: running.selection });
        // Real run rewrites bundle and rehashes manifest. Force a rescan so
        // the parent StackDetail picks up the new drift state on pop.
        if (!result.dryRun) scan?.rescan();
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(err) });
      });
    return () => { cancelled = true; };
  }, [running, stack.root, scan]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Collect drift"]}
      keys={keysFor(state)}
    >
      <SectionTitle hint="accept local changes as the new bundle source">Collect drift</SectionTitle>
      {state.kind === "intro" && (
        <IntroBody
          onContinue={() => setState({ kind: "scanning" })}
          onCancel={() => nav.pop()}
        />
      )}
      {state.kind === "scanning" && (
        <Box paddingX={1}><Spinner label="Scanning for drift…" /></Box>
      )}
      {state.kind === "no-drift" && <NoDriftBody onDismiss={() => nav.pop()} />}
      {state.kind === "configuring" && (
        <ConfiguringBody
          state={state}
          stackRoot={stack.root}
          onUpdate={setState}
          onContinue={(selection) => setState({ kind: "running", selection, dryRun: state.dryRun })}
          onBack={() => nav.pop()}
        />
      )}
      {state.kind === "running" && (
        <Box paddingX={1}>
          <Spinner label={state.dryRun ? "Previewing drift collection…" : "Pulling drift into bundle…"} />
        </Box>
      )}
      {state.kind === "done" && (
        <DoneBody
          result={state.result}
          stackRoot={stack.root}
          onAgain={() => setState(
            // After a dry-run: skip the configuring screen — the user already
            // picked their set, and "Accept for real" should apply it now.
            // After a real run: re-scan to discover what's still drifted
            // (some artifacts may have been intentionally left out of the
            // first pass).
            state.result.dryRun
              ? { kind: "running", selection: state.selection, dryRun: false }
              : { kind: "scanning" },
          )}
          onBack={() => nav.pop()}
        />
      )}
      {state.kind === "error" && (
        <WizardErrorBody
          headline="Collect drift failed"
          message={state.message}
          onRetry={() => setState({ kind: "scanning" })}
          onBack={() => nav.pop()}
        />
      )}
    </Frame>
  );
}

function keysFor(state: State): [string, string][] {
  if (state.kind === "configuring") {
    return [["↑↓", "nav"], ["space", "toggle"], ["d", "dry-run"], ["↵", "accept"], ["esc", "back"]];
  }
  if (state.kind === "running" || state.kind === "scanning") return [["", "working…"]];
  return [["↵", "select"], ["esc", "back"]];
}

function NoDriftBody({ onDismiss }: { onDismiss: () => void }) {
  // Auto-pop after a beat so the user doesn't have to mash Enter past an
  // empty card, but accept Enter / Esc to dismiss early. Mirrors Flash.
  useEffect(() => {
    const id = setTimeout(onDismiss, 1500);
    return () => clearTimeout(id);
  }, [onDismiss]);
  useInput((_input, key) => {
    if (key.return || key.escape) onDismiss();
  });
  return (
    <Box paddingX={1} flexDirection="column" borderStyle="round" borderColor="cyan">
      <Box>
        <Text color="cyan">ℹ </Text>
        <Text bold>No drift detected — bundle is up to date</Text>
      </Box>
      <Text dimColor>Returning to the stack menu…</Text>
    </Box>
  );
}

function IntroBody({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text>Pull local edits to installed artifacts back into the bundle.</Text>
        <Box marginTop={1}>
          <Text dimColor>Only artifacts already tracked in installed.json are eligible.</Text>
        </Box>
      </Box>
      <ListPicker
        options={[
          { value: "scan", label: "Scan for drift", hint: "list drifted artifacts" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "scan" ? onContinue() : onCancel())}
        onCancel={onCancel}
      />
    </>
  );
}

function ConfiguringBody({
  state,
  stackRoot,
  onUpdate,
  onContinue,
  onBack,
}: {
  state: Extract<State, { kind: "configuring" }>;
  stackRoot: string;
  onUpdate: (s: State) => void;
  onContinue: (selection: DriftCandidate[]) => void;
  onBack: () => void;
}) {
  const { candidates, selected, cursor, dryRun } = state;

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      onUpdate({ ...state, cursor: Math.max(0, cursor - 1) });
      return;
    }
    if (key.downArrow || input === "j") {
      onUpdate({ ...state, cursor: Math.min(candidates.length - 1, cursor + 1) });
      return;
    }
    if (input === " ") {
      const next = new Set(selected);
      if (next.has(cursor)) next.delete(cursor);
      else next.add(cursor);
      onUpdate({ ...state, selected: next });
      return;
    }
    if (input === "a") {
      // Toggle-all: convenient when the default selection is already what
      // the user wants, except for one outlier they'd rather drop.
      const allSelected = selected.size === candidates.length;
      onUpdate({
        ...state,
        selected: allSelected ? new Set() : new Set(candidates.map((_, i) => i)),
      });
      return;
    }
    if (input === "d") {
      onUpdate({ ...state, dryRun: !dryRun });
      return;
    }
    if (key.return) {
      const picked = candidates.filter((_, i) => selected.has(i));
      if (picked.length === 0) return;
      onContinue(picked);
      return;
    }
    if (key.escape || input === "q") {
      onBack();
    }
  });

  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text>Drift detected — </Text>
          <Text bold>{pluralize(candidates.length, "artifact")}</Text>
        </Box>
        {candidates.map((c, i) => {
          const isCursor = i === cursor;
          const isSelected = selected.has(i);
          const checkbox = isSelected ? "[x]" : "[ ]";
          const cursorMark = isCursor ? "▸ " : "  ";
          const tone = isCursor ? "cyan" : isSelected ? undefined : "gray";
          return (
            <Box key={`${c.adapterId}:${c.type}:${c.name}`}>
              <Text color={tone}>{cursorMark}</Text>
              <Text color={isSelected ? "green" : "gray"}>{checkbox} </Text>
              <Box width={14}>
                <Text dimColor>{safe(`${c.type}:`)}</Text>
              </Box>
              <Text bold={isCursor} color={tone} wrap="truncate-end">{safe(c.name)}</Text>
              <Text dimColor>  ({safe(c.adapterId)})</Text>
              {isCursor && (
                <Text dimColor>  {safe(relativizeFromStackRoot(c.path, stackRoot))}</Text>
              )}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color={dryRun ? "cyan" : "gray"}>{dryRun ? "[x]" : "[ ]"} </Text>
          <Text bold>Dry run</Text>
          <Text dimColor>  preview only, no files written  (press d)</Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text>{selected.size}</Text>
        <Text dimColor> of {candidates.length} selected · </Text>
        <Text dimColor>a toggle all</Text>
      </Box>
    </>
  );
}

function DoneBody({
  result,
  stackRoot,
  onAgain,
  onBack,
}: {
  result: CollectDriftResult;
  stackRoot: string;
  onAgain: () => void;
  onBack: () => void;
}) {
  const acceptedCount = result.accepted.length;
  const skippedCount = result.skipped.length;
  const tone = acceptedCount === 0 ? "yellow" : "green";
  const glyph = acceptedCount === 0 ? "⚠" : "✓";
  const headline = result.dryRun
    ? `Would accept ${pluralize(acceptedCount, "artifact")} into the bundle`
    : `Accepted ${pluralize(acceptedCount, "artifact")} into the bundle`;

  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor={tone}>
        <Box>
          <Text color={tone}>{glyph} </Text>
          <Text bold>{headline}</Text>
        </Box>
        <Box>
          <Text dimColor>output: </Text>
          <Text color="cyan">{safe(relativizeFromStackRoot(result.outputDir, stackRoot))}</Text>
        </Box>
        {skippedCount > 0 && (
          <Box>
            <Text color="yellow">skip:   </Text>
            <Text dimColor>{pluralize(skippedCount, "artifact")} (no longer drifted, missing source, …)</Text>
          </Box>
        )}
      </Box>
      {result.dryRun && result.plannedFiles && result.plannedFiles.length > 0 && (() => {
        // Multiple selections can target the same bundle file (e.g. one skill
        // tracked by both claude-code and standards). Show each bundle path
        // once so the user sees N distinct files, not N adapter records.
        const seen = new Set<string>();
        const unique = result.plannedFiles!.filter((e) => {
          const key = `${e.action}:${e.file}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return (
          <Box paddingX={1} marginBottom={1} flexDirection="column">
            <Text bold>Planned bundle changes</Text>
            {unique.slice(0, 12).map((entry, i) => (
              <Box key={i}>
                <Box width={9}>
                  <Text color={actionColor(entry.action)}>{entry.action}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">{safe(relativizeFromStackRoot(entry.file, stackRoot))}</Text>
              </Box>
            ))}
            {unique.length > 12 && (
              <Text dimColor>  …{unique.length - 12} more</Text>
            )}
          </Box>
        );
      })()}
      {!result.dryRun && acceptedCount > 0 && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>Next: </Text>
          <Text color="cyan">git diff .promptpit</Text>
          <Text dimColor> to review, then commit.</Text>
        </Box>
      )}
      <ListPicker
        options={[
          { value: "again", label: result.dryRun ? "Accept for real" : "Scan again", hint: result.dryRun ? "apply the same selection" : "re-detect remaining drift" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "again" ? onAgain() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

