import type { StackMenuActions } from "../stack-menu.js";
import { openFolderAction } from "./open-folder.js";
import { validateAction } from "./validate.js";
import { statusDiffAction } from "./status-diff.js";

// Barrel for action handlers. Real implementations are wired in by later
// tasks (validate in 14, status-diff in 15, …). Anything still pointing at
// `notImplemented` throws a clear error when the user selects it — safer
// than a silent no-op while the TUI is partial.
const notImplemented = async (): Promise<void> => {
  throw new Error("Action not implemented yet");
};

export function all(): StackMenuActions {
  return {
    install:          notImplemented,
    installTo:        notImplemented,
    adapt:            notImplemented,
    update:           notImplemented,
    statusDiff:       statusDiffAction,
    collect:          notImplemented,
    collectDrift:     notImplemented,
    artifacts:        notImplemented,
    validate:         validateAction,
    uninstall:        notImplemented,
    open:             openFolderAction,
    deleteBundle:     notImplemented,
    deleteFiles:      notImplemented,
    copyTo:           notImplemented,
    resolveConflicts: notImplemented,
    reviewOverrides:  notImplemented,
    showExtends:      notImplemented,
  };
}
