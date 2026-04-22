// Path-presentation helpers shared by every screen that renders a stack
// location: the Ink TUI (`src/tui/screens/`) and the string renderer used
// by `pit ls` (`src/tui/renderers/stack-list.ts`). Before extraction these
// lived in both and drifted independently.
import path from "node:path";
import { homedir } from "node:os";

/** Replace `$HOME` prefix with `~`. Shorter, platform-neutral, doesn't leak
 *  usernames in screenshots or bug reports. */
export function homeify(p: string, home: string = homedir()): string {
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

/** Normalize path separators for display. On Windows, `path.relative` and
 *  `path.sep` produce `\`-separated paths; mixing them with the `./` prefix
 *  and the trailing `/` we append looks ugly (`.\foo\bar/`). Show forward
 *  slashes everywhere in the UI, regardless of OS. */
export function toForwardSlash(p: string): string {
  return path.sep === "\\" ? p.replace(/\\/g, "/") : p;
}

/** Compute how a stack root presents relative to cwd. Returns `display = null`
 *  when the path would be redundant with the stack name (either root === cwd,
 *  or the single-segment path is just the stack name).
 *
 *  Depth orders the list: 0 = at cwd, 1 = direct child, etc. Paths outside
 *  cwd land at `POSITIVE_INFINITY` so they sort after all nested rows. */
export function describeStackPath(
  cwdR: string,
  root: string,
  name: string,
  home: string = homedir(),
): { display: string | null; depth: number } {
  const rootR = path.resolve(root);
  if (rootR === cwdR) return { display: null, depth: 0 };
  const rel = path.relative(cwdR, rootR);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const segs = rel.split(path.sep);
    const depth = segs.length;
    // The last segment almost always matches the stack name (stack names
    // default to the folder basename), so repeating it next to the name
    // column adds no info. Drop it and keep a trailing "/" to signal
    // "inside this directory". Hide entirely when the whole path is just
    // the name.
    if (segs[segs.length - 1] === name) {
      if (segs.length === 1) return { display: null, depth };
      return { display: toForwardSlash(`./${segs.slice(0, -1).join(path.sep)}/`), depth };
    }
    return { display: toForwardSlash(`./${rel}`), depth };
  }
  return { display: homeify(rootR, home), depth: Number.POSITIVE_INFINITY };
}
