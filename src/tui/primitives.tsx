// Reusable input widgets. Kept minimal — each screen passes options and
// receives the chosen value via callback. No context, no global state:
// every widget is drop-in usable and unit-testable with ink-testing-library.
import { Box, Text, useInput } from "ink";
import { useState, useEffect, type ReactNode } from "react";

export interface ListOption<T> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface ListPickerProps<T> {
  options: ListOption<T>[];
  onSelect: (value: T) => void;
  onCancel?: () => void;
  initialIndex?: number;
}

/** Vertical list with a cursor. ↑↓/jk to move, Enter to select, Esc/q to
 *  cancel. Skips `disabled` rows automatically so the cursor never lands on
 *  one. Works inside or outside a Frame. */
export function ListPicker<T>({
  options,
  onSelect,
  onCancel,
  initialIndex = 0,
}: ListPickerProps<T>) {
  const [cursor, setCursor] = useState(() => {
    const start = Math.max(0, Math.min(initialIndex, options.length - 1));
    return firstEnabled(options, start, 1) ?? start;
  });

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setCursor((c) => firstEnabled(options, c - 1, -1) ?? c);
    } else if (key.downArrow || input === "j") {
      setCursor((c) => firstEnabled(options, c + 1, 1) ?? c);
    } else if (key.return) {
      const opt = options[cursor];
      if (opt && !opt.disabled) onSelect(opt.value);
    } else if (key.escape || input === "q") {
      onCancel?.();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {options.map((o, i) => {
        const selected = i === cursor;
        const color = o.disabled ? "gray" : selected ? "cyan" : undefined;
        return (
          <Box key={i}>
            <Text color={color}>{selected ? "▸ " : "  "}</Text>
            {o.icon && <Box marginRight={1}>{o.icon}</Box>}
            <Text bold={selected} color={color} dimColor={o.disabled}>{o.label}</Text>
            {/* Spec §7: only the active row renders its hint — avoids the
                "wall of dim text" effect that made every row look disabled. */}
            {selected && o.hint && <Text dimColor>  {o.hint}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function firstEnabled<T>(options: ListOption<T>[], start: number, step: number): number | null {
  let i = start;
  while (i >= 0 && i < options.length) {
    if (!options[i]!.disabled) return i;
    i += step;
  }
  return null;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Animated spinner with a label. Runs on a setInterval so it stops rendering
 *  frames when the component unmounts. Color defaults to cyan to match our
 *  "active" accent. */
export function Spinner({ label, color = "cyan" }: { label: string; color?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Box>
      <Text color={color}>{SPINNER_FRAMES[frame]} </Text>
      <Text>{label}</Text>
    </Box>
  );
}
