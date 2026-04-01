# pit validate — Design Spec

## Overview

`pit validate` checks if a `.promptpit/` stack is well-formed before publishing or installing. Built-in checks validate structure and schemas (zero deps, fast). Optional agnix integration adds 385+ adapter-specific lint rules when installed.

## Command Interface

```
pit validate [dir]    # defaults to .promptpit
  --json              # machine-readable output
```

- Exit 0: no errors (warnings allowed)
- Exit 1: one or more errors

## Diagnostic Model

```ts
interface Diagnostic {
  file: string;          // relative path within stack dir (e.g. "stack.json")
  level: "error" | "warning";
  message: string;
  source: "pit" | "agnix";
  rule?: string;         // agnix rule ID (e.g. "CC-042")
}

interface ValidateResult {
  valid: boolean;        // true if zero errors
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
  agnix: {
    available: boolean;
    diagnostics: Diagnostic[];
  };
}
```

## Built-in Checks (source: "pit")

| File | Required | Checks | Level |
|------|----------|--------|-------|
| `stack.json` | yes | exists, valid JSON, passes `stackManifestSchema` | error |
| `agent.promptpit.md` | no | valid YAML frontmatter (safe parse via `SAFE_MATTER_OPTIONS`) | error |
| `skills/*/SKILL.md` | no | valid frontmatter via `skillFrontmatterSchema` per skill | error |
| `mcp.json` | no | valid JSON, passes `mcpConfigSchema` | error |
| `.env.example` | no | dangerous env names via `isDangerousEnvName()` | warning |

Missing optional files are silently skipped. Only `stack.json` is required.

## agnix Integration

**Detection:** Resolve the `agnix` binary via `require.resolve("agnix/bin/agnix")` or check `node_modules/.bin/agnix`. If found, run automatically. If not, print a tip after results: `Tip: install agnix for 385+ adapter-specific checks (npm i -D agnix)`.

**Execution:** Shell out to `agnix validate --format json <stackDir>`. Parse the JSON stdout. agnix diagnostics have this shape:
```json
{ "level": "error|warning", "rule": "CC-001", "file": "...", "line": 1, "column": 1,
  "message": "...", "suggestion": "...", "category": "...", "applies_to_tool": "..." }
```

**No adapter filtering** in v1. Run all agnix rules — the stack might target tools not installed locally.

**Diagnostics** from agnix are mapped to the same `Diagnostic` model with `source: "agnix"` and the original rule ID in `rule`. Displayed in a separate section in human output, separate `agnix.diagnostics` array in JSON output.

**Error handling:** If agnix binary is not found, isn't executable, or returns non-JSON output, warn and continue with built-in results only. A third-party tool must never crash the validate command.

## Human Output Format

```
Validating .promptpit/ ...

  stack.json .............. pass
  agent.promptpit.md ...... pass
  skills/my-skill/SKILL.md  fail — missing required field "description"
  skills/other/SKILL.md ... pass
  mcp.json ................ pass (2 servers)
  .env.example ............ warn — dangerous env name: PATH

  agnix ................... 3 passed, 1 warning
    warn CC-042: hooks should declare explicit timeout (CLAUDE.md)

fail — 1 error, 2 warnings
```

## JSON Output Format

```json
{
  "valid": false,
  "errors": 1,
  "warnings": 2,
  "diagnostics": [
    { "file": "skills/my-skill/SKILL.md", "level": "error", "message": "missing required field \"description\"", "source": "pit" },
    { "file": ".env.example", "level": "warning", "message": "dangerous env name: PATH", "source": "pit" }
  ],
  "agnix": {
    "available": true,
    "diagnostics": [
      { "file": "CLAUDE.md", "level": "warning", "message": "hooks should declare explicit timeout", "source": "agnix", "rule": "CC-042" }
    ]
  }
}
```

## Module Structure

| File | Responsibility |
|------|---------------|
| `src/core/validate.ts` | Validation pipeline: walks stack dir, collects diagnostics, runs agnix. Exports `validateStack(stackDir): Promise<ValidateResult>` |
| `src/commands/validate.ts` | CLI handler: formats human/JSON output, exits with correct code |
| `src/cli.ts` | Register `validate` command (add import + command definition) |
| `test/validate.test.ts` | Unit tests against fixture stacks |

No changes to existing modules. Imports schemas from `schema.ts`, safe parse options from `adapter-utils.ts`, env validation from `security.ts`.

## Reuse by Future Commands

`validateStack()` returns a pure data result, making it callable from `pit check` (CI gate) or `pit publish` (pre-publish validation) without duplicating logic.
