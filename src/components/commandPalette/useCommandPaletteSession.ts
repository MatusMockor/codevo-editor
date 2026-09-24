import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { CommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import {
  INITIAL_PALETTE_NAVIGATION,
  currentPalettePage,
  reducePaletteNavigation,
} from "../../domain/commandPalette/paletteNavigation";
import {
  paletteSurfaceForPage,
  type PalettePageId,
} from "../../domain/commandPalette/palettePages";

export interface CommandPaletteSessionOptions {
  readonly paletteOpen: boolean;
  readonly quickOpenOpen: boolean;
  readonly initialQuery: string;
  readonly launch: CommandPaletteLaunch;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
}

export interface CommandPaletteSession {
  readonly visible: boolean;
  readonly page: PalettePageId;
  readonly query: string;
  readonly generation: number;
  readonly canGoBack: boolean;
  setQuery(query: string): void;
  push(page: PalettePageId): void;
  pop(): void;
  open(page: PalettePageId, query: string): void;
  close(): void;
}

export function useCommandPaletteSession({
  initialQuery,
  launch,
  paletteOpen,
  quickOpenOpen,
  setPaletteOpen,
  setQuickOpenOpen,
}: CommandPaletteSessionOptions): CommandPaletteSession {
  const [state, dispatch] = useReducer(reducePaletteNavigation, INITIAL_PALETTE_NAVIGATION);
  const internal = useRef(false);
  const previous = useRef({ paletteOpen: false, quickOpenOpen: false });
  const visible = paletteOpen || quickOpenOpen;
  const page = currentPalettePage(state);

  const syncFlags = useCallback(
    (target: PalettePageId) => {
      const files = paletteSurfaceForPage(target) === "files";
      if (paletteOpen === !files && quickOpenOpen === files) return;
      internal.current = true;
      setPaletteOpen(!files);
      setQuickOpenOpen(files);
    },
    [paletteOpen, quickOpenOpen, setPaletteOpen, setQuickOpenOpen],
  );

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { paletteOpen, quickOpenOpen };
    if (internal.current) {
      internal.current = false;
      return;
    }
    if (paletteOpen && !before.paletteOpen) {
      const request = launch.take();
      dispatch(
        request === null
          ? { type: "open", page: "root", query: `>${initialQuery}` }
          : { type: "open", ...request },
      );
      return;
    }
    if (quickOpenOpen && !before.quickOpenOpen)
      dispatch({ type: "open", page: "files", query: "" });
  }, [initialQuery, launch, paletteOpen, quickOpenOpen]);

  useEffect(() => {
    if (!visible) return undefined;
    return launch.subscribe(() => {
      const request = launch.take();
      if (request === null) return;
      dispatch({ type: "open", ...request });
      syncFlags(request.page);
    });
  }, [launch, syncFlags, visible]);

  const push = useCallback(
    (target: PalettePageId) => {
      dispatch({ type: "push", page: target });
      if (paletteSurfaceForPage(target) === paletteSurfaceForPage(page)) return;
      syncFlags(target);
    },
    [page, syncFlags],
  );
  const pop = useCallback(() => {
    const parent = state.stack[state.stack.length - 2];
    if (parent === undefined) return;
    dispatch({ type: "pop" });
    if (paletteSurfaceForPage(parent) === paletteSurfaceForPage(page)) return;
    syncFlags(parent);
  }, [page, state.stack, syncFlags]);
  const open = useCallback(
    (target: PalettePageId, query: string) => {
      dispatch({ type: "open", page: target, query });
      syncFlags(target);
    },
    [syncFlags],
  );
  const close = useCallback(() => {
    internal.current = false;
    setPaletteOpen(false);
    setQuickOpenOpen(false);
  }, [setPaletteOpen, setQuickOpenOpen]);
  const setQuery = useCallback((query: string) => dispatch({ type: "setQuery", query }), []);

  return {
    visible,
    page,
    query: state.query,
    generation: state.generation,
    canGoBack: state.stack.length > 1,
    setQuery,
    push,
    pop,
    open,
    close,
  };
}
