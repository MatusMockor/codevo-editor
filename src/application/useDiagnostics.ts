import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { EditorDocument } from "../domain/workspace";
import type { AppSettings } from "../domain/settings";
import {
  capDiagnosticNotices,
  capWorkbenchNotices,
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  buildDiagnosticOverflowNotice,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  diagnosticNoticeNavigationTarget,
  GLOBAL_NOTICE_LIMIT,
  isCappableDiagnosticNotice,
  javaScriptTypeScriptDiagnosticNoticeGroup,
  localPhpDiagnosticsFromSource,
  PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX,
  phpLocalDiagnosticNoticeGroup,
} from "./diagnosticNotices";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  shouldApplyLanguageServerDiagnostics,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticEvent,
} from "../domain/languageServerDiagnostics";
import { type PhpSyntaxDiagnosticsGateway } from "../domain/phpSyntaxDiagnostics";
import type { DiagnosticsCoalescer } from "../domain/diagnosticsCoalescer";
import {
  fileUriFromPath,
  languageServerUriSyncKey,
} from "../domain/languageServerDocumentSync";
import { pathFromLanguageServerUri } from "../domain/languageServerFeatures";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  cachedLanguageServerRuntimeStatusForRoot,
} from "../domain/languageServerRuntimeStatusCache";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import type { WorkspaceSettingsForRoot } from "./workspaceSettingsForRoot";

const PHPSTAN_DIAGNOSTIC_NOTICE_LIMIT = 500;
const ESLINT_DIAGNOSTIC_NOTICE_LIMIT = 500;

/**
 * Collaborators the workbench shell owns and injects into the diagnostics hook.
 * Diagnostics state (the four `set*DiagnosticsByPath` families and `setNotices`)
 * stays a shell-owned useState so the shell-side derived memos (merged / summary
 * / effectiveNotices) and the workbench return keep reading it directly; every
 * shared ref (per-root diagnostics caches, coalescers, applied-version maps,
 * runtime-status maps, the contextual PHP filter ref) also stays shell-owned
 * because other flows (document sync, LSP runtime handlers, framework
 * diagnostics, workspace switch/close) touch the same refs. The session
 * guard, the externally-removed-path guard and the error reporter are shared
 * shell callbacks. All of it is injected here so the timing- and
 * isolation-sensitive diagnostics behavior stays byte-for-byte identical.
 */
export interface DiagnosticsDependencies {
  // Shared workspace + document state (shell-owned).
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  activeDocument: EditorDocument | null;

  // Settings snapshots (shell-owned refs).
  appSettingsRef: MutableRefObject<AppSettings>;
  workspaceSettingsForRoot: WorkspaceSettingsForRoot;

  // Diagnostics state setters (shell-owned useState).
  setLanguageServerDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  setJavaScriptTypeScriptDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  setPhpLocalDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  setFrameworkDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;

  // Per-root diagnostics caches + coalescers (shell-owned refs, shared with the
  // workspace switch/close and framework diagnostics flows).
  languageServerDiagnosticsByRootRef: MutableRefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  javaScriptTypeScriptDiagnosticsByRootRef: MutableRefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  languageServerDiagnosticsCoalescerRef: MutableRefObject<DiagnosticsCoalescer | null>;
  javaScriptTypeScriptDiagnosticsCoalescerRef: MutableRefObject<DiagnosticsCoalescer | null>;

  // Applied-diagnostic-version maps (shell-owned refs, shared with document sync).
  lastAppliedDiagnosticVersionByUriRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef: MutableRefObject<
    Record<string, number>
  >;

  // Runtime-status caches (shell-owned refs, shared with runtime handlers).
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  // Contextual PHP diagnostics filter ref (shell-owned; the semantic filter core
  // lives in the shell and writes this ref, apply reads it after each await).
  contextualDiagnosticsFilterRef: MutableRefObject<
    (
      path: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => Promise<LanguageServerDiagnostic[]>
  >;

  // Local PHP diagnostics validation refs (shell-owned).
  phpLocalDiagnosticValidationGenerationRef: MutableRefObject<number>;
  phpLocalDiagnosticRetryTimersRef: MutableRefObject<
    ReturnType<typeof setTimeout>[]
  >;

  // Local PHP syntax diagnostics gateway (external boundary).
  phpLocalSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;

  // Shared shell guards / reporters.
  isExternallyRemovedDocumentPath: (path: string) => boolean;
  isLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string,
    error: unknown,
  ) => void;
}

export interface Diagnostics {
  replaceEslintDiagnostics: (
    rootPath: string,
    notices: WorkbenchNotice[],
  ) => void;
  clearEslintDiagnosticsForRoot: (rootPath: string) => void;
  replacePhpstanDiagnostics: (
    rootPath: string,
    notices: WorkbenchNotice[],
  ) => void;
  clearPhpstanDiagnosticsForRoot: (rootPath: string) => void;
  clearLanguageServerDiagnostics: () => void;
  restoreLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareLanguageServerDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  clearLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  clearJavaScriptTypeScriptLanguageServerDiagnostics: () => void;
  clearPhpLocalDiagnostics: () => void;
  restoreJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  clearJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  clearPhpLocalDiagnosticsForPath: (diagnosticPath: string) => void;
  clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null | undefined,
    diagnosticPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  updateLocalPhpDiagnostics: (
    diagnosticPath: string,
    diagnostics: LanguageServerDiagnostic[],
  ) => void;
  refreshLocalPhpDiagnosticsForContent: (
    path: string,
    content: string,
    language: string,
  ) => void;
  applyLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
}

