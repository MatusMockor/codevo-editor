import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";

interface QuickOpenPrefixDispatch {
  openCommands: (query: string) => void;
  openCurrentFileSymbols: (query: string) => void;
  openWorkspaceSymbols: (query: string) => void;
}

export type QuickOpenPrefixDispatchRef = MutableRefObject<QuickOpenPrefixDispatch>;

export function useQuickOpenSeededSurfaceState() {
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState("");
  const [fileStructureInitialQuery, setFileStructureInitialQuery] = useState("");

  const setPaletteOpen = useCallback((open: boolean) => {
    if (open) {
      setCommandPaletteInitialQuery("");
    }
    setPaletteOpenState(open);
  }, []);

  const openCommandPaletteWithInitialQuery = useCallback((query: string) => {
    setCommandPaletteInitialQuery(query);
    setPaletteOpenState(true);
  }, []);

  return {
    commandPaletteInitialQuery,
    fileStructureInitialQuery,
    openCommandPaletteWithInitialQuery,
    paletteOpen,
    setFileStructureInitialQuery,
    setPaletteOpen,
  };
}

export function useQuickOpenPrefixDispatch() {
  const quickOpenDispatchRef = useRef<QuickOpenPrefixDispatch>({
    openCommands: () => {},
    openCurrentFileSymbols: () => {},
    openWorkspaceSymbols: () => {},
  });
  const openCommands = useCallback(
    (query: string) => quickOpenDispatchRef.current.openCommands(query),
    [],
  );
  const openCurrentFileSymbols = useCallback(
    (query: string) => quickOpenDispatchRef.current.openCurrentFileSymbols(query),
    [],
  );
  const openWorkspaceSymbols = useCallback(
    (query: string) => quickOpenDispatchRef.current.openWorkspaceSymbols(query),
    [],
  );

  return {
    openCommands,
    openCurrentFileSymbols,
    openWorkspaceSymbols,
    quickOpenDispatchRef,
  };
}

function useQuickOpenPrefixDispatchEffect(
  dispatchRef: QuickOpenPrefixDispatchRef,
  openFileStructure: (query: string) => void,
  openWorkspaceSymbols: (query: string) => void,
  openCommands: (query: string) => void,
): void {
  useLayoutEffect(() => {
    dispatchRef.current = {
      openCommands,
      openCurrentFileSymbols: openFileStructure,
      openWorkspaceSymbols,
    };
  }, [dispatchRef, openCommands, openFileStructure, openWorkspaceSymbols]);
}

function useWorkspaceSymbolsQuickOpenSeed(
  setQuery: (query: string) => void,
  openSurface: () => void,
) {
  const openWorkspaceSymbols = useCallback(() => {
    setQuery("");
    openSurface();
  }, [openSurface, setQuery]);
  const openWorkspaceSymbolsWithInitialQuery = useCallback(
    (query: string) => {
      setQuery(query);
      openSurface();
    },
    [openSurface, setQuery],
  );

  return [openWorkspaceSymbols, openWorkspaceSymbolsWithInitialQuery] as const;
}

export function useQuickOpenPrefixDestinations(
  dispatch: { quickOpenDispatchRef: QuickOpenPrefixDispatchRef },
  openFileStructure: (query: string) => void,
  setWorkspaceSymbolsQuery: (query: string) => void,
  openWorkspaceSymbolsSurface: () => void,
  openCommands: (query: string) => void,
) {
  const [openWorkspaceSymbols, openWorkspaceSymbolsWithInitialQuery] =
    useWorkspaceSymbolsQuickOpenSeed(setWorkspaceSymbolsQuery, openWorkspaceSymbolsSurface);
  useQuickOpenPrefixDispatchEffect(
    dispatch.quickOpenDispatchRef,
    openFileStructure,
    openWorkspaceSymbolsWithInitialQuery,
    openCommands,
  );
  return openWorkspaceSymbols;
}
