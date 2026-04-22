import { Box, Text, useInput } from "ink";
import { useEffect } from "react";
import { Frame } from "../chrome.js";
import { useNav } from "../nav.js";
import { clip, safe } from "../../shared/text.js";

type Tone = "success" | "info" | "warn";

interface FlashProps {
  message: string;
  tone?: Tone;
  ms?: number;
  crumbs?: string[];
}

const TONE_PRESETS: Record<Tone, { glyph: string; color: string }> = {
  success: { glyph: "✓", color: "green" },
  info:    { glyph: "ℹ", color: "cyan" },
  warn:    { glyph: "⚠", color: "yellow" },
};

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

  const { glyph, color } = TONE_PRESETS[tone];

  return (
    <Frame crumbs={crumbs} keys={[["esc", "dismiss"]]}>
      <Box paddingX={1}>
        <Text color={color}>{glyph} </Text>
        {/* Hard-clip + truncate-end: callers pass user-controlled strings
            (stack.root, stack.name) that can overflow narrow terminals and
            break the Frame layout otherwise. */}
        <Text wrap="truncate-end">{clip(safe(message), 120)}</Text>
      </Box>
    </Frame>
  );
}
