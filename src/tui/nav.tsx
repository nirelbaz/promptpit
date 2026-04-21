// Stack-based navigation for the TUI. Screens are React components; pushing
// adds one on top, popping returns to the previous. The `useNav` hook lets
// any screen navigate without threading props through every ancestor.
//
// This is deliberately minimal — Ink TUIs don't need React Navigation's
// scene registry or deep-linking. A plain factory-stack covers every
// transition in the plan (push a wizard step, pop to go back, popTo(0)
// to return to the main list after a completed action).
import { createContext, useContext, useState, type ReactNode } from "react";

type ScreenFactory = () => ReactNode;

interface NavApi {
  push: (factory: ScreenFactory) => void;
  replace: (factory: ScreenFactory) => void;
  pop: () => void;
  /** Pop the stack back to the given depth (0 = root). Handy for
   *  "return to main list" after a wizard finishes. */
  popTo: (depth: number) => void;
  depth: number;
}

const NavContext = createContext<NavApi | null>(null);

export function NavProvider({ initial }: { initial: ScreenFactory }) {
  const [stack, setStack] = useState<ScreenFactory[]>(() => [initial]);

  const api: NavApi = {
    push: (factory) => setStack((s) => [...s, factory]),
    replace: (factory) => setStack((s) => [...s.slice(0, -1), factory]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    popTo: (depth) => setStack((s) => s.slice(0, Math.max(1, Math.min(depth + 1, s.length)))),
    depth: stack.length - 1,
  };

  const top = stack[stack.length - 1]!;
  return (
    <NavContext.Provider value={api}>
      {top()}
    </NavContext.Provider>
  );
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be called inside NavProvider");
  return ctx;
}
