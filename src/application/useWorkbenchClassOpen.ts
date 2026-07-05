import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  shouldIndexWorkspace,
} from "../domain/intelligence";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  type LanguageServerFeaturesGateway,
  type LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForRoot,
} from "../domain/languageServerRuntimeStatusCache";
import {
  isTypeProjectSymbol,
  type ProjectSymbolKind,
  type ProjectSymbolSearchGateway,
  type ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import type { IntelligenceMode } from "../domain/workspace";
import { getFileName } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

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
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<
    LanguageServerRuntimeStatus | null
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<
    string | null
  >;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
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
    reportError,
    setMessage,
  } = dependencies;

  const [classOpenOpen, setClassOpenOpen] = useState(false);
  const [classOpenQuery, setClassOpenQuery] = useState("");
  const [classOpenLoading, setClassOpenLoading] = useState(false);
  const [classOpenResults, setClassOpenResults] = useState<
    ProjectSymbolSearchResult[]
  >([]);

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
    async (query: string, limit: number): Promise<ProjectSymbolSearchResult[]> => {
      if (!workspaceRoot) {
        return [];
      }

      const requestedRoot = workspaceRoot;
      const searches: Array<Promise<ProjectSymbolSearchResult[]>> = [];

      if (shouldIndexWorkspace(intelligenceMode)) {
        searches.push(
          projectSymbolSearch.searchProjectSymbols(requestedRoot, query, limit),
        );
      }

      if (
        isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        const requestedSessionId = languageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () =>
          isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

        searches.push(
          languageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    requestedRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
                );
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
        const requestedSessionId =
          javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () =>
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
            requestedRoot,
            requestedSessionId,
          );

        searches.push(
          javaScriptTypeScriptLanguageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    requestedRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
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

      const results = (await Promise.all(searches)).flat();
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return [];
      }

      return uniqueProjectSymbols(results).slice(0, limit);
    },
    [
      currentWorkspaceRootRef,
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
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (
      !classOpenOpen ||
      !workspaceRoot ||
      !classOpenQuery.trim() ||
      !canSearchClassOpenSymbols
    ) {
      setClassOpenResults([]);
      setClassOpenLoading(false);
      return;
    }

    let active = true;
    setClassOpenLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(classOpenQuery, 120)
        .then((results) => {
          if (!active) {
            return;
          }

          setClassOpenResults(
            results.filter(isTypeProjectSymbol).slice(0, 80),
          );
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

function projectSymbolKindFromLanguageServerSymbolKind(
  kind: number,
): ProjectSymbolKind | null {
  if (kind === 5) {
    return "class";
  }

  if (kind === 6) {
    return "method";
  }

  if (kind === 10) {
    return "enum";
  }

  if (kind === 11) {
    return "interface";
  }

  if (kind === 12) {
    return "function";
  }

  return null;
}

function uniqueProjectSymbols(
  symbols: ProjectSymbolSearchResult[],
): ProjectSymbolSearchResult[] {
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
  runtimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >,
  runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>,
  runtimeStatusRootRef: MutableRefObject<string | null>,
): boolean {
  const currentRuntimeStatus =
    cachedLanguageServerRuntimeStatusForRoot(
      runtimeStatusByRootRef.current,
      rootPath,
    ) ??
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

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}
