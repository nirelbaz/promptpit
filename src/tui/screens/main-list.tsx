// Main stack list. Fires scan() on mount, shows a spinner while it runs,
// routes to the empty-state screen when nothing's found, otherwise renders
// the partitioned list (locals first, globals below a divider) with an
// inline detail strip under the cursor.
import path from "node:path";
import { homedir } from "node:os";
import { Box, Text, useApp, useInput } from "ink";
import { Fragment, useEffect, useState } from "react";
import { Frame, type KeyHint } from "../chrome.js";
import { Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { scan } from "../../core/scan.js";
import { loadConfig } from "../../core/config.js";
import { log } from "../../shared/io.js";
import type { ScannedStack, PitConfig } from "../../shared/schema.js";
import { StackDetail } from "./stack-detail.js";
import { ScopePicker } from "./scope-picker.js";
import { EmptyState } from "./empty-state.js";

const GLOBAL_ROOTS = [
  path.join(homedir(), ".claude"),
  path.join(homedir(), ".cursor"),
  path.join(homedir(), ".codex"),
  path.join(homedir(), ".github"),
  path.join(homedir(), ".agents", "skills"),
];

type State =
  | { kind: "loading" }
  | { kind: "ready"; stacks: ScannedStack[]; suppressed: number; config: PitConfig }
  | { kind: "error"; message: string };

export function MainList({ cwd }: { cwd: string }) {
  const nav = useNav();
  const { exit } = useApp();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0); // bump to force rescan

  useEffect(() => {
    let cancelled = false;
    // In-flight guard: repeated `r` presses bump `tick`, which re-fires this
    // effect. The cancelled flag blocks stale setState, but the scan itself
    // still runs — N concurrent fs walkers on a chatty key is wasteful.
    // A new tick cancels the old effect's cleanup first, which flips the
    // prior cancelled flag; the prior scan becomes a no-op on completion.
    setState((prev) => (prev.kind === "loading" ? prev : { kind: "loading" }));
    (async () => {
      const config = await loadConfig(homedir(), { silent: true });
      const { result: stacks, suppressed } = await log.withMutedWarnings(() =>
        scan({
          cwd,
          globalRoots: config.ui.showGlobalRow ? GLOBAL_ROOTS : [],
          depth: config.scan.defaultDepth,
          ignoreGlobs: config.scan.ignore,
        }),
      );
      if (!cancelled) setState({ kind: "ready", stacks, suppressed, config });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    });
    return () => { cancelled = true; };
  }, [cwd, tick]);

  useInput((input, key) => {
    if (state.kind !== "ready" || state.stacks.length === 0) {
      if (input === "q") exit();
      return;
    }
    const { locals, globals } = partition(state.stacks, cwd);
    const flat = [...locals, ...globals];
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(flat.length - 1, c + 1));
    else if (key.return) {
      // Clamp against the current flat length — a rescan may have shrunk
      // the list since the cursor was last moved, and flat[staleCursor]
      // could be undefined. Enter silently no-ops in that case.
      const idx = Math.min(cursor, flat.length - 1);
      const chosen = flat[idx];
      if (chosen) nav.push(() => <StackDetail stack={chosen.stack} />);
    }
    // Rescan spam guard: ignore `r` while already loading. A rapid repeat
    // otherwise spawns parallel scans (previous effect's scan keeps walking
    // the fs even though its setState is cancelled).
    else if (input === "s") nav.push(() => <ScopePicker onPick={() => setTick((t) => t + 1)} />);
    else if (input === "r" && state.kind === "ready") setTick((t) => t + 1);
    else if (input === "q") exit();
  });

  if (state.kind === "loading") {
    return (
      <Frame crumbs={["Stacks"]} keys={[["q", "quit"]]}>
        <Box paddingX={1}><Spinner label="Scanning…" /></Box>
      </Frame>
    );
  }

  if (state.kind === "error") {
    return (
      <Frame crumbs={["Stacks", "Error"]} keys={[["q", "quit"]]}>
        <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="red">
          <Box><Text color="red">✖ </Text><Text bold>Scan failed</Text></Box>
          <Text dimColor>{state.message}</Text>
        </Box>
      </Frame>
    );
  }

  if (state.stacks.length === 0) {
    return <EmptyState cwd={homeify(cwd)} scopeLabel="current tree (depth 5) + global" />;
  }

  const { locals, globals } = partition(state.stacks, cwd);
  const flat = [...locals, ...globals];
  const cursorClamped = Math.min(cursor, flat.length - 1);

  const footerKeys: KeyHint[] = [
    ["↑↓", "nav"],
    ["↵", "open"],
    ["r", "rescan"],
    ["s", "scope"],
    ["q", "quit"],
  ];

  return (
    <Frame
      crumbs={["Stacks"]}
      right={`${homeify(cwd)} · ${state.stacks.length} stack${state.stacks.length === 1 ? "" : "s"}`}
      keys={footerKeys}
    >
      {locals.map((item, i) => (
        <Fragment key={item.stack.root}>
          <StackRow item={item} selected={i === cursorClamped} />
          {i === cursorClamped && <ExpandedDetail stack={item.stack} />}
        </Fragment>
      ))}
      {globals.length > 0 && (
        <Box paddingX={1} marginTop={1} marginBottom={0}>
          <Text dimColor>─── global ───</Text>
        </Box>
      )}
      {globals.map((item, i) => {
        const idx = locals.length + i;
        return (
          <Fragment key={item.stack.root}>
            <StackRow item={item} selected={idx === cursorClamped} />
            {idx === cursorClamped && <ExpandedDetail stack={item.stack} />}
          </Fragment>
        );
      })}
      {state.suppressed > 0 && (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>
            {state.suppressed} config file{state.suppressed === 1 ? "" : "s"} had parse issues — run{" "}
            <Text color="cyan">pit validate</Text>{" "}for details.
          </Text>
        </Box>
      )}
    </Frame>
  );
}