function diagnosticsOwnerKey(
  rootPath: string | null | undefined,
  owner?: WorkspaceRuntimeOwner,
): string {
  if (owner) {
    return owner.ownerKey;
  }

  return normalizedWorkspaceRootKey(rootPath);
}

function diagnosticsExecutionRoot(
  rootPath: string | null | undefined,
  owner?: WorkspaceRuntimeOwner,
): string | null | undefined {
  if (owner) {
    return owner.executionRoot;
  }

  return rootPath;
}

function diagnosticsEventForOwner(
  event: LanguageServerDiagnosticEvent,
  owner?: WorkspaceRuntimeOwner,
): LanguageServerDiagnosticEvent {
  if (!owner || event.rootPath === owner.executionRoot) {
    return event;
  }

  return { ...event, rootPath: owner.executionRoot };
}

function diagnosticsUriVersionKey(
  rootPath: string,
  uri: string,
  owner?: WorkspaceRuntimeOwner,
): string {
  if (owner) {
    return `${owner.ownerKey}\u0000${uri}`;
  }

  return languageServerUriSyncKey(rootPath, uri);
}

function diagnosticsOwnerLifecycleKey(
  kind: "php" | "typescript",
  ownerKey: string,
): string {
  return `${kind}:${ownerKey}`;
}

/**
 * Diagnostics (region F of the workbench controller decomposition). Owns the
 * apply/clear/restore/update lifecycle for PHP (phpactor) language-server
 * diagnostics, JavaScript/TypeScript (tsserver) diagnostics, and local PHP
 * syntax/inspection diagnostics. Every flow re-checks the live workspace root
 * (and, for language-server events, the running session + last-applied version)
 * after each await so a stale result from a switched-away or restarted workspace
 * tab is dropped and diagnostics stay isolated per project tab. Moved verbatim
 * from useWorkbenchController.
 */
