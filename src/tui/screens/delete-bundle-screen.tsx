import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { useScanOptional } from "../scan-context.js";
import { ConfirmDestructive } from "../components/confirm-destructive.js";
import { WizardErrorBody } from "../components/wizard-bodies.js";
import { deleteBundle, type DeleteBundleResult } from "../../commands/delete.js";
import { log } from "../../shared/io.js";
import { homeify } from "../path-display.js";
import { safe, relativizeFromStackRoot, pluralize } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
import type { ScannedStack } from "../../shared/schema.js";

type Mode = "bundle-only" | "bundle-and-uninstall";

type State =
  | { kind: "intro" }
  | { kind: "configuring"; mode: Mode }
  | { kind: "confirming"; mode: Mode }
  | { kind: "running"; mode: Mode }
  | { kind: "done"; result: DeleteBundleResult; mode: Mode }
  | { kind: "error"; message: string; mode: Mode };

export function DeleteBundleScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const scan = useScanOptional();
  const [state, setState] = useState<State>({ kind: "intro" });

  const running = state.kind === "running" ? state : null;
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    log.withMutedNotices(() =>
      deleteBundle(stack.name, stack.root, {
        alsoUninstall: running.mode === "bundle-and-uninstall",
        dryRun: false,
      }),
    )
      .then((result) => {
        if (cancelled) return;
        setState({ kind: "done", result, mode: running.mode });
        // Bundle removal flips the stack to either unmanaged (artifacts left
        // behind) or absent (with --also-uninstall it cleans up too). Either
        // way, force a rescan so MainList reflects the new shape on pop.
        scan?.rescan();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: errorMessage(err), mode: running.mode });
        }
      });
    return () => { cancelled = true; };
  }, [running, stack.name, stack.root, scan]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Delete bundle"]}
      keys={keysFor(state)}
    >
      <SectionTitle hint="remove .promptpit/; orphans installed files">Delete bundle</SectionTitle>
      {state.kind === "intro" && (
        <IntroBody
          stack={stack}
          onContinue={() => setState({ kind: "configuring", mode: "bundle-only" })}
          onCancel={() => nav.pop()}
        />
      )}
      {state.kind === "configuring" && (
        <ConfiguringBody
          onSelect={(mode) => setState({ kind: "confirming", mode })}
          onBack={() => setState({ kind: "intro" })}
        />
      )}
      {state.kind === "confirming" && (
        <ConfirmDestructive
          expected={stack.name}
          prompt={
            state.mode === "bundle-and-uninstall"
              ? "Delete bundle AND uninstall — type the stack name to confirm"
              : "Delete bundle — type the stack name to confirm"
          }
          description={
            state.mode === "bundle-and-uninstall"
              ? "Removes installed artifacts first, then .promptpit/. Final."
              : "Removes .promptpit/ only. Installed artifacts become orphans pit can no longer track."
          }
          onConfirm={() => setState({ kind: "running", mode: state.mode })}
          onCancel={() => setState({ kind: "configuring", mode: state.mode })}
        />
      )}
      {state.kind === "running" && (
        <Box paddingX={1}>
          <Spinner
            label={
              state.mode === "bundle-and-uninstall"
                ? "Uninstalling and deleting bundle…"
                : "Deleting bundle…"
            }
          />
        </Box>
      )}
      {state.kind === "done" && (
        <DoneBody
          result={state.result}
          mode={state.mode}
          stackRoot={stack.root}
          onBack={() => nav.pop()}
        />
      )}
      {state.kind === "error" && (
        <WizardErrorBody
          headline="Delete failed"
          message={state.message}
          onBack={() => nav.pop()}
        />
      )}
    </Frame>
  );
}

function keysFor(state: State): [string, string][] {
  if (state.kind === "confirming") {
    return [["type", "name"], ["↵", "confirm"], ["esc", "back"]];
  }
  if (state.kind === "running") return [["", "working…"]];
  return [["↵", "select"], ["esc", "back"]];
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
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text>This removes the stack definition:</Text>
        <Box marginTop={1}>
          <Text color="cyan" wrap="truncate-end">{safe(homeify(`${stack.root}/.promptpit/`))}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            Installed artifacts (.cursor/, CLAUDE.md, .agents/skills/, etc.) won't be touched by
            "Bundle only" — but pit will no longer know they're from this stack. You'd have to
            clean them up manually or reinstall to restore tracking.
          </Text>
        </Box>
      </Box>
      <ListPicker
        options={[
          { value: "continue", label: "Continue", hint: "choose what to delete" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "continue" ? onContinue() : onCancel())}
        onCancel={onCancel}
      />
    </>
  );
}

function ConfiguringBody({
  onSelect,
  onBack,
}: {
  onSelect: (mode: Mode) => void;
  onBack: () => void;
}) {
  type PickerValue = Mode | "cancel";
  return (
    <>
      <Box paddingX={1} marginBottom={1}>
        <Text bold>What do you want to delete?</Text>
      </Box>
      <ListPicker<PickerValue>
        options={[
          {
            value: "bundle-only",
            label: "Bundle only",
            hint: "orphans installed artifacts; pit forgets the stack",
          },
          {
            value: "bundle-and-uninstall",
            label: "Bundle + uninstall",
            hint: "runs uninstall first, then removes the bundle",
          },
          { value: "cancel", label: "Cancel" },
        ]}
        onSelect={(v) => (v === "cancel" ? onBack() : onSelect(v))}
        onCancel={onBack}
      />
    </>
  );
}

function DoneBody({
  result,
  mode,
  stackRoot,
  onBack,
}: {
  result: DeleteBundleResult;
  mode: Mode;
  stackRoot: string;
  onBack: () => void;
}) {
  const removedCount = result.uninstall?.removed.filter((r) => r.kind !== "manifest").length ?? 0;
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="green">
        <Box>
          <Text color="green">✓ </Text>
          <Text bold>
            {mode === "bundle-and-uninstall"
              ? "Uninstalled and deleted bundle"
              : "Deleted bundle"}
          </Text>
        </Box>
        <Box>
          <Text dimColor>bundle: </Text>
          <Text color="cyan">{safe(relativizeFromStackRoot(result.bundlePath, stackRoot))}</Text>
        </Box>
        {result.uninstall && removedCount > 0 && (
          <Box>
            <Text dimColor>uninst: </Text>
            <Text>{pluralize(removedCount, "artifact")} removed</Text>
          </Box>
        )}
      </Box>
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>The stack will not appear in </Text>
        <Text color="cyan">pit ls</Text>
        <Text dimColor> until you re-init or reinstall.</Text>
      </Box>
      <ListPicker
        options={[{ value: "back", label: "Back" }]}
        onSelect={() => onBack()}
        onCancel={onBack}
      />
    </>
  );
}

