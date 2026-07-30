import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
  type LanguageServerFeaturesGateway,
  type LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { projectSymbolKindFromLanguageServerSymbolKind } from "../domain/languageServerWorkspaceSymbolKind";
import { cachedLanguageServerRuntimeStatusForRoot } from "../domain/languageServerRuntimeStatusCache";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
  type ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import type { IntelligenceMode } from "../domain/workspace";
import { getFileName } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { requestJavaScriptTypeScriptWorkspaceSymbols } from "./javaScriptTypeScriptWorkspaceSymbolRequest";

export const INDEXED_PROJECT_SYMBOL_SEARCH_TIMEOUT_MS = 5_000;

export interface WorkbenchClassOpenDependencies {
  workspaceRoot: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  intelligenceMode: IntelligenceMode;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  languageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  languageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  javaScriptTypeScriptLanguageServerFeaturesGateway: Pick<
    JavaScriptTypeScriptLanguageServerFeaturesGateway,
    "workspaceSymbols"
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  cancelJavaScriptTypeScriptLanguageServerRequest: (
    rootPath: string,
    sessionId: number,
    requestId: number,
  ) => Promise<void>;
  resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
  reportError: (source: string, error: unknown) => void;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export interface WorkbenchClassOpen {
  classOpenOpen: boolean;
  classOpenQuery: string;
  classOpenLoading: boolean;
  classOpenResults: ProjectSymbolSearchResult[];
  canSearchClassOpenSymbols: boolean;
  setClassOpenOpen: Dispatch<SetStateAction<boolean>>;
  setClassOpenQuery: Dispatch<SetStateAction<string>>;
  setClassOpenLoading: Dispatch<SetStateAction<boolean>>;
  setClassOpenResults: Dispatch<SetStateAction<ProjectSymbolSearchResult[]>>;
  searchClassOpenSymbols: (
    query: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<ProjectSymbolSearchResult[]>;
}

export function useWorkbenchClassOpen(
  dependencies: WorkbenchClassOpenDependencies,
): WorkbenchClassOpen {
  const {
    workspaceRoot,
    currentWorkspaceRootRef,
    intelligenceMode,
    projectSymbolSearch,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    cancelJavaScriptTypeScriptLanguageServerRequest,
    resolveWorkspaceRuntimeOwner,
    reportError,
    setMessage,
  } = dependencies;

  const [classOpenOpen, setClassOpenOpen] = useState(false);
  const [classOpenQuery, setClassOpenQuery] = useState("");
  const [classOpenLoading, setClassOpenLoading] = useState(false);
  const [classOpenResults, setClassOpenResults] = useState<ProjectSymbolSearchResult[]>([]);
  const workspaceOwner = workspaceRoot ? resolveWorkspaceRuntimeOwner(workspaceRoot) : null;

  const canSearchClassOpenSymbols = useMemo(
    () =>
      Boolean(
        shouldIndexWorkspace(intelligenceMode) ||
        (isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "workspaceSymbol",
          )) ||
        (isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) &&
          canUseLanguageServerFeature(
            javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
            "workspaceSymbol",
          )),
      ),
    [
      intelligenceMode,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      workspaceRoot,
    ],
  );

