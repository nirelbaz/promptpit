// Persistent layout chrome for every TUI screen. `Frame` composes a header
// (breadcrumb + optional right-side status) with the screen body and a
// keymap footer. `SectionTitle` is a subtle inline heading used inside wizard
// steps. Keeping these stateless keeps tests deterministic.
import { Box, Text } from "ink";
import { Fragment, type ReactNode } from "react";

// Injected by tsup from package.json.version. Kept local to avoid a cross-
// file dependency just to render a version tag.
declare const __APP_VERSION__: string;

// Clip a string to `max` visible chars, appending "…" on overflow. Ink's
// `wrap="truncate"` does this at render time, but we also want to guarantee
// a single-line crumb bar regardless of what path/name the caller passes —
// the only way to do that reliably across Ink layout passes is to clip in
// userland before handing the text to Ink.
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

interface HeaderProps {
  crumbs: string[];
  right?: string;
}

export function Header({ crumbs, right }: HeaderProps) {
  // Single Text with wrap="truncate-start" on the left side so overflow
  // eats from the middle of the crumb trail (usually a long stack name)
  // rather than from the "pit 0.5.1 · " prefix. The right-side chip sits
  // in its own non-shrinking Box so it doesn't push into the left.
  // JS-level clipping on `right` caps it at 32 chars before Ink sees it;
  // that keeps the left with enough room to fit "pit 0.5.1 · …name" on
  // common 80-col terminals.
  const trail = crumbs.join(" › ");
  const clippedRight = right ? clip(right, 32) : "";
  return (
    <Box paddingX={1} borderStyle="round" borderColor="gray" justifyContent="space-between">
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-start">
          <Text bold color="cyan">pit</Text>
          <Text dimColor> {__APP_VERSION__} · </Text>
          {trail}
        </Text>
      </Box>
      {clippedRight && (
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>{clippedRight}</Text>
        </Box>
      )}
    </Box>
  );
}

export type KeyHint = [string, string];

export function Footer({ keys }: { keys: KeyHint[] }) {
  return (
    <Box paddingX={1} marginTop={1}>
      {keys.map(([k, v], i) => (
        <Fragment key={k}>
          {i > 0 && <Text dimColor>  ·  </Text>}
          <Text color="white">{k}</Text>
          <Text dimColor> {v}</Text>
        </Fragment>
      ))}
    </Box>
  );
}

interface FrameProps {
  crumbs: string[];
  right?: string;
  keys: KeyHint[];
  children: ReactNode;
}

export function Frame({ crumbs, right, keys, children }: FrameProps) {
  return (
    <Box flexDirection="column">
      <Header crumbs={crumbs} right={right} />
      <Box flexDirection="column" marginTop={1}>{children}</Box>
      <Footer keys={keys} />
    </Box>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text bold>{children}</Text>
      {hint && <Text dimColor>  {hint}</Text>}
    </Box>
  );
}
