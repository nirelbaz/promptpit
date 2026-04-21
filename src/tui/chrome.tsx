// Persistent layout chrome for every TUI screen. `Frame` composes a header
// (breadcrumb + optional right-side status) with the screen body and a
// keymap footer. `SectionTitle` is a subtle inline heading used inside wizard
// steps. Keeping these stateless keeps tests deterministic.
import { Box, Text } from "ink";
import { Fragment, type ReactNode } from "react";

// Injected by tsup from package.json.version. Kept local to avoid a cross-
// file dependency just to render a version tag.
declare const __APP_VERSION__: string;

interface HeaderProps {
  crumbs: string[];
  right?: string;
}

export function Header({ crumbs, right }: HeaderProps) {
  return (
    <Box paddingX={1} borderStyle="round" borderColor="gray" justifyContent="space-between">
      <Box>
        <Text bold color="cyan">pit</Text>
        <Text dimColor> {__APP_VERSION__} · </Text>
        {crumbs.map((c, i) => (
          <Fragment key={`${i}-${c}`}>
            {i > 0 && <Text dimColor> › </Text>}
            <Text color={i === crumbs.length - 1 ? "white" : "gray"}>{c}</Text>
          </Fragment>
        ))}
      </Box>
      {right && <Text dimColor>{right}</Text>}
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