  const isLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
      isLanguageServerSessionCurrentForRoot(
        rootPath,
        sessionId,
        languageServerRuntimeStatusByRootRef,
        languageServerRuntimeStatusRef,
        languageServerRuntimeStatusRootRef,
      ),
    [
      currentWorkspaceRootRef,
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
    ],
  );

  const isJavaScriptTypeScriptLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
      isLanguageServerSessionCurrentForRoot(
        rootPath,
        sessionId,
        javaScriptTypeScriptRuntimeStatusByRootRef,
        javaScriptTypeScriptLanguageServerRuntimeStatusRef,
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      ),
    [
      currentWorkspaceRootRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
    ],
  );

  const searchClassOpenSymbols = useCallback(
    async (
      query: string,
      limit: number,
      signal?: AbortSignal,
    ): Promise<ProjectSymbolSearchResult[]> => {
      if (!workspaceRoot) {
        return [];
      }

      const requestedRoot = workspaceRoot;
      const requestedOwner = workspaceOwner;
      if (!requestedOwner) {
        return [];
      }
      const requestAbort = new AbortController();
      const abortRequest = () => requestAbort.abort();
      signal?.addEventListener("abort", abortRequest, { once: true });
      if (signal?.aborted) {
        abortRequest();
      }
      const requestTimeout = window.setTimeout(
        abortRequest,
        INDEXED_PROJECT_SYMBOL_SEARCH_TIMEOUT_MS,
      );
      const searches: Array<Promise<ProjectSymbolSearchResult[]>> = [];

      if (shouldIndexWorkspace(intelligenceMode)) {
        searches.push(
          projectSymbolSearch.searchProjectSymbols(
            requestedRoot,
            query,
            limit,
            requestAbort.signal,
          ),
        );
      }

      if (
        isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(languageServerRuntimeStatus.capabilities, "workspaceSymbol")
      ) {
        const requestedSessionId = languageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () => {
          const currentOwner = resolveWorkspaceRuntimeOwner(requestedRoot);
          return (
            !requestAbort.signal.aborted &&
            currentOwner === requestedOwner &&
            currentOwner.ownerKey === requestedOwner.ownerKey &&
            isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId)
          );
        };

        searches.push(
          languageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(requestedRoot, symbol),
                )
                .filter((symbol): symbol is ProjectSymbolSearchResult => symbol !== null);
            })
            .catch((error) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              reportError("PHP Workspace Symbols", error);
              return [];
            }),
        );
      }

      if (
        isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () => {
          const currentOwner = resolveWorkspaceRuntimeOwner(requestedRoot);
          return (
            requestAbort.signal.aborted !== true &&
            currentOwner?.ownerKey === requestedOwner.ownerKey &&
            currentOwner === requestedOwner &&
            isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
              requestedRoot,
              requestedSessionId,
            )
          );
        };

        searches.push(
          requestJavaScriptTypeScriptWorkspaceSymbols({
            cancelRequest: cancelJavaScriptTypeScriptLanguageServerRequest,
            gateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
            isAuthorityCurrent: isRequestedWorkspaceSymbolSessionActive,
            query,
            rootPath: requestedRoot,
            sessionId: requestedSessionId,
            signal: requestAbort.signal,
          })
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return projectSymbolsFromLanguageServerWorkspaceSymbols(
                requestedRoot,
                symbols,
                limit,
              );
            })
            .catch((error) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              reportError("JavaScript/TypeScript Workspace Symbols", error);
              return [];
            }),
        );
      }

      try {
        const results = (
          await settleProjectSymbolSearchBeforeAbort(Promise.all(searches), requestAbort.signal)
        ).flat();
        const currentOwner = resolveWorkspaceRuntimeOwner(requestedRoot);
        if (
          requestAbort.signal.aborted ||
          currentOwner !== requestedOwner ||
          currentOwner.ownerKey !== requestedOwner.ownerKey ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return [];
        }

        return uniqueProjectSymbols(results).slice(0, limit);
      } finally {
        window.clearTimeout(requestTimeout);
        signal?.removeEventListener("abort", abortRequest);
      }
    },
    [
      currentWorkspaceRootRef,
      cancelJavaScriptTypeScriptLanguageServerRequest,
      intelligenceMode,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      projectSymbolSearch,
      reportError,
      resolveWorkspaceRuntimeOwner,
      workspaceOwner,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (!classOpenOpen || !workspaceRoot || !classOpenQuery.trim() || !canSearchClassOpenSymbols) {
      setClassOpenResults([]);
      setClassOpenLoading(false);
      return;
    }

    let active = true;
    const abort = new AbortController();
    setClassOpenResults([]);
    setClassOpenLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(classOpenQuery, 120, abort.signal)
        .then((results) => {
          if (!active) {
            return;
          }

          setClassOpenResults(results.filter(isTypeProjectSymbol).slice(0, 80));
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setClassOpenResults([]);
          reportError("Open Class", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setClassOpenLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    classOpenOpen,
    classOpenQuery,
    reportError,
    searchClassOpenSymbols,
    setMessage,
    workspaceRoot,
    workspaceOwner,
  ]);

  return {
    classOpenOpen,
    classOpenQuery,
    classOpenLoading,
    classOpenResults,
    canSearchClassOpenSymbols,
    setClassOpenOpen,
    setClassOpenQuery,
    setClassOpenLoading,
    setClassOpenResults,
    searchClassOpenSymbols,
  };
}

function settleProjectSymbolSearchBeforeAbort<T>(
  request: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Project-symbol search timed out.", "AbortError"));
  }
  let rejectAborted: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const abort = () => {
    rejectAborted?.(new DOMException("Project-symbol search timed out.", "AbortError"));
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return Promise.race([request, aborted]).finally(() => {
    signal.removeEventListener("abort", abort);
  });
}

function projectSymbolFromLanguageServerWorkspaceSymbol(
  workspaceRoot: string,
  symbol: LanguageServerWorkspaceSymbol,
): ProjectSymbolSearchResult | null {
  const path = symbol.location ? pathFromLanguageServerUri(symbol.location.uri) : null;
  const kind = projectSymbolKindFromLanguageServerSymbolKind(symbol.kind);

  if (!path || !kind || !symbol.location) {
    return null;
  }

  return {
    column: symbol.location.range.start.character + 1,
    containerName: symbol.containerName,
    fullyQualifiedName: symbol.containerName
      ? `${symbol.containerName}.${symbol.name}`
      : symbol.name,
    kind,
    lineNumber: symbol.location.range.start.line + 1,
    name: symbol.name,
    path,
    relativePath: relativeWorkspacePath(workspaceRoot, path),
  };
}

function projectSymbolsFromLanguageServerWorkspaceSymbols(
  workspaceRoot: string,
  symbols: readonly LanguageServerWorkspaceSymbol[],
  limit: number,
): ProjectSymbolSearchResult[] {
  const projected: ProjectSymbolSearchResult[] = [];
  for (const symbol of symbols) {
    const result = projectSymbolFromLanguageServerWorkspaceSymbol(workspaceRoot, symbol);
    if (result) projected.push(result);
    if (projected.length >= limit) break;
  }
  return projected;
}

function uniqueProjectSymbols(symbols: ProjectSymbolSearchResult[]): ProjectSymbolSearchResult[] {
  const seen = new Set<string>();
  const unique: ProjectSymbolSearchResult[] = [];

  for (const symbol of symbols) {
    const key = [
      symbol.kind,
      symbol.fullyQualifiedName,
      symbol.path,
      symbol.lineNumber,
      symbol.column,
    ].join("\0");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(symbol);
  }

  return unique;
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const normalizedPath = path.split("\\").join("/");

  if (normalizedPath === normalizedRoot) {
    return getFileName(path);
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return path;
}

function isLanguageServerSessionCurrentForRoot(
  rootPath: string,
  sessionId: number,
  runtimeStatusByRootRef: MutableRefObject<Record<string, LanguageServerRuntimeStatus>>,
  runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>,
  runtimeStatusRootRef: MutableRefObject<string | null>,
): boolean {
  const currentRuntimeStatus =
    cachedLanguageServerRuntimeStatusForRoot(runtimeStatusByRootRef.current, rootPath) ??
    (workspaceRootKeysEqual(runtimeStatusRootRef.current, rootPath)
      ? runtimeStatusRef.current
      : null);

  return isRunningLanguageServerSessionForWorkspace(
    currentRuntimeStatus,
    currentRuntimeStatus?.rootPath ?? runtimeStatusRootRef.current,
    rootPath,
    sessionId,
  );
}

function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  if (!isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot)) {
    return false;
  }

  return status.kind === "running";
}

function isRunningLanguageServerSessionForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
  sessionId: number,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  return (
    isRunningLanguageServerForWorkspace(status, statusRoot, workspaceRoot) &&
    status.sessionId === sessionId
  );
}

function isLanguageServerStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is LanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus = status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot);
}
