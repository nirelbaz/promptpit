import * as clack from "@clack/prompts";

/**
 * Thin wrappers around @clack/prompts used by interactive flows
 * (install/update/collect/init).
 *
 * All prompts surface Ctrl+C as a `PromptCancelledError` so callers can
 * abort cleanly without each site needing to check clack's cancel symbol.
 */

export class PromptCancelledError extends Error {
  constructor() {
    super("prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

export type DriftAction = "keep" | "upstream" | "diff" | "skip";

export interface ChooseOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * Throw with an actionable message when an explicit interactive flag is
 * used in a non-TTY environment (CI, piped stdin).
 */
export function requireInteractive(flag: string): void {
  if (!isInteractive()) {
    throw new Error(
      `${flag} requires an interactive terminal. Remove the flag or run in a TTY.`,
    );
  }
}

function ensureValue<T>(result: T | symbol): T {
  if (clack.isCancel(result)) {
    throw new PromptCancelledError();
  }
  return result as T;
}

export async function chooseOne<T>(
  message: string,
  options: ChooseOption<T>[],
  initialValue?: T,
): Promise<T> {
  const result = await clack.select<T>({
    message,
    // Clack's Option<T> type is conditional on T being a primitive; our
    // ChooseOption always carries a required label, which satisfies both
    // branches. TypeScript can't narrow through the generic, so we cast.
    options: options as never,
    initialValue,
  });
  return ensureValue(result);
}

export async function chooseMany<T>(
  message: string,
  options: ChooseOption<T>[],
  initialValues?: T[],
): Promise<T[]> {
  const result = await clack.multiselect<T>({
    message,
    options: options as never,
    initialValues,
    required: false,
  });
  return ensureValue(result);
}

/**
 * Four-way picker used by `pit update --interactive` to resolve drift
 * conflicts. Callers handle the `diff → re-prompt` loop themselves so the
 * diff rendering stays in the command module.
 */
export async function chooseDriftAction(message: string): Promise<DriftAction> {
  return chooseOne<DriftAction>(
    message,
    [
      {
        value: "keep",
        label: "keep mine",
        hint: "fork from upstream at this baseline",
      },
      {
        value: "upstream",
        label: "take upstream",
        hint: "overwrite local with the new upstream version",
      },
      { value: "diff", label: "view diff" },
      {
        value: "skip",
        label: "skip",
        hint: "leave both as-is; ask again next update",
      },
    ],
    "skip",
  );
}

export async function confirm(
  message: string,
  initialValue = false,
): Promise<boolean> {
  const result = await clack.confirm({ message, initialValue });
  return ensureValue(result);
}

export async function text(
  message: string,
  opts?: { placeholder?: string; defaultValue?: string },
): Promise<string> {
  const result = await clack.text({
    message,
    placeholder: opts?.placeholder,
    defaultValue: opts?.defaultValue,
  });
  return ensureValue(result);
}
