import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { useScanOptional } from "../scan-context.js";
import { ConfirmDestructive } from "../components/confirm-destructive.js";
import { WizardErrorBody, actionColor } from "../components/wizard-bodies.js";
import { uninstallStack, type UninstallResult } from "../../commands/uninstall.js";
import { log } from "../../shared/io.js";
import { homeify } from "../path-display.js";
import { safe, relativizeFromStackRoot, pluralize } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "intro" }
  | { kind: "configuring"; force: boolean; dryRun: boolean }
  | { kind: "confirming"; force: boolean; dryRun: boolean }
  | { kind: "running"; force: boolean; dryRun: boolean }
  | { kind: "done"; result: UninstallResult; force: boolean }
  | { kind: "error"; message: string; force: boolean; dryRun: boolean };

export function UninstallScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const scan = useScanOptional();
  const [state, setState] = useState<State>({ kind: "intro" });

  // Like collect-screen: only the running-state entry should kick off the
  // command. Listing the whole `state` re-fires on every transition.
  const running = state.kind === "running" ? state : null;
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    log.withMutedNotices(() =>
      uninstallStack(stack.name, stack.root, { force: running.force, dryRun: running.dryRun }),
    )
      .then((result) => {
        if (cancelled) return;
        setState({ kind: "done", result, force: running.force });
        // Real uninstall flips managed → unmanaged (or removes it entirely
        // when no other installs remain). Refresh the scan so StackDetail
        // renders the new state when the user pops back.
        if (!result.dryRun) scan?.rescan();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: errorMessage(err),
            force: running.force,
            dryRun: running.dryRun,
          });
        }
      });
    return () => { cancelled = true; };
  }, [running, stack.name, stack.root, scan]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Uninstall"]}
      keys={keysFor(state)}
    >
      <SectionTitle hint="remove installed artifacts; bundle stays">Uninstall</SectionTitle>
      {state.kind === "intro" && (
        <IntroBody
          stack={stack}
          onContinue={() => setState({ kind: "configuring", force: false, dryRun: false })}
          onCancel={() => nav.pop()}
        />
      )}
      {state.kind === "configuring" && (
        <ConfiguringBody
          force={state.force}
          dryRun={state.dryRun}
          onToggleForce={() => setState({ ...state, force: !state.force })}
          onToggleDryRun={() => setState({ ...state, dryRun: !state.dryRun })}
          onContinue={() => setState(
            // Force is high-stakes — a typed-name confirm gate stops a
            // single Enter from blowing away modified artifacts. Without
            // force, modified artifacts are skipped automatically, so a
            // ListPicker confirm in this same step is enough (the picker's
            // primary action requires Enter).
            state.force && !state.dryRun
              ? { kind: "confirming", force: state.force, dryRun: state.dryRun }
              : { kind: "running", force: state.force, dryRun: state.dryRun },
          )}
          onBack={() => setState({ kind: "intro" })}
        />
      )}
      {state.kind === "confirming" && (
        <ConfirmDestructive
          expected={stack.name}
          prompt="Force uninstall — type the stack name to confirm"
          description="Force removes modified artifacts. Local edits will be destroyed."
          onConfirm={() => setState({ kind: "running", force: state.force, dryRun: state.dryRun })}
          onCancel={() => setState({ kind: "configuring", force: state.force, dryRun: state.dryRun })}
        />
      )}
      {state.kind === "running" && (
        <Box paddingX={1}>
          <Spinner label={state.dryRun ? "Previewing uninstall…" : "Uninstalling…"} />
        </Box>
      )}
      {state.kind === "done" && (
        <DoneBody
          result={state.result}
          stackRoot={stack.root}
          onAgain={() => setState(
            state.result.dryRun
              // Dry-run done → "Uninstall for real" jumps straight to running
              // with the same force flag. Repeating the dry-run config flow
              // would just re-toggle the same checkboxes.
              ? { kind: "running", force: state.force, dryRun: false }
              : { kind: "configuring", force: false, dryRun: false },
          )}
          onBack={() => nav.pop()}
        />
      )}
      {state.kind === "error" && (
        <WizardErrorBody
          headline="Uninstall failed"
          message={state.message}
          onRetry={() => setState({ kind: "running", force: state.force, dryRun: state.dryRun })}
          onBack={() => nav.pop()}
        />
      )}
    </Frame>
  );
}

function keysFor(state: State) {
  if (state.kind === "configuring") {
    return [["space", "toggle"], ["↵", "continue"], ["esc", "back"]] as [string, string][];
  }
  if (state.kind === "confirming") {
    return [["type", "name"], ["↵", "confirm"], ["esc", "back"]] as [string, string][];
  }
  if (state.kind === "running") {
    return [["", "working…"]] as [string, string][];
  }
  return [["↵", "select"], ["esc", "back"]] as [string, string][];
}

