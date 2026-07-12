import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterArtisanRoutes,
  type ArtisanRoute,
  type ArtisanRoutesGateway,
  type ArtisanRoutesResult,
} from "../domain/artisanRoutes";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface RootRoutesState {
  loading: boolean;
  result: ArtisanRoutesResult | null;
}

export interface UseArtisanRoutesOptions {
  gateway: ArtisanRoutesGateway;
  isOpen: boolean;
  rootPath: string | null;
}

export interface ArtisanRoutesState {
  clear(): void;
  error: string | null;
  filteredRoutes: ArtisanRoute[];
  loading: boolean;
  query: string;
  refresh(): Promise<void>;
  routes: ArtisanRoute[];
  setQuery(query: string): void;
  total: number;
  unavailable: string | null;
}

const emptyState: RootRoutesState = { loading: false, result: null };

export function useArtisanRoutes({
  gateway,
  isOpen,
  rootPath,
}: UseArtisanRoutesOptions): ArtisanRoutesState {
  const [states, setStates] = useState<Record<string, RootRoutesState>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const currentRootRef = useRef(rootPath);
  currentRootRef.current = rootPath;
  const state = rootPath ? states[rootPath] ?? emptyState : emptyState;
  const query = rootPath ? queries[rootPath] ?? "" : "";

  const refresh = useCallback(async () => {
    const requestedRoot = rootPath;

    if (!requestedRoot) {
      return;
    }

    setStates((current) => ({
      ...current,
      [requestedRoot]: {
        loading: true,
        result: current[requestedRoot]?.result ?? null,
      },
    }));

    try {
      const result = await gateway.list(requestedRoot);
      const storeResult = () => {
        setStates((current) => ({
          ...current,
          [requestedRoot]: { loading: false, result },
        }));
      };

      if (!workspaceRootKeysEqual(currentRootRef.current, requestedRoot)) {
        storeResult();
        return;
      }

      storeResult();
    } catch (error) {
      const storeError = () => {
        setStates((current) => ({
          ...current,
          [requestedRoot]: {
            loading: false,
            result: {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        }));
      };

      if (!workspaceRootKeysEqual(currentRootRef.current, requestedRoot)) {
        storeError();
        return;
      }

      storeError();
    }
  }, [gateway, rootPath]);

  useEffect(() => {
    if (!isOpen || !rootPath || states[rootPath]) {
      return;
    }

    void refresh();
  }, [isOpen, refresh, rootPath, states]);

  const clear = useCallback(() => {
    const requestedRoot = rootPath;

    if (!requestedRoot) {
      return;
    }

    setStates((current) => {
      const next = { ...current };
      delete next[requestedRoot];
      return next;
    });
    setQueries((current) => {
      const next = { ...current };
      delete next[requestedRoot];
      return next;
    });
  }, [rootPath]);

  const setQuery = useCallback(
    (nextQuery: string) => {
      if (!rootPath) {
        return;
      }

      setQueries((current) => ({ ...current, [rootPath]: nextQuery }));
    },
    [rootPath],
  );

  const routes = state.result?.status === "ok" ? state.result.routes : [];
  const filteredRoutes = useMemo(
    () => filterArtisanRoutes(routes, query),
    [query, routes],
  );

  return {
    clear,
    error: state.result?.status === "error" ? state.result.message : null,
    filteredRoutes,
    loading: state.loading,
    query,
    refresh,
    routes,
    setQuery,
    total: state.result?.status === "ok" ? state.result.total : 0,
    unavailable:
      state.result?.status === "unavailable" ? state.result.message : null,
  };
}
