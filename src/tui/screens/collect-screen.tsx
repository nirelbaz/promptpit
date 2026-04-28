import path from "node:path";
import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { Frame, SectionTitle } from "../chrome.js";
import { ListPicker, Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { useScanOptional } from "../scan-context.js";
import { collectStack, type CollectResult } from "../../commands/collect.js";
import { log } from "../../shared/io.js";
import { safe, relativizeFromStackRoot, pluralize } from "../../shared/text.js";
import { errorMessage } from "../../shared/utils.js";
import type { ScannedStack } from "../../shared/schema.js";

type State =
  | { kind: "intro" }
  | { kind: "configuring"; dryRun: boolean }
  | { kind: "running"; dryRun: boolean }
  | { kind: "done"; result: CollectResult }
  | { kind: "error"; message: string; dryRun: boolean };

export function CollectScreen({ stack }: { stack: ScannedStack }) {
  const nav = useNav();
  const scan = useScanOptional();
  const [state, setState] = useState<State>({ kind: "intro" });

  // Narrow deps: only the running-state entry should kick off collect, and
  // only its dryRun flag matters. Listing the whole `state` object would
  // re-fire the effect on every transition (intro→configuring→…) and waste
  // the early-return guard's work on each.
  const runningDryRun = state.kind === "running" ? state.dryRun : null;
  useEffect(() => {
    if (runningDryRun === null) return;
    let cancelled = false;
    const outputDir = path.join(stack.root, ".promptpit");
    // Mute every log/spinner/dry-run-report channel: collectStack normally
    // talks to humans through stderr (spinners, log.info/success/warn) and
    // stdout (printDryRunReport). All of that fights Ink's alt-screen. The
    // wizard reads the structured CollectResult instead.
    log.withMutedNotices(() =>
      collectStack(stack.root, outputDir, { dryRun: runningDryRun }),
    )
      .then((result) => {
        if (cancelled) return;
        setState({ kind: "done", result });
        // A real collect just flipped this stack from unmanaged → managed
        // (or refreshed an existing bundle). Invalidate the cached scan so
        // the breadcrumb chip and stack list pick up the new state when the
        // user returns. Dry runs write nothing, so no rescan needed.
        if (!result.dryRun) scan?.rescan();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: errorMessage(err), dryRun: runningDryRun });
        }
      });
    return () => { cancelled = true; };
  }, [runningDryRun, stack.root, scan]);

  return (
    <Frame
      crumbs={["Stacks", stack.name, "Collect"]}
      keys={keysFor(state)}
    >
      <SectionTitle hint="bundle this project's AI config into .promptpit/">Collect</SectionTitle>
      {state.kind === "intro" && <IntroBody stack={stack} onContinue={() => setState({ kind: "configuring", dryRun: false })} onCancel={() => nav.pop()} />}
      {state.kind === "configuring" && (
        <ConfiguringBody
          dryRun={state.dryRun}
          onToggleDryRun={() => setState({ ...state, dryRun: !state.dryRun })}
          onContinue={() => setState({ kind: "running", dryRun: state.dryRun })}
          onBack={() => setState({ kind: "intro" })}
        />
      )}
      {state.kind === "running" && (
        <Box paddingX={1}>
          <Spinner label={state.dryRun ? "Previewing collect…" : "Collecting AI config…"} />
        </Box>
      )}
      {state.kind === "done" && (
        <DoneBody
          result={state.result}
          stackRoot={stack.root}
          onAgain={() => setState(
            // After a dry-run, "Collect for real" should do exactly that —
            // not bounce back to the configuring screen with [x] Dry run still
            // checked, where the user has to remember to untoggle it. After a
            // real collect, "Run again" goes back to configuring so options
            // can be tweaked before re-running.
            state.result.dryRun
              ? { kind: "running", dryRun: false }
              : { kind: "configuring", dryRun: false },
          )}
          onBack={() => nav.pop()}
        />
      )}
      {state.kind === "error" && (
        <ErrorBody
          message={state.message}
          onRetry={() => setState({ kind: "running", dryRun: state.dryRun })}
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
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text>Bundle this project's AI config into </Text>
        <Text color="cyan">{safe(path.join(stack.root, ".promptpit"))}</Text>
        <Box marginTop={1}>
          <Text dimColor>Walks every detected tool, merges configs, strips secrets to .env.example, writes the bundle.</Text>
        </Box>
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
  dryRun,
  onToggleDryRun,
  onContinue,
  onBack,
}: {
  dryRun: boolean;
  onToggleDryRun: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  // Space toggles dry-run; Enter on the picker continues. Putting the toggle
  // outside the ListPicker keeps the picker's row semantics clean (no
  // checkbox row that has to special-case "select means toggle, not run").
  useInput((input) => {
    if (input === " ") onToggleDryRun();
  });
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Box>
          <Text color={dryRun ? "cyan" : "gray"}>{dryRun ? "[x]" : "[ ]"} </Text>
          <Text bold>Dry run</Text>
          <Text dimColor>  preview only, no files written  (press space to toggle)</Text>
        </Box>
      </Box>
      <ListPicker
        options={[
          { value: "go", label: dryRun ? "Preview" : "Collect", hint: dryRun ? "show what would be written" : "write the bundle" },
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
  result: CollectResult;
  stackRoot: string;
  onAgain: () => void;
  onBack: () => void;
}) {
  const summaryParts = collectSummaryParts(result);
  const headline = headlineFor(result.dryRun, summaryParts);
  const empty = summaryParts.length === 0;
  const tone = empty ? "yellow" : "green";
  const glyph = empty ? "⚠" : "✓";
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
        {result.detected.length > 0 && (
          <Box>
            <Text dimColor>tools:  </Text>
            <Text>{result.detected.map(safe).join(", ")}</Text>
          </Box>
        )}
      </Box>
      {result.dryRun && result.plannedFiles && result.plannedFiles.length > 0 && (
        <Box paddingX={1} marginBottom={1} flexDirection="column">
          <Text bold>Planned files</Text>
          {result.plannedFiles.slice(0, 12).map((entry, i) => (
            <Box key={i}>
              <Box width={9}>
                <Text color={entry.action === "create" ? "green" : "yellow"}>{entry.action}</Text>
              </Box>
              <Text dimColor wrap="truncate-end">{safe(relativizeFromStackRoot(entry.file, stackRoot))}</Text>
            </Box>
          ))}
          {result.plannedFiles.length > 12 && (
            <Text dimColor>  …{result.plannedFiles.length - 12} more</Text>
          )}
        </Box>
      )}
      {!result.dryRun && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>Next: run </Text>
          <Text color="cyan">pit validate</Text>
          <Text dimColor>, then </Text>
          <Text color="cyan">git add .promptpit && git commit</Text>
          <Text dimColor>.</Text>
        </Box>
      )}
      <ListPicker
        options={[
          { value: "again", label: result.dryRun ? "Collect for real" : "Run again", hint: result.dryRun ? "write the bundle" : "re-run with same options" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "again" ? onAgain() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

function ErrorBody({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="red">
        <Box><Text color="red">✖ </Text><Text bold>Collect failed</Text></Box>
        <Text dimColor>{safe(message)}</Text>
      </Box>
      <ListPicker
        options={[
          { value: "retry", label: "Retry" },
          { value: "back", label: "Back" },
        ]}
        onSelect={(v) => (v === "retry" ? onRetry() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

function headlineFor(dryRun: boolean, parts: string[]): string {
  if (parts.length === 0) {
    return dryRun ? "Nothing to collect" : "Stack bundle written (no artifacts found)";
  }
  const joined = parts.join(", ");
  return dryRun ? `Would collect: ${joined}` : `Collected: ${joined}`;
}

function collectSummaryParts(result: CollectResult): string[] {
  const c = result.counts;
  const parts: string[] = [];
  if (c.instructionFile) parts.push("1 instruction file");
  if (c.skills > 0) parts.push(pluralize(c.skills, "skill"));
  if (c.agents > 0) parts.push(pluralize(c.agents, "agent"));
  if (c.rules > 0) parts.push(pluralize(c.rules, "rule"));
  if (c.commands > 0) parts.push(pluralize(c.commands, "command"));
  if (c.mcpServers > 0) parts.push(pluralize(c.mcpServers, "MCP server"));
  if (c.secretsStripped > 0) parts.push(`${pluralize(c.secretsStripped, "secret")} stripped`);
  return parts;
}
