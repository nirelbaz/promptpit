import type { StackMenuActions } from "../stack-menu.js";

// Barrel for action handlers. Real implementations are wired in by later
// tasks (open-folder in Task 13, validate in 14, status-diff in 15, …).
// Anything still pointing at `notImplemented` throws a clear error when the
// user selects it — safer than a silent no-op while the TUI is partial.
const notImplemented = async (): Promise<void> => {
  throw new Error("Action not implemented yet");
};

export function all(): StackMenuActions {
  return {
    install:          notImplemented,
    installTo:        notImplemented,
    adapt:            notImplemented,
    update:           notImplemented,
    statusDiff:       notImplemented,
    collect:          notImplemented,
    collectDrift:     notImplemented,
    artifacts:        notImplemented,
    validate:         notImplemented,
    uninstall:        notImplemented,
    open:             notImplemented,
    deleteBundle:     notImplemented,
    deleteFiles:      notImplemented,
    copyTo:           notImplemented,
    resolveConflicts: notImplemented,
    reviewOverrides:  notImplemented,
    showExtends:      notImplemented,
  };
}
