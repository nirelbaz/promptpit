/** Directories skipped during project scanning. Shared between the scanner
 *  and the user-config schema default, so one edit changes both. */
export const DEFAULT_IGNORE: readonly string[] = [
  "node_modules", ".git", "dist", "build", ".next", "out",
  "target", "vendor", ".venv", "__pycache__", ".turbo",
  ".cache", "coverage",
];