interface RenderItem {
  stack: ScannedStack;
  displayPath: string | null;
  depth: number;
}

function partition(stacks: ScannedStack[], cwd: string): { locals: RenderItem[]; globals: RenderItem[] } {
  const home = homedir();
  const cwdR = path.resolve(cwd);
  const localsWithDepth: RenderItem[] = [];
  const globals: RenderItem[] = [];

  for (const s of stacks) {
    if (s.kind === "global") {
      globals.push({ stack: s, displayPath: homeify(s.root), depth: 0 });
      continue;
    }
    const { display, depth } = describePath(cwdR, s.root, home, s.name);
    localsWithDepth.push({ stack: s, displayPath: display, depth });
  }
  localsWithDepth.sort((a, b) => a.depth - b.depth || a.stack.root.localeCompare(b.stack.root));
  return { locals: localsWithDepth, globals };
}

function describePath(cwdR: string, root: string, _home: string, name: string): { display: string | null; depth: number } {
  const rootR = path.resolve(root);
  if (rootR === cwdR) return { display: null, depth: 0 };
  const rel = path.relative(cwdR, rootR);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const segs = rel.split(path.sep);
    const depth = segs.length;
    if (segs[segs.length - 1] === name) {
      if (segs.length === 1) return { display: null, depth };
      return { display: toForwardSlash(`./${segs.slice(0, -1).join(path.sep)}/`), depth };
    }
    return { display: toForwardSlash(`./${rel}`), depth };
  }
  return { display: homeify(rootR), depth: Number.POSITIVE_INFINITY };
}

function homeify(p: string): string {
  const home = homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

function toForwardSlash(p: string): string {
  return path.sep === "\\" ? p.replace(/\\/g, "/") : p;
}

function StackRow({ item, selected }: { item: RenderItem; selected: boolean }) {
  const { stack: s, displayPath } = item;
  const glyph = s.kind === "managed" ? "●" : s.kind === "unmanaged" ? "○" : "◉";
  const glyphColor = s.kind === "managed" ? "green" : s.kind === "unmanaged" ? "gray" : "cyan";
  const right = s.kind === "managed"
    ? `managed · v${s.promptpit?.stackVersion ?? "?"}${s.overallDrift === "drifted" ? " · drifted" : ""}`
    : s.kind;
  const rightColor = s.kind === "managed"
    ? (s.overallDrift === "drifted" ? "yellow" : "cyan")
    : s.kind === "global" ? "cyan" : "gray";
  return (
    <Box>
      <Text color={selected ? "cyan" : undefined}>{selected ? "  ▸ " : "    "}</Text>
      <Text color={glyphColor}>{glyph} </Text>
      {/* Fixed-width columns with truncate-end so long names/paths clip to
          ellipsis instead of wrapping and shoving the status chip off the
          row. Name gets the most room because it's the primary field; path
          is always optional context. */}
      <Box width={30}><Text bold={selected} wrap="truncate-end">{s.name}</Text></Box>
      <Box width={24}><Text dimColor wrap="truncate-end">{displayPath ?? ""}</Text></Box>
      <Text color={rightColor} wrap="truncate-end">{right}</Text>
    </Box>
  );
}

function ExpandedDetail({ stack: s }: { stack: ScannedStack }) {
  return (
    <Box flexDirection="column" marginLeft={6} marginTop={1} marginBottom={1}>
      {s.adapters.map((a) => {
        const parts: string[] = [];
        if (a.artifacts.skills) parts.push(`${a.artifacts.skills}s`);
        if (a.artifacts.agents) parts.push(`${a.artifacts.agents}a`);
        if (a.artifacts.rules) parts.push(`${a.artifacts.rules} rules`);
        if (a.artifacts.commands) parts.push(`${a.artifacts.commands} cmd`);
        if (a.artifacts.mcp) parts.push(`${a.artifacts.mcp} mcp`);
        if (a.artifacts.instructions) parts.push("inst");
        const counts = parts.length > 0 ? parts.join(" · ") : null;
        return (
          <Box key={a.id}>
            <Box width={14}><Text color="gray">{a.id}</Text></Box>
            {counts ? <Text>{counts}</Text> : <Text dimColor>—</Text>}
            {a.drift === "drifted" && <Text color="yellow">  drifted</Text>}
          </Box>
        );
      })}
      {s.unsupportedTools.length > 0 && (
        <Box><Text dimColor>└─ unsupported: {s.unsupportedTools.join(", ")}</Text></Box>
      )}
    </Box>
  );
}
