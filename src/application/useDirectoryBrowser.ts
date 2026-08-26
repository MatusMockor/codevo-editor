import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  filterDirectoryEntries,
  MAX_DIRECTORY_FILTER_QUERY_CHARS,
  type DirectoryEntry,
  type DirectoryListing,
  type DirectoryListingGateway,
} from "../domain/directoryListing";

export const DIRECTORY_BROWSER_LOAD_FAILED = "Unable to list that directory.";
export const MAX_DIRECTORY_BROWSER_HISTORY = 50;

export type DirectoryBrowserStatus = "loading" | "loaded" | "error";

export interface DirectoryBrowserSurface {
  readonly status: DirectoryBrowserStatus;
  readonly listing: DirectoryListing | null;
  readonly error: string | null;
  readonly homePath: string | null;
  readonly query: string;
  readonly showHidden: boolean;
  readonly canGoBack: boolean;
  readonly visibleEntries: ReadonlyArray<DirectoryEntry>;
  navigateTo(path: string): void;
  descend(name: string): void;
  ascend(): void;
  goBack(): void;
  reload(): void;
  setQuery(query: string): void;
  setShowHidden(showHidden: boolean): void;
}

export interface DirectoryBrowserOptions {
  readonly includeFiles?: boolean;
  readonly initialPath?: string | null;
}

interface DirectoryBrowserState {
  readonly status: DirectoryBrowserStatus;
  readonly listing: DirectoryListing | null;
  readonly error: string | null;
  readonly path: string | null;
  readonly history: ReadonlyArray<string>;
  readonly homePath: string | null;
  readonly query: string;
  readonly showHidden: boolean;
}

type DirectoryBrowserAction =
  | { readonly type: "navigate"; readonly path: string }
  | { readonly type: "back"; readonly path: string }
  | { readonly type: "reload" }
  | {
      readonly type: "resolved";
      readonly path: string | null;
      readonly listing: DirectoryListing;
    }
  | { readonly type: "rejected"; readonly message: string }
  | { readonly type: "query"; readonly query: string }
  | { readonly type: "showHidden"; readonly showHidden: boolean };

const NO_ENTRIES: ReadonlyArray<DirectoryEntry> = [];

export function useDirectoryBrowser(
  gateway: DirectoryListingGateway,
  options?: DirectoryBrowserOptions,
): DirectoryBrowserSurface {
  const includeFiles = options?.includeFiles ?? false;
  const initialPath = options?.initialPath ?? null;
  const [state, dispatch] = useReducer(reduceDirectoryBrowser, initialPath, createInitialState);
  const gatewayRef = useRef(gateway);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    gatewayRef.current = gateway;
  }, [gateway]);

  const load = useCallback(
    (path: string | null) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      const isCurrent = () => mountedRef.current && generationRef.current === generation;
      void gatewayRef.current
        .listDirectoryEntries({ path, includeFiles })
        .then((listing) => {
          if (!isCurrent()) return;
          dispatch({ type: "resolved", path, listing });
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          dispatch({ type: "rejected", message: loadErrorMessage(error) });
        });
    },
    [includeFiles],
  );

  useEffect(() => {
    mountedRef.current = true;
    load(initialPath);
    return () => {
      mountedRef.current = false;
    };
  }, [initialPath, load]);

  const navigateTo = useCallback(
    (path: string) => {
      dispatch({ type: "navigate", path });
      load(path);
    },
    [load],
  );

  const listing = state.listing;

  const descend = useCallback(
    (name: string) => {
      if (listing === null) return;
      navigateTo(joinDirectoryPath(listing.path, name));
    },
    [listing, navigateTo],
  );

  const ascend = useCallback(() => {
    if (listing === null || listing.parent === null) return;
    navigateTo(listing.parent);
  }, [listing, navigateTo]);

  const history = state.history;

  const goBack = useCallback(() => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    dispatch({ type: "back", path: previous });
    load(previous);
  }, [history, load]);

  const currentPath = state.path;

  const reload = useCallback(() => {
    dispatch({ type: "reload" });
    load(currentPath);
  }, [currentPath, load]);

  const setQuery = useCallback((query: string) => {
    dispatch({ type: "query", query });
  }, []);

  const setShowHidden = useCallback((showHidden: boolean) => {
    dispatch({ type: "showHidden", showHidden });
  }, []);

  const visibleEntries = useMemo(
    () => projectVisibleEntries(listing, state.query, state.showHidden, includeFiles),
    [includeFiles, listing, state.query, state.showHidden],
  );

  return {
    status: state.status,
    listing,
    error: state.error,
    homePath: state.homePath,
    query: state.query,
    showHidden: state.showHidden,
    canGoBack: history.length > 0,
    visibleEntries,
    navigateTo,
    descend,
    ascend,
    goBack,
    reload,
    setQuery,
    setShowHidden,
  };
}

function createInitialState(initialPath: string | null): DirectoryBrowserState {
  return {
    status: "loading",
    listing: null,
    error: null,
    path: initialPath,
    history: [],
    homePath: null,
    query: "",
    showHidden: false,
  };
}

function reduceDirectoryBrowser(
  state: DirectoryBrowserState,
  action: DirectoryBrowserAction,
): DirectoryBrowserState {
  switch (action.type) {
    case "navigate":
      return {
        ...state,
        status: "loading",
        error: null,
        path: action.path,
        history: pushHistory(state.history, state.listing),
        query: "",
      };
    case "back":
      return {
        ...state,
        status: "loading",
        error: null,
        path: action.path,
        history: state.history.slice(0, -1),
      };
    case "reload":
      return { ...state, status: "loading", error: null };
    case "resolved":
      return {
        ...state,
        status: "loaded",
        listing: action.listing,
        error: null,
        homePath: action.path === null ? action.listing.path : state.homePath,
      };
    case "rejected":
      return { ...state, status: "error", error: action.message };
    case "query":
      return { ...state, query: action.query.slice(0, MAX_DIRECTORY_FILTER_QUERY_CHARS) };
    case "showHidden":
      return { ...state, showHidden: action.showHidden };
    default: {
      const unsupported: never = action;
      return unsupported;
    }
  }
}

function pushHistory(
  history: ReadonlyArray<string>,
  listing: DirectoryListing | null,
): ReadonlyArray<string> {
  if (listing === null) return history;
  return [...history, listing.path].slice(-MAX_DIRECTORY_BROWSER_HISTORY);
}

function projectVisibleEntries(
  listing: DirectoryListing | null,
  query: string,
  showHidden: boolean,
  includeFiles: boolean,
): ReadonlyArray<DirectoryEntry> {
  if (listing === null) return NO_ENTRIES;
  const filtered = filterDirectoryEntries(listing.entries, query, showHidden);
  const scoped = includeFiles ? filtered : filtered.filter((entry) => entry.kind !== "file");
  return [...scoped].sort(compareDirectoryEntries);
}

function compareDirectoryEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  const leftRank = left.kind === "file" ? 1 : 0;
  const rightRank = right.kind === "file" ? 1 : 0;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftName = left.name.toLocaleLowerCase();
  const rightName = right.name.toLocaleLowerCase();
  if (leftName === rightName) return 0;
  return leftName < rightName ? -1 : 1;
}

function joinDirectoryPath(path: string, name: string): string {
  return `${path === "/" ? "" : path}/${name}`;
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return DIRECTORY_BROWSER_LOAD_FAILED;
}
