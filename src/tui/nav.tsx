import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ScreenFactory = () => ReactNode;

interface NavApi {
  push: (factory: ScreenFactory) => void;
  replace: (factory: ScreenFactory) => void;
  pop: () => void;
  /** Pop the stack back to the given depth (0 = root). Handy for
   *  "return to main list" after a wizard finishes. */
  popTo: (depth: number) => void;
}

const NavContext = createContext<NavApi | null>(null);

export function NavProvider({ initial }: { initial: ScreenFactory }) {
  const [stack, setStack] = useState<ScreenFactory[]>(() => [initial]);

  // Stable identities so consumers that put `nav` in a useEffect dep array
  // (e.g. Flash's auto-dismiss timer) don't re-run on every parent rerender.
  const push = useCallback((factory: ScreenFactory) => setStack((s) => [...s, factory]), []);
  const replace = useCallback((factory: ScreenFactory) => setStack((s) => [...s.slice(0, -1), factory]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const popTo = useCallback((depth: number) => {
    const safe = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
    setStack((s) => s.slice(0, Math.min(safe + 1, s.length)));
  }, []);

  const api = useMemo<NavApi>(
    () => ({ push, replace, pop, popTo }),
    [push, replace, pop, popTo],
  );

  const top = stack[stack.length - 1];
  return (
    <NavContext.Provider value={api}>
      {top ? top() : null}
    </NavContext.Provider>
  );
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be called inside NavProvider");
  return ctx;
}
