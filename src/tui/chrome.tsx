import { Box, Text } from "ink";
import { Fragment, type ReactNode } from "react";
import { clip, safe } from "../shared/text.js";

// Injected by tsup from package.json.version. Kept local to avoid a cross-
// file dependency just to render a version tag.
declare const __APP_VERSION__: string;

interface HeaderProps {
  crumbs: string[];
  right?: string;
}

function Header({ crumbs, right }: HeaderProps) {
  // Single Text with wrap="truncate-start" on the left side so overflow
  // eats from the middle of the crumb trail (usually a long stack name)
  // rather than from the "pit 0.5.1 · " prefix. The right-side chip sits
  // in its own non-shrinking Box so it doesn't push into the left.
  // JS-level clipping on `right` caps it at 32 chars before Ink sees it;
  // that keeps the left with enough room to fit "pit 0.5.1 · …name" on
  // common 80-col terminals.
  const trail = crumbs.map(safe).join(" › ");
  const clippedRight = right ? clip(safe(right), 32) : "";
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

function Footer({ keys }: { keys: KeyHint[] }) {
  // No marginTop: the footer sits directly below whatever the screen
  // renders last. MainList pairs it with Legend (which has its own top
  // border as the visual break); other screens end with ListPicker rows
  // or a Text block and benefit from the tight rhythm too.
  return (
    <Box paddingX={1}>
      <Text dimColor>keys: </Text>
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
