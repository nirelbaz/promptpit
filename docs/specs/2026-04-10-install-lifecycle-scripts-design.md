# Install Lifecycle Scripts

**Date:** 2026-04-10
**Status:** Approved
**Branch:** nirelbaz/install-lifecycle-scripts

## Problem

Stacks like gstack ship binaries and platform-specific setup (Playwright install, symlink creation, version migrations) that need to run after the stack is copied. Currently there's no way for a stack author to declare scripts that run as part of `pit install`.

## Solution

Add `scripts.preinstall` and `scripts.postinstall` to `stack.json`. Shell commands that run before/after `pit install` writes files.

## Schema

Optional `scripts` field in `stack.json`:

```json
{
  "name": "my-stack",
  "version": "1.0.0",
  "scripts": {
    "preinstall": "echo 'preparing...'",
    "postinstall": "./setup.sh"
  }
}
```

Both `preinstall` and `postinstall` are optional strings. Validated in Zod as:

```typescript
scripts: z.object({
  preinstall: z.string().optional(),
  postinstall: z.string().optional(),
}).optional()
```

Added to `stackManifestSchema` in `src/shared/schema.ts`.

## Execution Model

- **Shell:** `execFile('sh', ['-c', script])` — consistent with existing `execFileSync` pattern, prevents shell injection from args
- **cwd:** Stack source directory (`.promptpit/` dir or cloned repo root)
- **stdio:** Inherited — stdout/stderr pipe through to user in real-time
- **Environment variables injected:**
  - `PIT_TARGET_DIR` — absolute path to install target project
  - `PIT_STACK_NAME` — stack name from manifest
  - `PIT_STACK_VERSION` — stack version
  - `PIT_SOURCE` — original source string (`.promptpit`, `github:owner/repo`, path)

### Timing

- **preinstall:** After extends resolution + security validation, before any files are written (before canonical skills write)
- **postinstall:** After all files written + manifest updated + .env handled, before the success message

## Extends Chain Ordering

When a stack has `extends`, scripts from all stacks in the resolved chain run in dependency order (deepest dependency first):

- preinstall: B's preinstall → A's preinstall → [write files]
- postinstall: [write files] → B's postinstall → A's postinstall

Each script runs from its own stack's source directory with its own stack metadata in the env vars.

## Security Model

**Local stacks** (source is `.promptpit` or a filesystem path): Run without prompting. The user owns the code.

**Remote stacks** (`github:owner/repo`): Show script content and require explicit consent:

```
⚠ This stack wants to run a postinstall script:

  ./setup.sh

  Source: github:garrytan/gstack@main

Allow? [y/N]
```

Default is N (deny). The user must explicitly type `y` to allow execution.

When multiple remote stacks in an extends chain have scripts, each script gets its own consent prompt showing its source. The user can approve or deny each individually. A denied script is skipped (not treated as a failure).

## CLI Flags

Three new flags on `pit install`:

| Flag | Effect |
|------|--------|
| `--trust` | Skip consent prompt for remote stack scripts (for CI or known stacks) |
| `--ignore-scripts` | Skip all lifecycle scripts entirely |
| `--ignore-script-errors` | Run scripts but downgrade failures from errors to warnings |

Added to `InstallOptions` interface and wired through Commander in `cli.ts`.

## Error Handling

- **Default behavior:** Non-zero exit code aborts the install
  - preinstall failure: stops before any files are written (clean abort)
  - postinstall failure: files already written, reports error clearly (no rollback)
- **`--ignore-script-errors`:** Downgrades to warning, install continues

## Dry-Run Behavior

`pit install --dry-run` shows which scripts would run without executing them:

```
Lifecycle scripts:
  preinstall: echo 'preparing...'
  postinstall: ./setup.sh
```

Included in the dry-run report alongside file previews.

## Implementation

New module: `src/core/scripts.ts`

### Functions

- **`runLifecycleScript(phase, script, stackDir, env, opts)`** — Executes a single script via `execFile('sh', ['-c', script])`. Handles error/success logging, respects `--ignore-script-errors`.
- **`promptForScriptConsent(phase, script, source)`** — Shows the consent prompt for remote stacks. Returns boolean. Uses readline for interactive y/N input.
- **`collectScripts(bundles)`** — Gathers scripts from extends chain in dependency order. Returns ordered array of `{ phase, script, stackDir, stackName, source }`.

### Integration points in `install.ts`

1. After security validation (line ~160), before canonical skills write (line ~206): run preinstall scripts
2. After .env handling (line ~497), before success message (line ~499): run postinstall scripts
3. In dry-run branch: collect and display scripts without executing

### Flag flow

`cli.ts` → `InstallOptions` → `installStack()` → `runLifecycleScript()` options

## Validation

`pit validate` checks that script values are non-empty strings (no empty `""` scripts). Does not validate that referenced files exist (they may be generated or platform-specific).

## Testing

- Schema validation: scripts field accepted, empty strings rejected
- Local stack: scripts run without prompting
- Remote stack: consent prompt shown (mocked in tests)
- `--trust`: bypasses consent
- `--ignore-scripts`: scripts not executed
- `--ignore-script-errors`: failure downgraded to warning
- Dry-run: scripts listed but not executed
- Extends chain: scripts run in dependency order
- Preinstall failure: install aborted, no files written
- Postinstall failure: error reported, files already in place
- Environment variables: PIT_TARGET_DIR, PIT_STACK_NAME, PIT_STACK_VERSION, PIT_SOURCE available to scripts
