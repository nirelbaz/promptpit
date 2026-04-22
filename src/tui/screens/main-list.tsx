import path from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { Fragment, useMemo } from "react";
import { Frame, type KeyHint } from "../chrome.js";
import { Spinner } from "../primitives.js";
import { useNav } from "../nav.js";
import { useScan, scopeLabel } from "../scan-context.js";
import type { ScannedStack } from "../../shared/schema.js";
import { glyphFor, glyphColorFor, driftToneFor, compactAdapterSummary } from "../stack-presentation.js";
import { safe } from "../../shared/text.js";
import { homeify, describeStackPath } from "../path-display.js";
import { StackDetail } from "./stack-detail.js";
import { ScopePicker } from "./scope-picker.js";
import { EmptyState } from "./empty-state.js";

export function MainList() {
  const nav = useNav();
  const { exit } = useApp();
  const { cwd, state, scope, cursor, setCursor, setScope, rescan } = useScan();

  const partitioned = useMemo(() => {
    if (state.kind !== "ready") {
      return { managed: [] as RenderItem[], unmanaged: [] as RenderItem[], global: [] as RenderItem[], flat: [] as RenderItem[] };
    }
    return partition(state.stacks, cwd);
  }, [state, cwd]);

  useInput((input, key) => {
    if (state.kind !== "ready" || state.stacks.length === 0) {
      // Esc and q both quit from the root list — EmptyState does the same,
      // keeping the "Esc = back out of pit" model consistent everywhere.
      if (input === "q" || key.escape) exit();
      return;
    }
    const { flat } = partitioned;
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
    else if (input === "s") nav.push(() => <ScopePicker onPick={setScope} />);
    else if (input === "r") rescan();
    else if (input === "q" || key.escape) exit();
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
    return (
      <EmptyState
        cwd={homeify(cwd)}
        scopeLabel={scopeLabel(scope, state.config.scan.defaultDepth)}
        onScope={setScope}
      />
    );
  }

  const { managed, unmanaged, global, flat } = partitioned;
  const cursorClamped = Math.min(cursor, flat.length - 1);

  const footerKeys: KeyHint[] = [
    ["↑↓", "nav"],
    ["↵", "open"],
    ["r", "rescan"],
    ["s", "scope"],
    ["q/esc", "quit"],
  ];

  // Sections with tone-colored counts. Empty sections are skipped so the
  // user doesn't see "Unmanaged (0)" as dead whitespace.
  const sections: Array<{ label: string; color: string; items: RenderItem[] }> = [
    { label: `${glyphFor("managed")} Managed`,     color: glyphColorFor("managed"),   items: managed },
    { label: `${glyphFor("unmanaged")} Unmanaged`, color: glyphColorFor("unmanaged"), items: unmanaged },
    { label: `${glyphFor("global")} Global`,       color: glyphColorFor("global"),    items: global },
  ];

  return (
    <Frame
      crumbs={["Stacks"]}
      right={`${homeify(cwd)} · ${state.stacks.length} stack${state.stacks.length === 1 ? "" : "s"}`}
      keys={footerKeys}
    >
      {/* Section's `first` flag suppresses its marginTop so the first
          non-empty section sits one line under the header (Frame already
          provides that gap), not two. */}
      {sections
        .filter((sec) => sec.items.length > 0)
        .map((sec, sectionIdx, visible) => {
          // Flat indices are section-adjacent ranges. Compute each section's
          // starting offset once rather than linear-scanning `flat` per row.
          const sectionStart = visible
            .slice(0, sectionIdx)
            .reduce((acc, s) => acc + s.items.length, 0);
          return (
            <Fragment key={sec.label}>
              <SectionHeader label={sec.label} count={sec.items.length} color={sec.color} first={sectionIdx === 0} />
              {sec.items.map((item, localIdx) => {
                const selected = sectionStart + localIdx === cursorClamped;
                return (
                  <Fragment key={item.stack.root}>
                    <StackRow item={item} selected={selected} />
                    {selected && <CursorPath item={item} />}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      {state.suppressed > 0 && (
        <Box paddingX={1} marginTop={2}>
          <Text color="yellow">⚠ </Text>
          <Text color="yellow">{state.suppressed}</Text>
          <Text dimColor>
            {" "}config file{state.suppressed === 1 ? "" : "s"} had parse issues  ·  run{" "}
          </Text>
          <Text color="cyan">pit validate</Text>
          <Text dimColor>{" "}for details</Text>
        </Box>
      )}
      {/* Legend tight against whatever's above — the separator line already
          does the visual work of splitting content from chrome, no gap needed. */}
      <Legend tight={state.suppressed > 0} />
    </Frame>
  );
}

interface RenderItem {
  stack: ScannedStack;
  displayPath: string | null;
  depth: number;
}

function partition(stacks: ScannedStack[], cwd: string): {
  managed: RenderItem[];
  unmanaged: RenderItem[];
  global: RenderItem[];
  flat: RenderItem[];
} {
  const cwdR = path.resolve(cwd);
  const managed: RenderItem[] = [];
  const unmanaged: RenderItem[] = [];
  const global: RenderItem[] = [];

  for (const s of stacks) {
    if (s.kind === "global") {
      global.push({ stack: s, displayPath: homeify(s.root), depth: 0 });
      continue;
    }
    const { display, depth } = describeStackPath(cwdR, s.root, s.name);
    const item: RenderItem = { stack: s, displayPath: display, depth };
    if (s.kind === "managed") managed.push(item);
    else unmanaged.push(item);
  }

  const byDepthThenRoot = (a: RenderItem, b: RenderItem) =>
    a.depth - b.depth || a.stack.root.localeCompare(b.stack.root);
  managed.sort(byDepthThenRoot);
  unmanaged.sort(byDepthThenRoot);

  return { managed, unmanaged, global, flat: [...managed, ...unmanaged, ...global] };
}

function SectionHeader({ label, count, color, first }: { label: string; count: number; color: string; first?: boolean }) {
  return (
    <Box paddingX={1} marginTop={first ? 0 : 1}>
      <Text color={color} bold>{label}</Text>
      <Text dimColor>  ({count})</Text>
    </Box>
  );
}

function StackRow({ item, selected }: { item: RenderItem; selected: boolean }) {
  const { stack: s } = item;
  const tone = driftToneFor(s);
  // "0.0.0" is the scanner's fallback for missing/unreadable stack.json —
  // treat it as "no version to show" rather than rendering `v0.0.0`.
  const version = s.promptpit?.stackVersion;
  const middle = version && version !== "0.0.0" ? `v${version}` : "";
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        <Text color={selected ? "cyan" : undefined}>{selected ? "▸ " : "  "}</Text>
        <Box width={30}><Text bold={selected} wrap="truncate-end">{safe(s.name)}</Text></Box>
        <Box width={14}><Text dimColor>{middle}</Text></Box>
        <Text color={tone.color}>{tone.label}</Text>
      </Box>
      {s.adapters.length > 0 && (
        <Box paddingLeft={4}>
          <Text dimColor wrap="truncate-end">{safe(compactAdapterSummary(s))}</Text>
        </Box>
      )}
    </Box>
  );
}

function CursorPath({ item }: { item: RenderItem }) {
  // Minimal expand on the selected row — just the path, so the user can
  // confirm "this is the stack I mean" before pressing Enter. Everything
  // else (origins, extends, installs, nested subpaths, unsupported tools,
  // per-artifact drift) lives on StackDetail where it has room.
  //
  // Suppressed when the path would be redundant:
  //   - `displayPath === null` — stack sits at cwd, already in the Frame
  //     header's right chip.
  //   - `kind === "global"` — the ◉ Global section header and the stack
  //     name already say "this lives under your home dir"; the actual
  //     directory (usually ~/.claude) is noise here and lands on
  //     StackDetail instead.
  if (item.displayPath === null) return null;
  if (item.stack.kind === "global") return null;
  return (
    <Box paddingLeft={6} marginBottom={1}>
      <Text dimColor wrap="truncate-end">{safe(item.displayPath)}</Text>
    </Box>
  );
}

// Separator width sized to roughly match the legend line below it — not
// full-width, which feels heavy on wide terminals. `─` repeated; Ink clips
// via truncate-end if the terminal is narrower than this.
const SEPARATOR = "─".repeat(85);

function Legend({ tight }: { tight?: boolean }) {
  // Dim legend so newcomers can decode the compact adapter summary
  // (`3s/1a/2c/i`). Same visual grammar as the Frame footer (white key +
  // dim label, `·` separators) so the bottom lines read as one cohesive
  // status block. A short ─ line separates chrome from list. `tight`
  // removes the gap above when a parse-issues alert sits directly above —
  // they visually belong together as "list footer".
  const entries: Array<[string, string]> = [
    ["s", "skills"],
    ["a", "agents"],
    ["r", "rules"],
    ["c", "commands"],
    ["m", "mcp"],
    ["i", "instructions"],
  ];
  return (
    <Box flexDirection="column" marginTop={tight ? 0 : 2}>
      <Box paddingX={1}>
        <Text dimColor wrap="truncate-end">{SEPARATOR}</Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>legend: </Text>
        {entries.map(([k, v], i) => (
          <Fragment key={k}>
            {i > 0 && <Text dimColor>  ·  </Text>}
            <Text color="white">{k}</Text>
            <Text dimColor> {v}</Text>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}
