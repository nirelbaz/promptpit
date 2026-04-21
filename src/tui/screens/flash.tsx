// Short-lived confirmation card. Pushed onto the nav stack after a
// fire-and-forget action (e.g. "opened folder"), auto-dismisses after
// `ms`, then pops back. Keeps the user visually acknowledged without
// trapping them on a dead-end screen.
import { Box, Text, useInput } from "ink";
import { useEffect } from "react";
import { Frame } from "../chrome.js";
import { useNav } from "../nav.js";

interface FlashProps {
  message: string;
  tone?: "success" | "info" | "warn";
  ms?: number;
  crumbs?: string[];
}

export function Flash({ message, tone = "success", ms = 1200, crumbs = ["Stacks", "…"] }: FlashProps) {
  const nav = useNav();
  useEffect(() => {
    const id = setTimeout(() => nav.pop(), ms);
    return () => clearTimeout(id);
  }, [nav, ms]);
  // Footer advertises "esc dismiss"; honor it by popping early on Esc/Enter.
  useInput((_input, key) => {
    if (key.escape || key.return) nav.pop();
  });

  const glyph = tone === "success" ? "✓" : tone === "warn" ? "⚠" : "ℹ";
  const color = tone === "success" ? "green" : tone === "warn" ? "yellow" : "cyan";

  return (
    <Frame crumbs={crumbs} keys={[["esc", "dismiss"]]}>
      <Box paddingX={1}>
        <Text color={color}>{glyph} </Text>
        <Text>{message}</Text>
      </Box>
    </Frame>
  );
}
