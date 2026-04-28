import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { safe } from "../../shared/text.js";

interface ConfirmDestructiveProps {
  /** The exact string the user must type to confirm. Stack name in practice. */
  expected: string;
  /** Headline above the prompt. e.g. "Confirm by typing the stack name". */
  prompt: string;
  /** Optional context line under the prompt (rendered dim). */
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Typed-name confirm for high-stakes destructive actions. The user must type
 *  `expected` verbatim before Enter fires `onConfirm`. Esc cancels at any time
 *  — `q` is part of valid input (stack names can contain it), so only Esc
 *  exits.
 *
 *  Visual states: idle (empty), typing+mismatch (yellow hint), match (green
 *  hint, Enter enabled). Backspace deletes the last char; printable chars
 *  append. No "3 strikes" lockout — cancel is one Esc away regardless. */
export function ConfirmDestructive({
  expected,
  prompt,
  description,
  onConfirm,
  onCancel,
}: ConfirmDestructiveProps) {
  const [typed, setTyped] = useState("");
  const matches = typed === expected;

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      if (matches) onConfirm();
      return;
    }
    if (key.backspace || key.delete) {
      setTyped((t) => t.slice(0, -1));
      return;
    }
    // Filter out control sequences (arrows, ctrl combos) — useInput's `input`
    // is empty for those, but be defensive against future ink versions.
    if (input && !key.ctrl && !key.meta) {
      // safe() strips any embedded control chars from a paste; the input
      // never reaches the model.
      const clean = safe(input);
      if (clean.length > 0) setTyped((t) => t + clean);
    }
  });

  const tone = matches ? "green" : typed.length > 0 ? "yellow" : "gray";
  const hint = matches
    ? "matches — press ↵ to confirm"
    : typed.length > 0
      ? `does not match "${safe(expected)}"`
      : `type "${safe(expected)}" to confirm`;

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Box marginBottom={description ? 1 : 0}>
        <Text bold>{prompt}</Text>
      </Box>
      {description && (
        <Box marginBottom={1}>
          <Text dimColor wrap="wrap">{safe(description)}</Text>
        </Box>
      )}
      <Box>
        <Text dimColor>&gt; </Text>
        <Text color={tone}>{safe(typed)}</Text>
        <Text color={tone}>▌</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={tone} dimColor={!matches && typed.length === 0}>
          {hint}
        </Text>
      </Box>
    </Box>
  );
}
