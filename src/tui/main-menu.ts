import { note } from "@clack/prompts";
import type { Prompter } from "../shared/interactive.js";
import { livePrompter } from "../shared/interactive.js";
import type { ScannedStack, PitConfig } from "../shared/schema.js";
import { renderStackList } from "./renderers/stack-list.js";
import { askScope } from "./scope.js";
import { stackMenu } from "./stack-menu.js";
import * as actions from "./actions/index.js";

interface MainMenuOpts {
  cwd: string;
  stacks: ScannedStack[];
  config: PitConfig;
  prompter?: Prompter;
  /** Overridable for tests — wired to the real stack menu in Task 12. */
  openStackMenu?: (args: {
    stack: ScannedStack;
    cwd: string;
    config: PitConfig;
  }) => Promise<void>;
}

function rowLabel(s: ScannedStack): string {
  const glyph = s.kind === "managed" ? "●" : s.kind === "unmanaged" ? "○" : "◉";
  return `${glyph} ${s.name}`;
}

function rowHint(s: ScannedStack): string {
  if (s.kind === "managed") {
    // Schema marks `promptpit` optional even on managed — a malformed scan
    // could produce kind:"managed" without it. Degrade to "?" rather than
    // crash the menu.
    return `v${s.promptpit?.stackVersion ?? "?"}`;
  }
  return s.kind;
}

/** Returns true to loop (rescan + re-render), false to exit. */
export async function mainMenu(opts: MainMenuOpts): Promise<boolean> {
  const prompter = opts.prompter ?? livePrompter;

  note(
    renderStackList({
      cwd: opts.cwd,
      stacks: opts.stacks,
      scopeLabel: "current tree (depth 5) + global",
    }),
  );

  const rowOptions = opts.stacks.map((s) => ({
    value: s.root,
    label: rowLabel(s),
    hint: rowHint(s),
  }));

  const action = await prompter.select<string>({
    message: "Select a stack (or action)",
    options: [
      ...rowOptions,
      { value: "__scope__", label: "Widen scope…", hint: "scan a different path or deeper" },
      { value: "__rescan__", label: "Rescan", hint: "re-run the scan with current scope" },
      { value: "__quit__", label: "Quit" },
    ],
  });

  if (action === "__quit__") return false;
  if (action === "__scope__") {
    await askScope(prompter);
    return true;
  }
  if (action === "__rescan__") return true;

  const chosen = opts.stacks.find((s) => s.root === action);
  if (!chosen) return true;

  const handler =
    opts.openStackMenu ??
    (async ({ stack, cwd, config }) =>
      stackMenu({ stack, cwd, config, actions: actions.all() }));
  await handler({ stack: chosen, cwd: opts.cwd, config: opts.config });
  return true;
}