export function useDiagnostics(
  dependencies: DiagnosticsDependencies,
): Diagnostics {
  const {
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    activeDocument,
    appSettingsRef,
    workspaceSettingsForRoot,
    setLanguageServerDiagnosticsByPath,
    setJavaScriptTypeScriptDiagnosticsByPath,
    setPhpLocalDiagnosticsByPath,
    setFrameworkDiagnosticsByPath,
    setNotices,
    languageServerDiagnosticsByRootRef,
    javaScriptTypeScriptDiagnosticsByRootRef,
    languageServerDiagnosticsCoalescerRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    lastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    contextualDiagnosticsFilterRef,
    phpLocalDiagnosticValidationGenerationRef,
    phpLocalDiagnosticRetryTimersRef,
    phpLocalSyntaxDiagnosticsGateway,
    isExternallyRemovedDocumentPath,
    isLanguageServerSessionCurrentForRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
  } = dependencies;
  const diagnosticsOwnerRevisionRef = useRef<Record<string, number>>({});
  const closedDiagnosticsOwnerKeysRef = useRef<Set<string>>(new Set());
  const visibleLanguageServerDiagnosticsOwnerKeyRef = useRef(
    normalizedWorkspaceRootKey(currentWorkspaceRootRef.current),
  );
  const visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef = useRef(
    normalizedWorkspaceRootKey(currentWorkspaceRootRef.current),
  );

  const diagnosticsOwnerRevision = useCallback((ownerKey: string) => {
    return diagnosticsOwnerRevisionRef.current[ownerKey] ?? 0;
  }, []);

  const isDiagnosticsOwnerRevisionCurrent = useCallback(
    (ownerKey: string, revision: number) => {
      return (
        !closedDiagnosticsOwnerKeysRef.current.has(ownerKey) &&
        diagnosticsOwnerRevision(ownerKey) === revision
      );
    },
    [diagnosticsOwnerRevision],
  );

  const closeDiagnosticsOwner = useCallback((ownerKey: string) => {
    diagnosticsOwnerRevisionRef.current[ownerKey] =
      (diagnosticsOwnerRevisionRef.current[ownerKey] ?? 0) + 1;
    closedDiagnosticsOwnerKeysRef.current.add(ownerKey);
  }, []);

  const resetDiagnosticsOwnerPendingWork = useCallback((ownerKey: string) => {
    if (closedDiagnosticsOwnerKeysRef.current.has(ownerKey)) {
      return;
    }

    diagnosticsOwnerRevisionRef.current[ownerKey] =
      (diagnosticsOwnerRevisionRef.current[ownerKey] ?? 0) + 1;
  }, []);

  const prepareDiagnosticsOwnerForRuntimeStart = useCallback(
    (ownerKey: string) => {
      diagnosticsOwnerRevisionRef.current[ownerKey] =
        (diagnosticsOwnerRevisionRef.current[ownerKey] ?? 0) + 1;
      closedDiagnosticsOwnerKeysRef.current.delete(ownerKey);
    },
    [],
  );

  const restoreDiagnosticsOwner = useCallback((ownerKey: string) => {
    closedDiagnosticsOwnerKeysRef.current.delete(ownerKey);
  }, []);

  const isDiagnosticsOwnerVisible = useCallback(
    (
      ownerKey: string,
      executionRoot: string | null | undefined,
      visibleOwnerKeyRef: MutableRefObject<string>,
    ) => {
      return (
        visibleOwnerKeyRef.current === ownerKey &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, executionRoot)
      );
    },
    [],
  );
  const replaceEslintDiagnostics = useCallback(
    (rootPath: string, notices: WorkbenchNotice[]) => {
      const groupKey = `eslint:${rootPath}`;
      const diagnosticNotices = capDiagnosticNotices(
        notices,
        ESLINT_DIAGNOSTIC_NOTICE_LIMIT,
        (hiddenCount) => {
          const totalCount = ESLINT_DIAGNOSTIC_NOTICE_LIMIT + hiddenCount;
          return createWorkbenchNotice(
            "info",
            "ESLint",
            `Showing ${ESLINT_DIAGNOSTIC_NOTICE_LIMIT} of ${totalCount} ESLint problems — narrow the analysis or fix reported issues.`,
            groupKey,
            undefined,
            "overflow",
          );
        },
      );

      setNotices((current) =>
        capWorkbenchNotices(
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
          GLOBAL_NOTICE_LIMIT,
          (notice) =>
            notice.groupKey?.startsWith("eslint:") === true ||
            isCappableDiagnosticNotice(notice),
        ),
      );
    },
    [],
  );

  const clearEslintDiagnosticsForRoot = useCallback((rootPath: string) => {
    setNotices((current) =>
      replaceWorkbenchNoticeGroup(current, `eslint:${rootPath}`, []),
    );
  }, []);

  const replacePhpstanDiagnostics = useCallback(
    (rootPath: string, notices: WorkbenchNotice[]) => {
      const groupKey = `phpstan:${rootPath}`;
      const diagnosticNotices = capDiagnosticNotices(
        notices,
        PHPSTAN_DIAGNOSTIC_NOTICE_LIMIT,
        (hiddenCount) => {
          const totalCount = PHPSTAN_DIAGNOSTIC_NOTICE_LIMIT + hiddenCount;
          return createWorkbenchNotice(
            "info",
            "PHPStan",
            `Showing ${PHPSTAN_DIAGNOSTIC_NOTICE_LIMIT} of ${totalCount} PHPStan problems — narrow the analysis or fix reported issues.`,
            groupKey,
            undefined,
            "overflow",
          );
        },
      );

      setNotices((current) =>
        capWorkbenchNotices(
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
          GLOBAL_NOTICE_LIMIT,
          (notice) =>
            notice.groupKey?.startsWith("phpstan:") === true ||
            isCappableDiagnosticNotice(notice),
        ),
      );
    },
    [],
  );

  const clearPhpstanDiagnosticsForRoot = useCallback((rootPath: string) => {
    setNotices((current) =>
      replaceWorkbenchNoticeGroup(current, `phpstan:${rootPath}`, []),
    );
  }, []);

  const clearLanguageServerDiagnostics = useCallback(() => {
    setLanguageServerDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) => !notice.groupKey?.startsWith("language-server-diagnostics:"),
      ),
    );
  }, []);

  const resetLanguageServerDiagnosticsContentForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);

      if (rootKey) {
        delete languageServerDiagnosticsByRootRef.current[rootKey];
      }

      if (owner) {
        languageServerDiagnosticsCoalescerRef.current?.dropOwner(owner.ownerKey);
      }

      if (!owner) {
        languageServerDiagnosticsCoalescerRef.current?.dropRoot(rootPath);
      }

      const executionRoot = diagnosticsExecutionRoot(rootPath, owner);
      if (
        !isDiagnosticsOwnerVisible(
          rootKey,
          executionRoot,
          visibleLanguageServerDiagnosticsOwnerKeyRef,
        )
      ) {
        return;
      }

      clearLanguageServerDiagnostics();
    },
    [clearLanguageServerDiagnostics, isDiagnosticsOwnerVisible],
  );

  const restoreLanguageServerDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      restoreDiagnosticsOwner(diagnosticsOwnerLifecycleKey("php", rootKey));
      visibleLanguageServerDiagnosticsOwnerKeyRef.current = rootKey;
      const cachedDiagnostics = rootKey
        ? languageServerDiagnosticsByRootRef.current[rootKey] ?? {}
        : {};
      setLanguageServerDiagnosticsByPath({ ...cachedDiagnostics });
    },
    [restoreDiagnosticsOwner],
  );

  const updateLanguageServerDiagnosticsForRoot = useCallback(
    (
      rootPath: string,
      diagnosticPath: string,
      diagnostics: LanguageServerDiagnostic[],
      owner?: WorkspaceRuntimeOwner,
      ownerRevision?: number,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);

      if (
        ownerRevision !== undefined &&
        !isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)
      ) {
        return;
      }

      const currentByPath =
        languageServerDiagnosticsByRootRef.current[rootKey] ?? {};
      const nextByPath = {
        ...currentByPath,
        [diagnosticPath]: diagnostics,
      };

      languageServerDiagnosticsByRootRef.current[rootKey] = nextByPath;

      if (
        isDiagnosticsOwnerVisible(
          rootKey,
          rootPath,
          visibleLanguageServerDiagnosticsOwnerKeyRef,
        )
      ) {
        setLanguageServerDiagnosticsByPath(nextByPath);
      }
    },
    [isDiagnosticsOwnerRevisionCurrent, isDiagnosticsOwnerVisible],
  );

  const clearLanguageServerDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);

      if (owner) {
        closeDiagnosticsOwner(diagnosticsOwnerLifecycleKey("php", rootKey));
      }

      resetLanguageServerDiagnosticsContentForRoot(rootPath, owner);
    },
    [closeDiagnosticsOwner, resetLanguageServerDiagnosticsContentForRoot],
  );

  const resetLanguageServerDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);

      resetDiagnosticsOwnerPendingWork(lifecycleKey);
      resetLanguageServerDiagnosticsContentForRoot(rootPath, owner);
    },
    [
      resetDiagnosticsOwnerPendingWork,
      resetLanguageServerDiagnosticsContentForRoot,
    ],
  );

  const prepareLanguageServerDiagnosticsForRuntimeStart = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);

      prepareDiagnosticsOwnerForRuntimeStart(lifecycleKey);
      resetLanguageServerDiagnosticsContentForRoot(rootPath, owner);
    },
    [
      prepareDiagnosticsOwnerForRuntimeStart,
      resetLanguageServerDiagnosticsContentForRoot,
    ],
  );

  const clearJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(() => {
    setJavaScriptTypeScriptDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) =>
          !notice.groupKey?.startsWith("javascript-typescript-diagnostics:"),
      ),
    );
  }, []);

  const resetJavaScriptTypeScriptDiagnosticsContentForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);

      if (rootKey) {
        delete javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey];
      }

      if (owner) {
        javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropOwner(
          owner.ownerKey,
        );
      }

      if (!owner) {
        javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(rootPath);
      }

      const executionRoot = diagnosticsExecutionRoot(rootPath, owner);
      if (
        !isDiagnosticsOwnerVisible(
          rootKey,
          executionRoot,
          visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
        )
      ) {
        return;
      }

      clearJavaScriptTypeScriptLanguageServerDiagnostics();
    },
    [
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      isDiagnosticsOwnerVisible,
    ],
  );

  const clearPhpLocalDiagnostics = useCallback(() => {
    setPhpLocalDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) =>
          !notice.groupKey?.startsWith(PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX),
      ),
    );
  }, []);

  const restoreJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      restoreDiagnosticsOwner(
        diagnosticsOwnerLifecycleKey("typescript", rootKey),
      );
      visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef.current = rootKey;
      const cachedDiagnostics = rootKey
        ? javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {}
        : {};
      setJavaScriptTypeScriptDiagnosticsByPath({ ...cachedDiagnostics });
    },
    [restoreDiagnosticsOwner],
  );

  const updateJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string,
      diagnosticPath: string,
      diagnostics: LanguageServerDiagnostic[],
      owner?: WorkspaceRuntimeOwner,
      ownerRevision?: number,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);

      if (
        ownerRevision !== undefined &&
        !isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)
      ) {
        return;
      }

      const currentByPath =
        javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {};
      const nextByPath = { ...currentByPath };

      if (diagnostics.length > 0) {
        nextByPath[diagnosticPath] = diagnostics;
      } else {
        delete nextByPath[diagnosticPath];
      }

      if (Object.keys(nextByPath).length > 0) {
        javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] = nextByPath;
      } else {
        delete javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey];
      }

      if (
        isDiagnosticsOwnerVisible(
          rootKey,
          rootPath,
          visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
        )
      ) {
        setJavaScriptTypeScriptDiagnosticsByPath(nextByPath);
      }
    },
    [isDiagnosticsOwnerRevisionCurrent, isDiagnosticsOwnerVisible],
  );

  const clearJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);

      if (owner) {
        closeDiagnosticsOwner(
          diagnosticsOwnerLifecycleKey("typescript", rootKey),
        );
      }

      resetJavaScriptTypeScriptDiagnosticsContentForRoot(rootPath, owner);
    },
    [
      closeDiagnosticsOwner,
      resetJavaScriptTypeScriptDiagnosticsContentForRoot,
    ],
  );

  const resetJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);

      resetDiagnosticsOwnerPendingWork(lifecycleKey);
      resetJavaScriptTypeScriptDiagnosticsContentForRoot(rootPath, owner);
    },
    [
      resetDiagnosticsOwnerPendingWork,
      resetJavaScriptTypeScriptDiagnosticsContentForRoot,
    ],
  );

  const prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart = useCallback(
    (
      rootPath: string | null | undefined,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);

      prepareDiagnosticsOwnerForRuntimeStart(lifecycleKey);
      resetJavaScriptTypeScriptDiagnosticsContentForRoot(rootPath, owner);
    },
    [
      prepareDiagnosticsOwnerForRuntimeStart,
      resetJavaScriptTypeScriptDiagnosticsContentForRoot,
    ],
  );

  const clearPhpLocalDiagnosticsForPath = useCallback((diagnosticPath: string) => {
    setPhpLocalDiagnosticsByPath((current) => {
      if (!(diagnosticPath in current)) {
        return current;
      }

      const next = { ...current };
      delete next[diagnosticPath];
      return next;
    });

    const phpLocalGroupKey = phpLocalDiagnosticNoticeGroup(diagnosticPath);
    setNotices((current) =>
      current.filter((notice) => notice.groupKey !== phpLocalGroupKey),
    );
  }, []);

  const clearLanguageServerDiagnosticsForPath = useCallback(
    (
      rootPath: string | null | undefined,
      diagnosticPath: string,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const executionRoot = diagnosticsExecutionRoot(rootPath, owner);
      const isPhpOwnerVisible = isDiagnosticsOwnerVisible(
        rootKey,
        executionRoot,
        visibleLanguageServerDiagnosticsOwnerKeyRef,
      );
      const isJavaScriptTypeScriptOwnerVisible = isDiagnosticsOwnerVisible(
        rootKey,
        executionRoot,
        visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
      );

      const removePathFromRootCache = (
        cache: Record<string, Record<string, LanguageServerDiagnostic[]>>,
      ) => {
        const currentByPath = rootKey ? cache[rootKey] : undefined;

        if (!currentByPath || !(diagnosticPath in currentByPath)) {
          return false;
        }

        const nextByPath = { ...currentByPath };
        delete nextByPath[diagnosticPath];

        if (Object.keys(nextByPath).length === 0) {
          delete cache[rootKey];
          return true;
        }

        cache[rootKey] = nextByPath;
        return true;
      };

      const phpChanged = removePathFromRootCache(
        languageServerDiagnosticsByRootRef.current,
      );
      const javaScriptTypeScriptChanged = removePathFromRootCache(
        javaScriptTypeScriptDiagnosticsByRootRef.current,
      );

      if (!isPhpOwnerVisible && !isJavaScriptTypeScriptOwnerVisible) {
        return;
      }

      if (phpChanged && isPhpOwnerVisible) {
        setLanguageServerDiagnosticsByPath((current) => {
          if (!(diagnosticPath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        });
      }

      if (
        javaScriptTypeScriptChanged &&
        isJavaScriptTypeScriptOwnerVisible
      ) {
        setJavaScriptTypeScriptDiagnosticsByPath((current) => {
          if (!(diagnosticPath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        });
      }

      if (isPhpOwnerVisible) {
        setFrameworkDiagnosticsByPath((current) => {
          if (!(diagnosticPath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        });
        clearPhpLocalDiagnosticsForPath(diagnosticPath);
      }

      const uri = fileUriFromPath(diagnosticPath);
      const phpGroupKey = languageServerDiagnosticNoticeGroup(uri);
      const javaScriptTypeScriptGroupKey =
        javaScriptTypeScriptDiagnosticNoticeGroup(uri);

      setNotices((current) =>
        current.filter(
          (notice) =>
            (!isPhpOwnerVisible || notice.groupKey !== phpGroupKey) &&
            (!isJavaScriptTypeScriptOwnerVisible ||
              notice.groupKey !== javaScriptTypeScriptGroupKey),
        ),
      );
    },
    [clearPhpLocalDiagnosticsForPath, isDiagnosticsOwnerVisible],
  );

  const updateLocalPhpDiagnostics = useCallback(
    (diagnosticPath: string, diagnostics: LanguageServerDiagnostic[]) => {
      // Local PHP diagnostics are emitted only by the mounted EditorSurface for
      // the active document. Do not re-guard by workspaceRelativePath here:
      // reopened projects can hand the editor a canonicalized model path while
      // the persisted workspace root is still the user-selected alias, and that
      // would drop visible local markers from Problems/status.
      if (isExternallyRemovedDocumentPath(diagnosticPath)) {
        clearLanguageServerDiagnosticsForPath(
          currentWorkspaceRootRef.current,
          diagnosticPath,
        );
        return;
      }

      setPhpLocalDiagnosticsByPath((current) => {
        const hasCurrent = diagnosticPath in current;

        if (diagnostics.length === 0) {
          if (!hasCurrent) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        }

        return {
          ...current,
          [diagnosticPath]: diagnostics,
        };
      });

      const uri = fileUriFromPath(diagnosticPath);
      const groupKey = phpLocalDiagnosticNoticeGroup(diagnosticPath);
      const diagnosticNotices = capDiagnosticNotices(
        diagnostics.map((diagnostic) =>
          createWorkbenchNotice(
            languageServerDiagnosticNoticeSeverity(diagnostic.severity),
            diagnostic.source || "PHP",
            languageServerDiagnosticNoticeMessage(diagnostic, uri),
            groupKey,
            diagnosticNoticeNavigationTarget(uri, diagnostic),
          ),
        ),
        DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
        (hiddenCount) =>
          buildDiagnosticOverflowNotice("PHP", groupKey, hiddenCount),
      );

      setNotices((current) =>
        capWorkbenchNotices(
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
          GLOBAL_NOTICE_LIMIT,
          isCappableDiagnosticNotice,
        ),
      );
    },
    [clearLanguageServerDiagnosticsForPath, isExternallyRemovedDocumentPath],
  );

  useEffect(() => {
    phpLocalDiagnosticRetryTimersRef.current.forEach((timer) =>
      clearTimeout(timer),
    );
    phpLocalDiagnosticRetryTimersRef.current = [];

    const document = activeDocument;
    const generation = phpLocalDiagnosticValidationGenerationRef.current + 1;
    phpLocalDiagnosticValidationGenerationRef.current = generation;

    if (!document || document.language !== "php") {
      if (document?.path) {
        updateLocalPhpDiagnostics(document.path, []);
      }

      return;
    }

    let disposed = false;
    let applied = false;
    const validateActivePhpDocument = () => {
      if (disposed || applied) {
        return;
      }

      const currentDocument = activeDocumentRef.current;

      if (
        phpLocalDiagnosticValidationGenerationRef.current !== generation ||
        currentDocument?.path !== document.path ||
        currentDocument.content !== document.content ||
        currentDocument.language !== "php"
      ) {
        return;
      }

      updateLocalPhpDiagnostics(
        document.path,
        localPhpDiagnosticsFromSource(currentDocument.content, []),
      );

      void (async () => {
        const latestBeforeRead = activeDocumentRef.current;

        if (
          disposed ||
          applied ||
          phpLocalDiagnosticValidationGenerationRef.current !== generation ||
          latestBeforeRead?.path !== document.path ||
          latestBeforeRead.language !== "php"
        ) {
          return;
        }

        const source = latestBeforeRead.content;

        const latestBeforeValidate = activeDocumentRef.current;

        if (
          disposed ||
          applied ||
          phpLocalDiagnosticValidationGenerationRef.current !== generation ||
          latestBeforeValidate?.path !== document.path ||
          latestBeforeValidate.language !== "php"
        ) {
          return;
        }

        return {
          source,
          syntaxDiagnostics: await phpLocalSyntaxDiagnosticsGateway.validate(source),
        };
      })()
        .then((syntaxDiagnostics) => {
          if (!syntaxDiagnostics) {
            return;
          }

          const latestDocument = activeDocumentRef.current;

          if (
            disposed ||
            applied ||
            phpLocalDiagnosticValidationGenerationRef.current !== generation ||
            latestDocument?.path !== document.path ||
            latestDocument.language !== "php"
          ) {
            return;
          }

          applied = true;
          updateLocalPhpDiagnostics(
            document.path,
            localPhpDiagnosticsFromSource(
              syntaxDiagnostics.source,
              syntaxDiagnostics.syntaxDiagnostics,
            ),
          );
        })
        .catch(() => {
          // Local syntax parsing is best-effort. Startup races are covered by the
          // scheduled retries below; a failed parse must never surface an error
          // toast or block PHPactor diagnostics.
          if (
            phpLocalDiagnosticValidationGenerationRef.current === generation &&
            activeDocumentRef.current?.path === document.path
          ) {
            applied = false;
          }
        });
    };

    validateActivePhpDocument();
    phpLocalDiagnosticRetryTimersRef.current = [120, 360].map((delay) =>
      setTimeout(validateActivePhpDocument, delay),
    );

    return () => {
      disposed = true;
      phpLocalDiagnosticRetryTimersRef.current.forEach((timer) =>
        clearTimeout(timer),
      );
      phpLocalDiagnosticRetryTimersRef.current = [];
    };
  }, [
    activeDocument?.content,
    activeDocument?.language,
    activeDocument?.path,
    updateLocalPhpDiagnostics,
  ]);

  const refreshLocalPhpDiagnosticsForContent = useCallback(
    (path: string, content: string, language: string) => {
      if (language !== "php") {
        updateLocalPhpDiagnostics(path, []);
        return;
      }

      updateLocalPhpDiagnostics(path, localPhpDiagnosticsFromSource(content, []));

      void phpLocalSyntaxDiagnosticsGateway
        .validate(content)
        .then((syntaxDiagnostics) => {
          const currentDocument = documentsRef.current[path];

          if (
            activeDocumentRef.current?.path !== path ||
            !currentDocument ||
            currentDocument.content !== content ||
            currentDocument.language !== "php"
          ) {
            return;
          }

          updateLocalPhpDiagnostics(
            path,
            localPhpDiagnosticsFromSource(content, syntaxDiagnostics),
          );
        })
        .catch(() => {
          // Local PHP diagnostics are best-effort; PHPactor diagnostics continue
          // to own language-server failures.
        });
    },
    [updateLocalPhpDiagnostics],
  );

  const applyLanguageServerDiagnostics = useCallback(
    (
      incomingEvent: LanguageServerDiagnosticEvent,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const event = diagnosticsEventForOwner(incomingEvent, owner);

      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;
      const ownerKey = diagnosticsOwnerKey(diagnosticsRootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", ownerKey);
      const ownerRevision = diagnosticsOwnerRevision(lifecycleKey);

      if (owner && closedDiagnosticsOwnerKeysRef.current.has(lifecycleKey)) {
        return;
      }

      if (
        !workspaceRootKeysEqual(
          diagnosticsRootPath,
          currentWorkspaceRootRef.current,
        ) &&
        !appSettingsRef.current.workspaceTabs.some((tabPath) =>
          workspaceRootKeysEqual(tabPath, diagnosticsRootPath),
        )
      ) {
        return;
      }

      const runtimeStatus = owner
        ? cachedLanguageServerRuntimeStatusForOwner(
            languageServerRuntimeStatusByRootRef.current,
            owner,
          )
        : cachedLanguageServerRuntimeStatusForRoot(
            languageServerRuntimeStatusByRootRef.current,
            diagnosticsRootPath,
          );
      const currentSessionId =
        runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticUriSyncKey = diagnosticsUriVersionKey(
        diagnosticsRootPath,
        event.uri,
        owner,
      );
      const lastAppliedDiagnosticVersion =
        lastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey];

      if (
        !shouldApplyLanguageServerDiagnostics(
          event,
          currentSessionId,
          lastAppliedDiagnosticVersion,
          diagnosticsRootPath,
        )
      ) {
        return;
      }

      const groupKey = languageServerDiagnosticNoticeGroup(event.uri);
      const diagnosticPath = pathFromLanguageServerUri(event.uri);
      const isActiveRoot = isDiagnosticsOwnerVisible(
        ownerKey,
        diagnosticsRootPath,
        visibleLanguageServerDiagnosticsOwnerKeyRef,
      );

      if (diagnosticPath && isExternallyRemovedDocumentPath(diagnosticPath)) {
        clearLanguageServerDiagnosticsForPath(
          diagnosticsRootPath,
          diagnosticPath,
          owner,
        );
        return;
      }

      void (async () => {
        const diagnostics =
          diagnosticPath && isActiveRoot
            ? await contextualDiagnosticsFilterRef.current(
                diagnosticPath,
                event.diagnostics,
              )
            : event.diagnostics;
        const latestAppliedDiagnosticVersion =
          lastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey];

        if (!isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)) {
          return;
        }

        if (
          !shouldApplyLanguageServerDiagnostics(
            event,
            currentSessionId,
            latestAppliedDiagnosticVersion,
            diagnosticsRootPath,
          )
        ) {
          return;
        }

        const isLatestActiveRoot = isDiagnosticsOwnerVisible(
          ownerKey,
          diagnosticsRootPath,
          visibleLanguageServerDiagnosticsOwnerKeyRef,
        );
        if (
          !isLatestActiveRoot &&
          !appSettingsRef.current.workspaceTabs.some((tabPath) =>
            workspaceRootKeysEqual(tabPath, diagnosticsRootPath),
          )
        ) {
          return;
        }

        if (diagnosticPath && isExternallyRemovedDocumentPath(diagnosticPath)) {
          clearLanguageServerDiagnosticsForPath(
            diagnosticsRootPath,
            diagnosticPath,
            owner,
          );
          return;
        }

        if (typeof event.version === "number") {
          lastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey] =
            event.version;
        }

        const diagnosticNotices = capDiagnosticNotices(
          diagnostics.map((diagnostic) =>
            createWorkbenchNotice(
              languageServerDiagnosticNoticeSeverity(diagnostic.severity),
              diagnostic.source || "Language Server",
              languageServerDiagnosticNoticeMessage(diagnostic, event.uri),
              groupKey,
              diagnosticNoticeNavigationTarget(event.uri, diagnostic),
            ),
          ),
          DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
          (hiddenCount) =>
            buildDiagnosticOverflowNotice(
              "Language Server",
              groupKey,
              hiddenCount,
            ),
        );

        if (isLatestActiveRoot) {
          setNotices((current) =>
            capWorkbenchNotices(
              replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
              GLOBAL_NOTICE_LIMIT,
              isCappableDiagnosticNotice,
            ),
          );
        }

        if (diagnosticPath) {
          updateLanguageServerDiagnosticsForRoot(
            diagnosticsRootPath,
            diagnosticPath,
            diagnostics,
            owner,
            ownerRevision,
          );
        }
      })().catch((error) => {
        if (!isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)) {
          return;
        }

        if (
          !isDiagnosticsOwnerVisible(
            ownerKey,
            diagnosticsRootPath,
            visibleLanguageServerDiagnosticsOwnerKeyRef,
          )
        ) {
          return;
        }

        if (
          currentSessionId !== null &&
          !isLanguageServerSessionCurrentForRoot(
            diagnosticsRootPath,
            currentSessionId,
          )
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(
          diagnosticsRootPath,
          error,
        );
      });
    },
    [
      clearLanguageServerDiagnosticsForPath,
      diagnosticsOwnerRevision,
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      isLanguageServerSessionCurrentForRoot,
      isExternallyRemovedDocumentPath,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      updateLanguageServerDiagnosticsForRoot,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(
    (
      incomingEvent: LanguageServerDiagnosticEvent,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const event = diagnosticsEventForOwner(incomingEvent, owner);

      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;
      const ownerKey = diagnosticsOwnerKey(diagnosticsRootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", ownerKey);
      const ownerRevision = diagnosticsOwnerRevision(lifecycleKey);

      if (owner && closedDiagnosticsOwnerKeysRef.current.has(lifecycleKey)) {
        return;
      }

      if (
        !workspaceRootKeysEqual(diagnosticsRootPath, currentWorkspaceRootRef.current) &&
        !appSettingsRef.current.workspaceTabs.some((tabPath) =>
          workspaceRootKeysEqual(tabPath, diagnosticsRootPath),
        )
      ) {
        return;
      }

      const runtimeStatus = owner
        ? cachedLanguageServerRuntimeStatusForOwner(
            javaScriptTypeScriptRuntimeStatusByRootRef.current,
            owner,
          )
        : cachedLanguageServerRuntimeStatusForRoot(
            javaScriptTypeScriptRuntimeStatusByRootRef.current,
            diagnosticsRootPath,
          );
      const currentSessionId =
        runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticUriSyncKey = diagnosticsUriVersionKey(
        diagnosticsRootPath,
        event.uri,
        owner,
      );
      const lastAppliedDiagnosticVersion =
        javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
          diagnosticUriSyncKey
        ];

      if (
        !shouldApplyLanguageServerDiagnostics(
          event,
          currentSessionId,
          lastAppliedDiagnosticVersion,
          diagnosticsRootPath,
        )
      ) {
        return;
      }

      const groupKey = javaScriptTypeScriptDiagnosticNoticeGroup(event.uri);
      const diagnosticPath = pathFromLanguageServerUri(event.uri);
      const isActiveRoot = isDiagnosticsOwnerVisible(
        ownerKey,
        diagnosticsRootPath,
        visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
      );

      const diagnosticsWorkspaceSettings = workspaceSettingsForRoot(
        diagnosticsRootPath,
      );
      if (!diagnosticsWorkspaceSettings) {
        return;
      }

      if (typeof event.version === "number") {
        javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
          diagnosticUriSyncKey
        ] = event.version;
      }

      if (!diagnosticsWorkspaceSettings.javaScriptTypeScriptValidation) {
        if (isActiveRoot) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, groupKey, []),
          );
        }

        if (diagnosticPath) {
          updateJavaScriptTypeScriptDiagnosticsForRoot(
            diagnosticsRootPath,
            diagnosticPath,
            [],
            owner,
            ownerRevision,
          );
        }

        return;
      }

      const diagnosticNotices = capDiagnosticNotices(
        event.diagnostics.map((diagnostic) =>
          createWorkbenchNotice(
            languageServerDiagnosticNoticeSeverity(diagnostic.severity),
            diagnostic.source || "TypeScript",
            languageServerDiagnosticNoticeMessage(diagnostic, event.uri),
            groupKey,
            diagnosticNoticeNavigationTarget(event.uri, diagnostic),
          ),
        ),
        DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
        (hiddenCount) =>
          buildDiagnosticOverflowNotice("TypeScript", groupKey, hiddenCount),
      );

      if (isActiveRoot) {
        setNotices((current) =>
          capWorkbenchNotices(
            replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
            GLOBAL_NOTICE_LIMIT,
            isCappableDiagnosticNotice,
          ),
        );
      }

      if (diagnosticPath) {
        updateJavaScriptTypeScriptDiagnosticsForRoot(
          diagnosticsRootPath,
          diagnosticPath,
          event.diagnostics,
          owner,
          ownerRevision,
        );
      }
    },
    [
      diagnosticsOwnerRevision,
      isDiagnosticsOwnerVisible,
      updateJavaScriptTypeScriptDiagnosticsForRoot,
      workspaceSettingsForRoot,
    ],
  );

  return {
    replaceEslintDiagnostics,
    clearEslintDiagnosticsForRoot,
    replacePhpstanDiagnostics,
    clearPhpstanDiagnosticsForRoot,
    clearLanguageServerDiagnostics,
    restoreLanguageServerDiagnosticsForRoot,
    resetLanguageServerDiagnosticsForRoot,
    prepareLanguageServerDiagnosticsForRuntimeStart,
    clearLanguageServerDiagnosticsForRoot,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    restoreJavaScriptTypeScriptDiagnosticsForRoot,
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    updateLocalPhpDiagnostics,
    refreshLocalPhpDiagnosticsForContent,
    applyLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
  };
}
