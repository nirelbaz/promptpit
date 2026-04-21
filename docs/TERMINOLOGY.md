# PromptPit Terminology

This is the single source of truth for the words we use in pit — in code, in user-facing strings, in documentation, and in commit messages. When two words could reasonably name the same concept, this file decides which one we use.

If you're changing how pit works and a new concept appears, add it here first, then use it. If a term drifts in practice (e.g., we start calling installed artifacts "files" in one command's help text and "artifacts" in another's), update the drifting usage to match this file.

## Glossary

| Term | Meaning |
|---|---|
| **Stack** | A logical collection of AI config at a location. Can be managed, unmanaged, or global. One row in the scan output. |
| **Managed stack** | A stack with a `.promptpit/` directory containing a valid `stack.json`. Supports every pit feature. |
| **Unmanaged stack** | A location with AI config (`CLAUDE.md`, `.cursor/rules/`, `.mcp.json`, etc.) but no `.promptpit/`. Supports a reduced action set. |
| **Global stack** | The virtual stack representing user-level tool paths (`~/.claude`, `~/.cursor`, `~/.codex`, `~/.agents/skills/`). One row, always shown by default. |
| **Bundle** | The `.promptpit/` directory and its files — the source-of-truth definition of a managed stack. |
| **Source** | Where a stack came from: a GitHub spec (`github:owner/repo[@ref]`), a local path, or the literal `.promptpit`. Stored as `entry.source` in the manifest. Used as the argument to `pit install <source>`. |
| **Extends** | Upstream stack references listed in `stack.json.extends`. An entry in `extends` is a `Source`. |
| **Artifact** | An individual unit inside a stack: a skill, rule, agent, command, MCP server, or the instructions file. Matches the existing `ArtifactDetail` / `ReconciledArtifact` types in the code. The per-stack drilldown in the TUI is the **Artifacts…** menu. |
| **Adapter** | A tool-specific translator: `claude-code`, `cursor`, `codex`, `copilot`, `standards`. Adapters read and write in tool-native formats. |
| **Install** | Write a bundle's artifacts into a project (`.claude/`, `.cursor/`, etc.) or user-level tool paths. |
| **Uninstall** | Remove the tracked installed artifacts from a project. The bundle is untouched. |
| **Collect** | Read AI config from a project and bundle it into `.promptpit/`. Turns an unmanaged stack into a managed one, or pulls local drift into an existing bundle ("Collect drift back"). |
| **Adapt** | Install a stack using a different adapter than what the target natively has (or has installed). Target can be the same project or another. |
| **Drift** | An installed artifact whose current content doesn't match the hash recorded in `installed.json` at install time. |
| **Fork** | A drifted artifact the user opted to keep during `pit update --interactive` (choice "keep mine"). Tracked with a `baselineHash` pointing at the upstream content at fork time, so subsequent updates can diff against that baseline. |
| **Manifest** | `.promptpit/installed.json`. The record of what was installed, with per-artifact hashes, overrides, exclusions, and resolved-extends commits. |
| **Trust** | Persisted user consent to run a source's lifecycle scripts. Keyed by source, stores only hashes of `preinstall` / `postinstall` contents. Lives in `~/.promptpit/trust.json`. |
| **Scope** | The set of paths a scan covers. Default: current project tree (depth 5) + global. Widened with `--path`, `--deep`, `--all`. |
| **Scan** | The process of walking the filesystem under the current scope and producing `ScannedStack[]`. |
| **Annotation** | A sub-path inside a managed stack that has AI config not declared in the stack's `stack.json`. Rendered as `+ …` hint on the parent row; never a standalone stack. |
| **Preferences** | User-level pit settings stored in `~/.promptpit/config.json`: scan defaults, recents, UI toggles. Distinct from **trust**, which lives in a separate file. |

## Do not use

These words are ambiguous in this project. Prefer the alternatives.

| Don't use | Use instead | Why |
|---|---|---|
| *Config* (unqualified) | **Bundle** for `.promptpit/`; **AI config** for tool-native files on disk; **Preferences** for `~/.promptpit/config.json` | "Config" means all three depending on who's reading. |
| *Sources* (as a synonym for artifacts) | **Artifacts** | Overloaded with install **source** and **extends** entries. |
| *Project config* | **Stack** | A project may have multiple, or be part of a global setup. |
| *Dependencies* (for extends) | **Extends** | Matches `stack.json.extends` field name. |
| *Package* | **Stack** or **Bundle** | No packaging semantics here — nothing is versioned via npm/pip. |

## Usage notes

- **"Install a stack"** is always a verb on a target. Say *"install stack X into project Y"*, never *"install X"* by itself — it's ambiguous whether you mean install or adapt.
- **"Uninstall" never touches the bundle.** If you want to remove both, say *"delete bundle"* or *"delete bundle and uninstall"*.
- **"Managed"** is binary (presence of a valid `stack.json`). There is no "partially managed" state.
- **"Drift"** is only meaningful for managed stacks. Unmanaged and global stacks have no manifest, so the scan reports their drift as `unknown`.
- **"Trust" is per-source, not per-stack.** Two stacks installed from `github:org/shared-stack` at different times share one trust entry.

## Extending this file

Add a new term when:
- A concept appears in user-facing output (help text, CLI messages, TUI labels).
- A concept appears in the code as a type name or API shape.
- Two words are being used interchangeably and it's causing confusion.

Don't add a term that's only ever used in one implementation file. Keep this glossary tight.
