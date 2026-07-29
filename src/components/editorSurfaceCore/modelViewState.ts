import type * as Monaco from "monaco-editor";

export interface FoldingRegionViewState {
  isCollapsed: boolean;
  regionIndex: number;
  startLineNumber: number;
}

export interface FoldingModelViewState {
  onDidChange(listener: () => void): Monaco.IDisposable;
  regions: {
    getStartLineNumber(index: number): number;
    isCollapsed(index: number): boolean;
    length: number;
    toRegion(index: number): FoldingRegionViewState;
  };
  toggleCollapseState(regions: FoldingRegionViewState[]): void;
}

interface FoldingControllerViewState {
  getFoldingModel(): Promise<FoldingModelViewState | null> | null;
}

export function pruneClosedPaths<Value>(
  cache: Record<string, Value>,
  openPaths: Set<string>,
): Record<string, Value> {
  const stalePaths = Object.keys(cache).filter((path) => !openPaths.has(path));
  if (stalePaths.length === 0) {
    return cache;
  }

  const next = { ...cache };
  stalePaths.forEach((path) => delete next[path]);
  return next;
}

export async function foldingModelForEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
): Promise<FoldingModelViewState | null> {
  const contribution = editor.getContribution(
    "editor.contrib.folding",
  ) as unknown as FoldingControllerViewState | null;

  if (typeof contribution?.getFoldingModel !== "function") {
    return null;
  }

  try {
    return await contribution.getFoldingModel();
  } catch {
    return null;
  }
}