function IntroBody({
  stack,
  onContinue,
  onCancel,
}: {
  stack: ScannedStack;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const isManaged = stack.kind === "managed";
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text>Remove the installed artifacts of this stack.</Text>
        <Box marginTop={1}>
          <Text dimColor>stack: </Text>
          <Text bold color="cyan" wrap="truncate-end">{safe(stack.name)}</Text>
        </Box>
        <Box>
          <Text dimColor>from:  </Text>
          <Text color="cyan" wrap="truncate-end">{safe(homeify(stack.root))}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">The bundle (.promptpit/) stays — you can reinstall any time.</Text>
        </Box>
        {!isManaged && (
          <Box marginTop={1}>
            <Text color="yellow" wrap="wrap">⚠ This stack is not managed by pit. There may be nothing to uninstall.</Text>
          </Box>
        )}
      </Box>
      <ListPicker
        options={[
          { value: "continue", label: "Continue", hint: "configure the run" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "continue" ? onContinue() : onCancel())}
        onCancel={onCancel}
      />
    </>
  );
}

function ConfiguringBody({
  force,
  dryRun,
  onToggleForce,
  onToggleDryRun,
  onContinue,
  onBack,
}: {
  force: boolean;
  dryRun: boolean;
  onToggleForce: () => void;
  onToggleDryRun: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  // Cursor-driven toggles outside the ListPicker so the picker's "Enter
  // selects" semantics stay clean. The two toggles share key bindings:
  // f = force, d = dry-run, space = whichever is active by convention. We
  // treat space as toggling dry-run (the more common preview path) and
  // bind force to f explicitly.
  useInput((input) => {
    if (input === "f") onToggleForce();
    if (input === " " || input === "d") onToggleDryRun();
  });
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Box>
          <Text color={force ? "red" : "gray"}>{force ? "[x]" : "[ ]"} </Text>
          <Text bold>Force</Text>
          <Text dimColor>  remove modified artifacts (destroys local edits)  (press f)</Text>
        </Box>
        <Box>
          <Text color={dryRun ? "cyan" : "gray"}>{dryRun ? "[x]" : "[ ]"} </Text>
          <Text bold>Dry run</Text>
          <Text dimColor>  preview only, no files written  (press space)</Text>
        </Box>
      </Box>
      <ListPicker
        options={[
          {
            value: "go",
            label: dryRun ? "Preview" : force ? "Force uninstall" : "Uninstall",
            hint: dryRun
              ? "show what would be removed"
              : force
                ? "type-confirm, then remove (incl. modified)"
                : "remove tracked artifacts (skip modified)",
          },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "go" ? onContinue() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

function DoneBody({
  result,
  stackRoot,
  onAgain,
  onBack,
}: {
  result: UninstallResult;
  stackRoot: string;
  onAgain: () => void;
  onBack: () => void;
}) {
  const removedCount = result.removed.filter((r) => r.kind !== "manifest").length;
  const sharedCount = result.skipped.filter((s) => s.reason === "shared").length;
  const modifiedCount = result.skipped.filter((s) => s.reason === "modified").length;

  const headline = result.dryRun
    ? `Would uninstall ${pluralize(removedCount, "artifact")}`
    : `Uninstalled ${pluralize(removedCount, "artifact")}`;
  const tone = removedCount === 0 && modifiedCount === 0 ? "yellow" : "green";
  const glyph = removedCount === 0 ? "⚠" : "✓";

  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor={tone}>
        <Box>
          <Text color={tone}>{glyph} </Text>
          <Text bold>{headline}</Text>
        </Box>
        <Box>
          <Text dimColor>stack:  </Text>
          <Text>{safe(result.stack)}@{safe(result.version)}</Text>
        </Box>
        {Object.keys(result.perAdapterRemoved).length > 0 && (
          <Box>
            <Text dimColor>tools:  </Text>
            <Text>
              {Object.entries(result.perAdapterRemoved)
                .filter(([adapter]) => adapter !== "canonical")
                .map(([adapter, n]) => `${safe(adapter)} (${n})`)
                .join(", ") || "—"}
            </Text>
          </Box>
        )}
        {sharedCount > 0 && (
          <Box>
            <Text color="cyan">kept:   </Text>
            <Text dimColor>{pluralize(sharedCount, "artifact")} shared with other stacks</Text>
          </Box>
        )}
        {modifiedCount > 0 && (
          <Box>
            <Text color="yellow">skip:   </Text>
            <Text dimColor>{pluralize(modifiedCount, "artifact")} modified since install (use Force to override)</Text>
          </Box>
        )}
        {result.manifestRemoved && (
          <Box>
            <Text dimColor>note:   </Text>
            <Text dimColor>{result.dryRun ? "would remove" : "removed"} installed.json (last stack)</Text>
          </Box>
        )}
      </Box>
      {result.dryRun && result.plannedFiles && result.plannedFiles.length > 0 && (
        <Box paddingX={1} marginBottom={1} flexDirection="column">
          <Text bold>Planned files</Text>
          {result.plannedFiles.slice(0, 12).map((entry, i) => (
            <Box key={i}>
              <Box width={9}>
                <Text color={actionColor(entry.action)}>{entry.action}</Text>
              </Box>
              <Text dimColor wrap="truncate-end">{safe(relativizeFromStackRoot(entry.file, stackRoot))}</Text>
            </Box>
          ))}
          {result.plannedFiles.length > 12 && (
            <Text dimColor>  …{result.plannedFiles.length - 12} more</Text>
          )}
        </Box>
      )}
      <ListPicker
        options={[
          {
            value: "again",
            label: result.dryRun ? "Uninstall for real" : "Run again",
            hint: result.dryRun ? "remove tracked artifacts" : "re-run with same options",
          },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "again" ? onAgain() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

