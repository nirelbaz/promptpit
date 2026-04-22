// Shared presentation helpers for rendering a ScannedStack in Ink screens.
// Keeps glyph/color/right-chip mappings in one place so main-list and
// stack-detail can't drift. The `ls` command's string renderer lives in
// renderers/stack-list.ts and shares only glyphFor — its output is a
// chalk-colored string, not an Ink tree.
import type { ScannedStack } from "../shared/schema.js";
import { glyphFor } from "./renderers/stack-list.js";

export { glyphFor };

export function glyphColorFor(kind: ScannedStack["kind"]): string {
  switch (kind) {
    case "managed":   return "green";
    case "unmanaged": return "gray";
    case "global":    return "cyan";
  }
}

export interface RightChip {
  text: string;
  color: string;
}

export function rightChipFor(stack: ScannedStack): RightChip {
  if (stack.kind === "managed") {
    const version = stack.promptpit?.stackVersion ?? "?";
    const drifted = stack.overallDrift === "drifted";
    return {
      text: `managed · v${version}${drifted ? " · drifted" : ""}`,
      color: drifted ? "yellow" : "cyan",
    };
  }
  return {
    text: stack.kind,
    color: stack.kind === "global" ? "cyan" : "gray",
  };
}

/** State → {label, color} for drift chips in lists and status tables.
 *  One source of truth for the managed/unmanaged/global/drifted/synced
 *  color grammar. */
export function driftToneFor(stack: ScannedStack): { label: string; color: string } {
  if (stack.kind === "global") return { label: "global", color: "cyan" };
  if (stack.kind === "unmanaged") return { label: "unmanaged", color: "gray" };
  return stack.overallDrift === "drifted"
    ? { label: "drifted", color: "yellow" }
    : { label: "synced", color: "green" };
}

/** Compact per-adapter summary for the main list. One segment per adapter,
 *  each as `id: countCode`. The count code uses single-letter suffixes so
 *  a two-adapter stack still fits on an 80-col terminal. A dim legend line
 *  in MainList teaches the code (s/a/r/c/m/i).
 *
 *  Example: `claude-code: 3s/1a/2c/i  cursor: 5r` */
export function compactAdapterSummary(stack: ScannedStack): string {
  return stack.adapters
    .map((a) => {
      const parts: string[] = [];
      if (a.artifacts.skills) parts.push(`${a.artifacts.skills}s`);
      if (a.artifacts.agents) parts.push(`${a.artifacts.agents}a`);
      if (a.artifacts.rules) parts.push(`${a.artifacts.rules}r`);
      if (a.artifacts.commands) parts.push(`${a.artifacts.commands}c`);
      if (a.artifacts.mcp) parts.push(`${a.artifacts.mcp}m`);
      if (a.artifacts.instructions) parts.push("i");
      return `${a.id}: ${parts.join("/") || "·"}`;
    })
    .join("  ");
}
