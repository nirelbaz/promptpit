import { note } from "@clack/prompts";
import type { Prompter } from "../shared/interactive.js";
import { livePrompter } from "../shared/interactive.js";
import type { ScannedStack, PitConfig } from "../shared/schema.js";
import { optionsForMenu, type ActionKey } from "./action-hints.js";
import { renderStackDetail } from "./renderers/stack-detail.js";

export interface ActionContext {
  stack: ScannedStack;
  cwd: string;
  config: PitConfig;
  prompter: Prompter;
}

export interface StackMenuActions {
  install:          (c: ActionContext) => Promise<void>;
  installTo:        (c: ActionContext) => Promise<void>;
  adapt:            (c: ActionContext) => Promise<void>;
  update:           (c: ActionContext) => Promise<void>;
  statusDiff:       (c: ActionContext) => Promise<void>;
  collect:          (c: ActionContext) => Promise<void>;
  collectDrift:     (c: ActionContext) => Promise<void>;
  artifacts:        (c: ActionContext) => Promise<void>;
  validate:         (c: ActionContext) => Promise<void>;
  uninstall:        (c: ActionContext) => Promise<void>;
  open:             (c: ActionContext) => Promise<void>;
  deleteBundle:     (c: ActionContext) => Promise<void>;
  deleteFiles:      (c: ActionContext) => Promise<void>;
  copyTo:           (c: ActionContext) => Promise<void>;
  resolveConflicts: (c: ActionContext) => Promise<void>;
  reviewOverrides:  (c: ActionContext) => Promise<void>;
  showExtends:      (c: ActionContext) => Promise<void>;
}

interface StackMenuOpts {
  stack: ScannedStack;
  cwd: string;
  config: PitConfig;
  prompter?: Prompter;
  actions: StackMenuActions;
}

export async function stackMenu(opts: StackMenuOpts): Promise<void> {
  const prompter = opts.prompter ?? livePrompter;
  const ctx: ActionContext = {
    stack: opts.stack,
    cwd: opts.cwd,
    config: opts.config,
    prompter,
  };

  // Loop: render detail card, pick action, dispatch, re-render. Exit on
  // `back` or when the user Ctrl+Cs (bubbles up as PromptCancelledError,
  // caught by runTui).
  while (true) {
    note(renderStackDetail(opts.stack));
    const options = optionsForMenu(opts.stack.kind);
    const key = await prompter.select<ActionKey>({
      message: "What do you want to do?",
      options,
    });
    if (key === "back") return;
    await dispatch(key, opts.actions, ctx);
  }
}

async function dispatch(key: ActionKey, a: StackMenuActions, ctx: ActionContext): Promise<void> {
  switch (key) {
    case "install-from":      return a.install(ctx);
    case "install-to":        return a.installTo(ctx);
    case "adapt":             return a.adapt(ctx);
    case "update":            return a.update(ctx);
    case "status-diff":       return a.statusDiff(ctx);
    case "collect":           return a.collect(ctx);
    case "collect-drift":     return a.collectDrift(ctx);
    case "artifacts":         return a.artifacts(ctx);
    case "validate":          return a.validate(ctx);
    case "uninstall":         return a.uninstall(ctx);
    case "open":              return a.open(ctx);
    case "delete-bundle":     return a.deleteBundle(ctx);
    case "delete-files":      return a.deleteFiles(ctx);
    case "copy-to":           return a.copyTo(ctx);
    case "resolve-conflicts": return a.resolveConflicts(ctx);
    case "review-overrides":  return a.reviewOverrides(ctx);
    case "show-extends":      return a.showExtends(ctx);
    case "back":              return;
  }
}
