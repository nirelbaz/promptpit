// Display-safety helpers for strings that reach a terminal. Bundle manifests,
// adapter ids, stack names, and subpaths come from untrusted sources on disk
// (GitHub clones, user-edited stack.json) — without sanitization, a malicious
// name like `evil\x1b[2J` could clear the terminal or overwrite rows to spoof
// managed/drift status.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

/** Strip control characters (ANSI CSI, carriage returns, backspace, bell)
 *  from author-controlled strings before rendering. */
export function safe(s: string): string {
  return s.replace(CONTROL_CHARS_RE, "");
}

/** Clip a string to `max` visible chars, appending "…" on overflow. Ink's
 *  `wrap="truncate"` does this at render time based on available layout
 *  width; this clips in userland when the caller needs a hard character cap
 *  regardless of layout (e.g. single-line crumb bars, Flash messages). */
export function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
