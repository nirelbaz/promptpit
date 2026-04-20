/** Directories skipped during project scanning. Shared between the scanner
 *  and the user-config schema default, so one edit changes both.
 *
 *  `docs`/`doc`/`examples`/`example`/`samples` are pruned because many
 *  repos keep copies of `CLAUDE.md` / `AGENTS.md` and translated copies of
 *  `.claude/` assets there (e.g. `docs/ja-JP/skills/…`). Treating those as
 *  real stacks floods `pit ls` with bogus unmanaged entries. The tradeoff:
 *  stacks intentionally authored under `docs/` won't be surfaced — acceptable
 *  for MVP. */
export const DEFAULT_IGNORE: readonly string[] = [
  "node_modules", ".git", "dist", "build", ".next", "out",
  "target", "vendor", ".venv", "__pycache__", ".turbo",
  ".cache", "coverage",
  "docs", "doc", "examples", "example", "samples",
];
