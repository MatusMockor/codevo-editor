import {
  useCallback,
  useEffect,
  useMemo,
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
  phpLocalDiagnosticFileIdentity,
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
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { pathFromLanguageServerUri } from "../domain/languageServerFeatures";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  cachedLanguageServerRuntimeStatusForRoot,
} from "../domain/languageServerRuntimeStatusCache";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceSettingsForRoot } from "./workspaceSettingsForRoot";
import { applyBoundedDiagnosticsCacheBatch } from "../domain/boundedDiagnosticsCache";
import {
  boundedDiagnosticsNoticesForCache,
  diagnosticNoticesForRetainedPrefix,
  diagnosticsRetentionReceiptOwnerPrefix,
  replaceDiagnosticsRetentionReceipt,
} from "./diagnosticsRetentionNotices";
import { DiagnosticsOwnerLifecycleStore } from "./diagnosticsOwnerLifecycleStore";
import {
  commitDiagnosticsOwnerCacheBatch,
  removeDiagnosticsOwnerLedgerPath,
  type DiagnosticsOwnerBatchMap,
} from "./diagnosticsOwnerCacheCoordinator";
import {
  diagnosticsEventForOwner,
  diagnosticsExecutionRoot,
  diagnosticsOwnerKey,
  diagnosticsOwnerLifecycleKey,
  diagnosticsUriVersionKey,
} from "./diagnosticsOwnerIdentity";
import { useDiagnosticsCapacityNotices } from "./useDiagnosticsCapacityNotices";
import { createDiagnosticsChannelLifecycleCoordinator } from "./diagnosticsChannelLifecycleCoordinator";

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
    (path: string, diagnostics: LanguageServerDiagnostic[]) => Promise<LanguageServerDiagnostic[]>
  >;

  // Local PHP diagnostics validation refs (shell-owned).
  phpLocalDiagnosticValidationGenerationRef: MutableRefObject<number>;
  phpLocalDiagnosticRetryTimersRef: MutableRefObject<ReturnType<typeof setTimeout>[]>;

  // Local PHP syntax diagnostics gateway (external boundary).
  phpLocalSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;

  // Shared shell guards / reporters.
  isExternallyRemovedDocumentPath: (path: string) => boolean;
  isLanguageServerSessionCurrentForRoot: (rootPath: string, sessionId: number) => boolean;
  reportLanguageServerErrorForActiveWorkspaceRoot: (rootPath: string, error: unknown) => void;
  onPhpLanguageServerDiagnosticsCommitted?: (rootPath: string, ownerKey: string) => void;
}

export interface Diagnostics {
  replaceEslintDiagnostics: (rootPath: string, notices: WorkbenchNotice[]) => void;
  clearEslintDiagnosticsForRoot: (rootPath: string) => void;
  replacePhpstanDiagnostics: (rootPath: string, notices: WorkbenchNotice[]) => void;
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
  refreshLocalPhpDiagnosticsForContent: (path: string, content: string, language: string) => void;
  applyLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  applyLanguageServerDiagnosticsBatch: (events: readonly DiagnosticsOwnedEvent[]) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch: (
    events: readonly DiagnosticsOwnedEvent[],
  ) => void;
}

export interface DiagnosticsOwnedEvent {
  readonly event: LanguageServerDiagnosticEvent;
  readonly owner?: WorkspaceRuntimeOwner;
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
export function useDiagnostics(dependencies: DiagnosticsDependencies): Diagnostics {
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
    onPhpLanguageServerDiagnosticsCommitted,
  } = dependencies;
  const diagnosticsLifecycleStoreRef = useRef(new DiagnosticsOwnerLifecycleStore());
  const {
    clearUriCapacity: clearDiagnosticsUriCapacity,
    reportOwnerCapacity: reportDiagnosticsOwnerCapacity,
    reportUriCapacity: reportDiagnosticsUriCapacity,
  } = useDiagnosticsCapacityNotices(setNotices);
  const visibleLanguageServerDiagnosticsOwnerKeyRef = useRef(
    normalizedWorkspaceRootKey(currentWorkspaceRootRef.current),
  );
  const visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef = useRef(
    normalizedWorkspaceRootKey(currentWorkspaceRootRef.current),
  );
  const languageServerDiagnosticsBatchRef = useRef<DiagnosticsOwnerBatchMap | null>(null);
  const languageServerDiagnosticsBatchPendingRef = useRef<Promise<unknown>[] | null>(null);
  const javaScriptTypeScriptDiagnosticsBatchRef = useRef<DiagnosticsOwnerBatchMap | null>(null);

  const diagnosticsOwnerRevision = useCallback((ownerKey: string) => {
    return diagnosticsLifecycleStoreRef.current.revision(ownerKey);
  }, []);

  const captureDiagnosticsOwnerRevision = useCallback((ownerKey: string) => {
    return diagnosticsLifecycleStoreRef.current.capture(ownerKey);
  }, []);

  const isDiagnosticsOwnerRevisionCurrent = useCallback((ownerKey: string, revision: number) => {
    return diagnosticsLifecycleStoreRef.current.isCurrent(ownerKey, revision);
  }, []);

  const restoreDiagnosticsOwner = useCallback(
    (ownerKey: string) => diagnosticsLifecycleStoreRef.current.restore(ownerKey),
    [],
  );

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
    [currentWorkspaceRootRef],
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
            notice.groupKey?.startsWith("eslint:") === true || isCappableDiagnosticNotice(notice),
        ),
      );
    },
    [setNotices],
  );

  const clearEslintDiagnosticsForRoot = useCallback(
    (rootPath: string) => {
      setNotices((current) => replaceWorkbenchNoticeGroup(current, `eslint:${rootPath}`, []));
    },
    [setNotices],
  );

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
            notice.groupKey?.startsWith("phpstan:") === true || isCappableDiagnosticNotice(notice),
        ),
      );
    },
    [setNotices],
  );

  const clearPhpstanDiagnosticsForRoot = useCallback(
    (rootPath: string) => {
      setNotices((current) => replaceWorkbenchNoticeGroup(current, `phpstan:${rootPath}`, []));
    },
    [setNotices],
  );

  const clearLanguageServerDiagnostics = useCallback(() => {
    const receiptPrefix = diagnosticsRetentionReceiptOwnerPrefix(
      "php",
      visibleLanguageServerDiagnosticsOwnerKeyRef.current,
    );
    setLanguageServerDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) =>
          !notice.groupKey?.startsWith("language-server-diagnostics:") &&
          !notice.groupKey?.startsWith(receiptPrefix),
      ),
    );
  }, [setLanguageServerDiagnosticsByPath, setNotices]);

  const phpDiagnosticsLifecycle = useMemo(
    () =>
      createDiagnosticsChannelLifecycleCoordinator({
        cacheByOwnerRef: languageServerDiagnosticsByRootRef,
        clearUriCapacity: clearDiagnosticsUriCapacity,
        clearVisibleDiagnostics: clearLanguageServerDiagnostics,
        coalescerRef: languageServerDiagnosticsCoalescerRef,
        isOwnerVisible: isDiagnosticsOwnerVisible,
        kind: "php",
        lifecycleStore: diagnosticsLifecycleStoreRef.current,
        reportOwnerCapacity: reportDiagnosticsOwnerCapacity,
        visibleOwnerKeyRef: visibleLanguageServerDiagnosticsOwnerKeyRef,
      }),
    [
      clearLanguageServerDiagnostics,
      clearDiagnosticsUriCapacity,
      isDiagnosticsOwnerVisible,
      languageServerDiagnosticsByRootRef,
      languageServerDiagnosticsCoalescerRef,
      reportDiagnosticsOwnerCapacity,
    ],
  );
  const restoreLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);
      const ownerRestored = restoreDiagnosticsOwner(lifecycleKey);
      reportDiagnosticsOwnerCapacity("php", rootKey, ownerRestored);
      visibleLanguageServerDiagnosticsOwnerKeyRef.current = rootKey;
      const cachedDiagnostics = rootKey
        ? (languageServerDiagnosticsByRootRef.current[rootKey] ?? {})
        : {};
      setLanguageServerDiagnosticsByPath({ ...cachedDiagnostics });
      const receiptPrefix = diagnosticsRetentionReceiptOwnerPrefix("php", rootKey);
      const ledger = diagnosticsLifecycleStoreRef.current.ledger(lifecycleKey);
      const ownerRevision = diagnosticsOwnerRevision(lifecycleKey);
      const runtimeStatus = owner
        ? cachedLanguageServerRuntimeStatusForOwner(
            languageServerRuntimeStatusByRootRef.current,
            owner,
          )
        : cachedLanguageServerRuntimeStatusForRoot(
            languageServerRuntimeStatusByRootRef.current,
            rootPath ?? null,
          );
      setNotices((current) => {
        const withoutReceipt = current.filter(
          (notice) => !notice.groupKey?.startsWith(receiptPrefix),
        );
        if (
          !ownerRestored ||
          ownerRevision === null ||
          !ledger ||
          runtimeStatus?.kind !== "running"
        ) {
          return withoutReceipt;
        }
        return replaceDiagnosticsRetentionReceipt(withoutReceipt, {
          kind: "php",
          ownerKey: rootKey,
          ownerRevision,
          publishedCount: ledger.publishedCount,
          publishedCountKind: ledger.untrackedPublishedCount > 0 ? "upperBound" : "exact",
          retainedCount: Object.values(cachedDiagnostics).reduce(
            (count, diagnostics) => count + diagnostics.length,
            0,
          ),
          sessionId: runtimeStatus.sessionId,
        });
      });
    },
    [
      languageServerDiagnosticsByRootRef,
      languageServerRuntimeStatusByRootRef,
      diagnosticsOwnerRevision,
      reportDiagnosticsOwnerCapacity,
      restoreDiagnosticsOwner,
      setLanguageServerDiagnosticsByPath,
      setNotices,
    ],
  );

  const updateLanguageServerDiagnosticsBatchForRoot = useCallback(
    (
      rootPath: string,
      updates: readonly {
        readonly diagnosticPath: string;
        readonly diagnostics: readonly LanguageServerDiagnostic[];
        readonly publishedCount: number;
      }[],
      owner?: WorkspaceRuntimeOwner,
      ownerRevision?: number,
      sessionId?: number,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);

      if (
        ownerRevision !== undefined &&
        !isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)
      ) {
        return;
      }

      const batch = languageServerDiagnosticsBatchRef.current;
      if (batch && ownerRevision !== undefined && sessionId !== undefined) {
        const staged = batch.get(rootKey) ?? {
          ownerRevision,
          rootPath,
          sessionId,
          updates: [],
        };
        staged.updates.push(...updates);
        batch.set(rootKey, staged);
        const projected = applyBoundedDiagnosticsCacheBatch(
          {},
          updates.map((update) => ({
            diagnostics: update.diagnostics,
            path: update.diagnosticPath,
            publishedCount: update.publishedCount,
          })),
        );
        return { ...projected.byPath };
      }

      const result = commitDiagnosticsOwnerCacheBatch({
        cacheByOwner: languageServerDiagnosticsByRootRef.current,
        lifecycleKey,
        lifecycleStore: diagnosticsLifecycleStoreRef.current,
        ownerKey: rootKey,
        updates: updates.map((update) => ({
          diagnostics: update.diagnostics,
          path: update.diagnosticPath,
          publishedCount: update.publishedCount,
        })),
      });
      if (!result) {
        reportDiagnosticsOwnerCapacity("php", rootKey, false);
        return;
      }
      reportDiagnosticsOwnerCapacity("php", rootKey, true);
      const nextByPath = { ...result.byPath };

      if (
        isDiagnosticsOwnerVisible(rootKey, rootPath, visibleLanguageServerDiagnosticsOwnerKeyRef)
      ) {
        setLanguageServerDiagnosticsByPath(nextByPath);
      }

      return nextByPath;
    },
    [
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      languageServerDiagnosticsByRootRef,
      reportDiagnosticsOwnerCapacity,
      setLanguageServerDiagnosticsByPath,
    ],
  );

  const clearLanguageServerDiagnosticsForRoot = phpDiagnosticsLifecycle.clear;
  const resetLanguageServerDiagnosticsForRoot = phpDiagnosticsLifecycle.reset;
  const prepareLanguageServerDiagnosticsForRuntimeStart = phpDiagnosticsLifecycle.prepare;

  const clearJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(() => {
    const receiptPrefix = diagnosticsRetentionReceiptOwnerPrefix(
      "typescript",
      visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef.current,
    );
    setJavaScriptTypeScriptDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) =>
          !notice.groupKey?.startsWith("javascript-typescript-diagnostics:") &&
          !notice.groupKey?.startsWith(receiptPrefix),
      ),
    );
  }, [setJavaScriptTypeScriptDiagnosticsByPath, setNotices]);

  const javaScriptTypeScriptDiagnosticsLifecycle = useMemo(
    () =>
      createDiagnosticsChannelLifecycleCoordinator({
        cacheByOwnerRef: javaScriptTypeScriptDiagnosticsByRootRef,
        clearUriCapacity: clearDiagnosticsUriCapacity,
        clearVisibleDiagnostics: clearJavaScriptTypeScriptLanguageServerDiagnostics,
        coalescerRef: javaScriptTypeScriptDiagnosticsCoalescerRef,
        isOwnerVisible: isDiagnosticsOwnerVisible,
        kind: "typescript",
        lifecycleStore: diagnosticsLifecycleStoreRef.current,
        reportOwnerCapacity: reportDiagnosticsOwnerCapacity,
        visibleOwnerKeyRef: visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
      }),
    [
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearDiagnosticsUriCapacity,
      isDiagnosticsOwnerVisible,
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
      reportDiagnosticsOwnerCapacity,
    ],
  );
  const clearPhpLocalDiagnostics = useCallback(() => {
    setPhpLocalDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) => !notice.groupKey?.startsWith(PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX),
      ),
    );
  }, [setNotices, setPhpLocalDiagnosticsByPath]);

  const restoreJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);
      const ownerRestored = restoreDiagnosticsOwner(lifecycleKey);
      reportDiagnosticsOwnerCapacity("typescript", rootKey, ownerRestored);
      visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef.current = rootKey;
      const cachedDiagnostics = rootKey
        ? (javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {})
        : {};
      setJavaScriptTypeScriptDiagnosticsByPath({ ...cachedDiagnostics });
      const receiptPrefix = diagnosticsRetentionReceiptOwnerPrefix("typescript", rootKey);
      const ledger = diagnosticsLifecycleStoreRef.current.ledger(lifecycleKey);
      const ownerRevision = diagnosticsOwnerRevision(lifecycleKey);
      const runtimeStatus = owner
        ? cachedLanguageServerRuntimeStatusForOwner(
            javaScriptTypeScriptRuntimeStatusByRootRef.current,
            owner,
          )
        : cachedLanguageServerRuntimeStatusForRoot(
            javaScriptTypeScriptRuntimeStatusByRootRef.current,
            rootPath ?? null,
          );
      setNotices((current) => {
        const withoutReceipt = current.filter(
          (notice) => !notice.groupKey?.startsWith(receiptPrefix),
        );
        if (
          !ownerRestored ||
          ownerRevision === null ||
          !ledger ||
          runtimeStatus?.kind !== "running"
        ) {
          return withoutReceipt;
        }
        return replaceDiagnosticsRetentionReceipt(withoutReceipt, {
          kind: "typescript",
          ownerKey: rootKey,
          ownerRevision,
          publishedCount: ledger.publishedCount,
          publishedCountKind: ledger.untrackedPublishedCount > 0 ? "upperBound" : "exact",
          retainedCount: Object.values(cachedDiagnostics).reduce(
            (count, diagnostics) => count + diagnostics.length,
            0,
          ),
          sessionId: runtimeStatus.sessionId,
        });
      });
    },
    [
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      diagnosticsOwnerRevision,
      reportDiagnosticsOwnerCapacity,
      restoreDiagnosticsOwner,
      setJavaScriptTypeScriptDiagnosticsByPath,
      setNotices,
    ],
  );

  const updateJavaScriptTypeScriptDiagnosticsBatchForRoot = useCallback(
    (
      rootPath: string,
      updates: readonly {
        readonly diagnosticPath: string;
        readonly diagnostics: readonly LanguageServerDiagnostic[];
        readonly publishedCount: number;
      }[],
      owner?: WorkspaceRuntimeOwner,
      ownerRevision?: number,
      sessionId?: number,
    ) => {
      const rootKey = diagnosticsOwnerKey(rootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);

      if (
        ownerRevision !== undefined &&
        !isDiagnosticsOwnerRevisionCurrent(lifecycleKey, ownerRevision)
      ) {
        return;
      }

      const batch = javaScriptTypeScriptDiagnosticsBatchRef.current;
      if (batch && ownerRevision !== undefined && sessionId !== undefined) {
        const staged = batch.get(rootKey) ?? {
          ownerRevision,
          rootPath,
          sessionId,
          updates: [],
        };
        staged.updates.push(...updates);
        batch.set(rootKey, staged);
        const projected = applyBoundedDiagnosticsCacheBatch(
          {},
          updates.map((update) => ({
            diagnostics: update.diagnostics,
            path: update.diagnosticPath,
            publishedCount: update.publishedCount,
          })),
        );
        return { ...projected.byPath };
      }

      const result = commitDiagnosticsOwnerCacheBatch({
        cacheByOwner: javaScriptTypeScriptDiagnosticsByRootRef.current,
        lifecycleKey,
        lifecycleStore: diagnosticsLifecycleStoreRef.current,
        ownerKey: rootKey,
        updates: updates.map((update) => ({
          diagnostics: update.diagnostics,
          path: update.diagnosticPath,
          publishedCount: update.publishedCount,
        })),
      });
      if (!result) {
        reportDiagnosticsOwnerCapacity("typescript", rootKey, false);
        return;
      }
      reportDiagnosticsOwnerCapacity("typescript", rootKey, true);
      const nextByPath = { ...result.byPath };

      if (
        isDiagnosticsOwnerVisible(
          rootKey,
          rootPath,
          visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
        )
      ) {
        setJavaScriptTypeScriptDiagnosticsByPath(nextByPath);
      }

      return nextByPath;
    },
    [
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      javaScriptTypeScriptDiagnosticsByRootRef,
      reportDiagnosticsOwnerCapacity,
      setJavaScriptTypeScriptDiagnosticsByPath,
    ],
  );

  const clearJavaScriptTypeScriptDiagnosticsForRoot =
    javaScriptTypeScriptDiagnosticsLifecycle.clear;
  const resetJavaScriptTypeScriptDiagnosticsForRoot =
    javaScriptTypeScriptDiagnosticsLifecycle.reset;
  const prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart =
    javaScriptTypeScriptDiagnosticsLifecycle.prepare;

  const clearPhpLocalDiagnosticsForPath = useCallback(
    (diagnosticPath: string) => {
      setPhpLocalDiagnosticsByPath((current) => {
        if (!(diagnosticPath in current)) {
          return current;
        }

        const next = { ...current };
        delete next[diagnosticPath];
        return next;
      });

      const phpLocalGroupKey = phpLocalDiagnosticFileIdentity(diagnosticPath)?.groupKey;
      if (!phpLocalGroupKey) return;
      setNotices((current) => current.filter((notice) => notice.groupKey !== phpLocalGroupKey));
    },
    [setNotices, setPhpLocalDiagnosticsByPath],
  );

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

      const phpChanged = removePathFromRootCache(languageServerDiagnosticsByRootRef.current);
      const javaScriptTypeScriptChanged = removePathFromRootCache(
        javaScriptTypeScriptDiagnosticsByRootRef.current,
      );
      const clearLedgerPath = (kind: "php" | "typescript") => {
        removeDiagnosticsOwnerLedgerPath(
          diagnosticsLifecycleStoreRef.current,
          diagnosticsOwnerLifecycleKey(kind, rootKey),
          diagnosticPath,
        );
      };
      if (phpChanged) {
        clearLedgerPath("php");
      }
      if (javaScriptTypeScriptChanged) {
        clearLedgerPath("typescript");
      }

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

      if (javaScriptTypeScriptChanged && isJavaScriptTypeScriptOwnerVisible) {
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
      const javaScriptTypeScriptGroupKey = javaScriptTypeScriptDiagnosticNoticeGroup(uri);

      setNotices((current) =>
        current.filter(
          (notice) =>
            (!isPhpOwnerVisible || notice.groupKey !== phpGroupKey) &&
            (!isJavaScriptTypeScriptOwnerVisible ||
              notice.groupKey !== javaScriptTypeScriptGroupKey),
        ),
      );
    },
    [
      clearPhpLocalDiagnosticsForPath,
      isDiagnosticsOwnerVisible,
      javaScriptTypeScriptDiagnosticsByRootRef,
      languageServerDiagnosticsByRootRef,
      setFrameworkDiagnosticsByPath,
      setJavaScriptTypeScriptDiagnosticsByPath,
      setLanguageServerDiagnosticsByPath,
      setNotices,
    ],
  );

  const updateLocalPhpDiagnostics = useCallback(
    (diagnosticPath: string, diagnostics: LanguageServerDiagnostic[]) => {
      // Local PHP diagnostics are emitted only by the mounted EditorSurface for
      // the active document. Do not re-guard by workspaceRelativePath here:
      // reopened projects can hand the editor a canonicalized model path while
      // the persisted workspace root is still the user-selected alias, and that
      // would drop visible local markers from Problems/status.
      if (isExternallyRemovedDocumentPath(diagnosticPath)) {
        clearLanguageServerDiagnosticsForPath(currentWorkspaceRootRef.current, diagnosticPath);
        return;
      }

      const identity = phpLocalDiagnosticFileIdentity(diagnosticPath);
      if (!identity) {
        clearPhpLocalDiagnosticsForPath(diagnosticPath);
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

      const { groupKey, uri } = identity;
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
        (hiddenCount) => buildDiagnosticOverflowNotice("PHP", groupKey, hiddenCount),
      );

      setNotices((current) =>
        capWorkbenchNotices(
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
          GLOBAL_NOTICE_LIMIT,
          isCappableDiagnosticNotice,
        ),
      );
    },
    [
      clearPhpLocalDiagnosticsForPath,
      clearLanguageServerDiagnosticsForPath,
      currentWorkspaceRootRef,
      isExternallyRemovedDocumentPath,
      setNotices,
      setPhpLocalDiagnosticsByPath,
    ],
  );

  const activeDocumentPath = activeDocument?.path;
  const activeDocumentContent = activeDocument?.content;
  const activeDocumentLanguage = activeDocument?.language;

  useEffect(() => {
    phpLocalDiagnosticRetryTimersRef.current.forEach((timer) => clearTimeout(timer));
    phpLocalDiagnosticRetryTimersRef.current = [];

    const generation = phpLocalDiagnosticValidationGenerationRef.current + 1;
    phpLocalDiagnosticValidationGenerationRef.current = generation;

    if (
      activeDocumentPath === undefined ||
      activeDocumentContent === undefined ||
      activeDocumentLanguage !== "php"
    ) {
      if (activeDocumentPath) {
        updateLocalPhpDiagnostics(activeDocumentPath, []);
      }

      return;
    }

    const document = {
      path: activeDocumentPath,
      content: activeDocumentContent,
      language: activeDocumentLanguage,
    };

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
      phpLocalDiagnosticRetryTimersRef.current.forEach((timer) => clearTimeout(timer));
      phpLocalDiagnosticRetryTimersRef.current = [];
    };
  }, [
    activeDocumentContent,
    activeDocumentLanguage,
    activeDocumentPath,
    activeDocumentRef,
    phpLocalDiagnosticRetryTimersRef,
    phpLocalDiagnosticValidationGenerationRef,
    phpLocalSyntaxDiagnosticsGateway,
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
    [activeDocumentRef, documentsRef, phpLocalSyntaxDiagnosticsGateway, updateLocalPhpDiagnostics],
  );

  const applyLanguageServerDiagnostics = useCallback(
    (incomingEvent: LanguageServerDiagnosticEvent, owner?: WorkspaceRuntimeOwner) => {
      const event = diagnosticsEventForOwner(incomingEvent, owner);

      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;
      const ownerKey = diagnosticsOwnerKey(diagnosticsRootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("php", ownerKey);

      if (owner && diagnosticsLifecycleStoreRef.current.isClosed(lifecycleKey)) {
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
            languageServerRuntimeStatusByRootRef.current,
            owner,
          )
        : cachedLanguageServerRuntimeStatusForRoot(
            languageServerRuntimeStatusByRootRef.current,
            diagnosticsRootPath,
          );
      const currentSessionId = runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }
      const ownerRevision = captureDiagnosticsOwnerRevision(lifecycleKey);
      if (ownerRevision === null) {
        return;
      }

      const diagnosticUriSyncKey = diagnosticsUriVersionKey(diagnosticsRootPath, event.uri, owner);
      const lastAppliedDiagnosticVersion = diagnosticsLifecycleStoreRef.current.appliedVersion(
        lifecycleKey,
        event.uri,
      );
      if (
        typeof event.version === "number" &&
        !diagnosticsLifecycleStoreRef.current.canAcceptVersion(lifecycleKey, event.uri)
      ) {
        reportDiagnosticsUriCapacity("php", ownerKey);
        return;
      }

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
      const publicationRevision = diagnosticsLifecycleStoreRef.current.nextPublication(
        lifecycleKey,
        event.uri,
      );
      if (publicationRevision === null) {
        reportDiagnosticsUriCapacity("php", ownerKey);
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
        clearLanguageServerDiagnosticsForPath(diagnosticsRootPath, diagnosticPath, owner);
        return;
      }

      return (async () => {
        const diagnostics =
          diagnosticPath && isActiveRoot
            ? await contextualDiagnosticsFilterRef.current(diagnosticPath, event.diagnostics)
            : event.diagnostics;
        const latestAppliedDiagnosticVersion = diagnosticsLifecycleStoreRef.current.appliedVersion(
          lifecycleKey,
          event.uri,
        );
        if (
          !diagnosticsLifecycleStoreRef.current.isPublicationCurrent(
            lifecycleKey,
            event.uri,
            publicationRevision,
          )
        ) {
          return;
        }

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

        const latestRuntimeStatus = owner
          ? cachedLanguageServerRuntimeStatusForOwner(
              languageServerRuntimeStatusByRootRef.current,
              owner,
            )
          : cachedLanguageServerRuntimeStatusForRoot(
              languageServerRuntimeStatusByRootRef.current,
              diagnosticsRootPath,
            );
        if (
          latestRuntimeStatus?.kind !== "running" ||
          latestRuntimeStatus.sessionId !== event.sessionId
        ) {
          return;
        }

        if (diagnosticPath && isExternallyRemovedDocumentPath(diagnosticPath)) {
          clearLanguageServerDiagnosticsForPath(diagnosticsRootPath, diagnosticPath, owner);
          return;
        }

        if (typeof event.version === "number") {
          if (
            diagnosticsLifecycleStoreRef.current.recordAppliedVersion(
              lifecycleKey,
              event.uri,
              event.version,
              () => {
                delete lastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey];
              },
            )
          ) {
            lastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey] = event.version;
          }
        }

        const retainedDiagnostics = diagnosticPath
          ? (updateLanguageServerDiagnosticsBatchForRoot(
              diagnosticsRootPath,
              [
                {
                  diagnosticPath,
                  diagnostics,
                  publishedCount: event.projection?.publishedCount ?? diagnostics.length,
                },
              ],
              owner,
              ownerRevision,
              event.sessionId,
            )?.[diagnosticPath] ?? [])
          : (applyBoundedDiagnosticsCacheBatch({}, [
              {
                diagnostics,
                path: event.uri,
                publishedCount: event.projection?.publishedCount ?? diagnostics.length,
              },
            ]).byPath[event.uri] ?? []);
        const diagnosticNotices = diagnosticNoticesForRetainedPrefix(
          retainedDiagnostics,
          event.projection?.publishedCount ?? diagnostics.length,
          "Language Server",
          groupKey,
          event.uri,
        );

        if (isLatestActiveRoot && !languageServerDiagnosticsBatchRef.current) {
          setNotices((current) =>
            capWorkbenchNotices(
              replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
              GLOBAL_NOTICE_LIMIT,
              isCappableDiagnosticNotice,
            ),
          );
        }
        if (!languageServerDiagnosticsBatchRef.current) {
          onPhpLanguageServerDiagnosticsCommitted?.(diagnosticsRootPath, ownerKey);
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
          !isLanguageServerSessionCurrentForRoot(diagnosticsRootPath, currentSessionId)
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(diagnosticsRootPath, error);
      });
    },
    [
      appSettingsRef,
      clearLanguageServerDiagnosticsForPath,
      contextualDiagnosticsFilterRef,
      currentWorkspaceRootRef,
      captureDiagnosticsOwnerRevision,
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      isLanguageServerSessionCurrentForRoot,
      isExternallyRemovedDocumentPath,
      languageServerRuntimeStatusByRootRef,
      lastAppliedDiagnosticVersionByUriRef,
      onPhpLanguageServerDiagnosticsCommitted,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      reportDiagnosticsUriCapacity,
      setNotices,
      updateLanguageServerDiagnosticsBatchForRoot,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(
    (incomingEvent: LanguageServerDiagnosticEvent, owner?: WorkspaceRuntimeOwner) => {
      const event = diagnosticsEventForOwner(incomingEvent, owner);

      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;
      const ownerKey = diagnosticsOwnerKey(diagnosticsRootPath, owner);
      const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", ownerKey);

      if (owner && diagnosticsLifecycleStoreRef.current.isClosed(lifecycleKey)) {
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
      const currentSessionId = runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }
      const ownerRevision = captureDiagnosticsOwnerRevision(lifecycleKey);
      if (ownerRevision === null) {
        return;
      }

      const diagnosticUriSyncKey = diagnosticsUriVersionKey(diagnosticsRootPath, event.uri, owner);
      const lastAppliedDiagnosticVersion = diagnosticsLifecycleStoreRef.current.appliedVersion(
        lifecycleKey,
        event.uri,
      );
      if (
        typeof event.version === "number" &&
        !diagnosticsLifecycleStoreRef.current.canAcceptVersion(lifecycleKey, event.uri)
      ) {
        reportDiagnosticsUriCapacity("typescript", ownerKey);
        return;
      }

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

      const diagnosticsWorkspaceSettings = workspaceSettingsForRoot(diagnosticsRootPath);
      if (!diagnosticsWorkspaceSettings) {
        return;
      }

      if (typeof event.version === "number") {
        if (
          diagnosticsLifecycleStoreRef.current.recordAppliedVersion(
            lifecycleKey,
            event.uri,
            event.version,
            () => {
              delete javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
                diagnosticUriSyncKey
              ];
            },
          )
        ) {
          javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[diagnosticUriSyncKey] =
            event.version;
        }
      }

      if (!diagnosticsWorkspaceSettings.javaScriptTypeScriptValidation) {
        if (isActiveRoot) {
          setNotices((current) => replaceWorkbenchNoticeGroup(current, groupKey, []));
        }

        if (diagnosticPath) {
          updateJavaScriptTypeScriptDiagnosticsBatchForRoot(
            diagnosticsRootPath,
            [{ diagnosticPath, diagnostics: [], publishedCount: 0 }],
            owner,
            ownerRevision,
            event.sessionId,
          );
        }

        return;
      }

      const retainedDiagnostics = diagnosticPath
        ? (updateJavaScriptTypeScriptDiagnosticsBatchForRoot(
            diagnosticsRootPath,
            [
              {
                diagnosticPath,
                diagnostics: event.diagnostics,
                publishedCount: event.projection?.publishedCount ?? event.diagnostics.length,
              },
            ],
            owner,
            ownerRevision,
            event.sessionId,
          )?.[diagnosticPath] ?? [])
        : (applyBoundedDiagnosticsCacheBatch({}, [
            {
              diagnostics: event.diagnostics,
              path: event.uri,
              publishedCount: event.projection?.publishedCount ?? event.diagnostics.length,
            },
          ]).byPath[event.uri] ?? []);
      const diagnosticNotices = diagnosticNoticesForRetainedPrefix(
        retainedDiagnostics,
        event.projection?.publishedCount ?? event.diagnostics.length,
        "TypeScript",
        groupKey,
        event.uri,
      );

      if (isActiveRoot && !javaScriptTypeScriptDiagnosticsBatchRef.current) {
        setNotices((current) =>
          capWorkbenchNotices(
            replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
            GLOBAL_NOTICE_LIMIT,
            isCappableDiagnosticNotice,
          ),
        );
      }
    },
    [
      appSettingsRef,
      currentWorkspaceRootRef,
      captureDiagnosticsOwnerRevision,
      isDiagnosticsOwnerVisible,
      javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      reportDiagnosticsUriCapacity,
      setNotices,
      updateJavaScriptTypeScriptDiagnosticsBatchForRoot,
      workspaceSettingsForRoot,
    ],
  );

  const applyLanguageServerDiagnosticsBatch = useCallback(
    (events: readonly DiagnosticsOwnedEvent[]) => {
      if (languageServerDiagnosticsBatchRef.current) {
        events.forEach(({ event, owner }) => {
          const operation = applyLanguageServerDiagnostics(event, owner);
          if (operation) {
            languageServerDiagnosticsBatchPendingRef.current?.push(operation);
          }
        });
        return;
      }

      const batch = new Map<
        string,
        {
          ownerRevision: number;
          rootPath: string;
          sessionId: number;
          updates: {
            diagnosticPath: string;
            diagnostics: readonly LanguageServerDiagnostic[];
            publishedCount: number;
          }[];
        }
      >();
      languageServerDiagnosticsBatchRef.current = batch;
      const pending = events
        .map(({ event, owner }) => applyLanguageServerDiagnostics(event, owner))
        .filter((operation): operation is Promise<void> => Boolean(operation));
      languageServerDiagnosticsBatchPendingRef.current = pending;

      void (async () => {
        let settledCount = 0;
        while (settledCount < pending.length) {
          const unsettled = pending.slice(settledCount);
          settledCount = pending.length;
          await Promise.all(unsettled);
        }
        languageServerDiagnosticsBatchPendingRef.current = null;
        languageServerDiagnosticsBatchRef.current = null;
        batch.forEach(({ ownerRevision, rootPath, sessionId, updates }, rootKey) => {
          const runtimeStatus = languageServerRuntimeStatusByRootRef.current[rootKey];
          if (
            sessionId === undefined ||
            runtimeStatus?.kind !== "running" ||
            runtimeStatus.sessionId !== sessionId ||
            !isDiagnosticsOwnerRevisionCurrent(
              diagnosticsOwnerLifecycleKey("php", rootKey),
              ownerRevision,
            )
          ) {
            return;
          }

          const lifecycleKey = diagnosticsOwnerLifecycleKey("php", rootKey);
          const result = commitDiagnosticsOwnerCacheBatch({
            cacheByOwner: languageServerDiagnosticsByRootRef.current,
            lifecycleKey,
            lifecycleStore: diagnosticsLifecycleStoreRef.current,
            ownerKey: rootKey,
            updates: updates.map((update) => ({
              diagnostics: update.diagnostics,
              path: update.diagnosticPath,
              publishedCount: update.publishedCount,
            })),
          });
          if (!result) {
            reportDiagnosticsOwnerCapacity("php", rootKey, false);
            return;
          }
          reportDiagnosticsOwnerCapacity("php", rootKey, true);
          const next = { ...result.byPath };

          if (
            isDiagnosticsOwnerVisible(
              rootKey,
              rootPath,
              visibleLanguageServerDiagnosticsOwnerKeyRef,
            )
          ) {
            setLanguageServerDiagnosticsByPath(next);
            const rebuiltNotices = boundedDiagnosticsNoticesForCache(next, "php");
            setNotices((currentNotices) =>
              replaceDiagnosticsRetentionReceipt(
                capWorkbenchNotices(
                  [
                    ...rebuiltNotices,
                    ...currentNotices.filter(
                      (notice) =>
                        !notice.groupKey?.startsWith("language-server-diagnostics:") &&
                        !notice.groupKey?.startsWith(
                          diagnosticsRetentionReceiptOwnerPrefix("php", rootKey),
                        ),
                    ),
                  ],
                  GLOBAL_NOTICE_LIMIT,
                  isCappableDiagnosticNotice,
                ),
                {
                  kind: "php",
                  ownerKey: rootKey,
                  ownerRevision,
                  publishedCount: result.receipt.publishedCount,
                  publishedCountKind: result.receipt.publishedCountKind,
                  retainedCount: result.receipt.retainedCount,
                  sessionId,
                },
              ),
            );
          }
          onPhpLanguageServerDiagnosticsCommitted?.(rootPath, rootKey);
        });
      })();
    },
    [
      applyLanguageServerDiagnostics,
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      languageServerDiagnosticsByRootRef,
      languageServerRuntimeStatusByRootRef,
      onPhpLanguageServerDiagnosticsCommitted,
      reportDiagnosticsOwnerCapacity,
      setLanguageServerDiagnosticsByPath,
      setNotices,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch = useCallback(
    (events: readonly DiagnosticsOwnedEvent[]) => {
      if (javaScriptTypeScriptDiagnosticsBatchRef.current) {
        events.forEach(({ event, owner }) => {
          applyJavaScriptTypeScriptLanguageServerDiagnostics(event, owner);
        });
        return;
      }

      const batch = new Map<
        string,
        {
          ownerRevision: number;
          rootPath: string;
          sessionId: number;
          updates: {
            diagnosticPath: string;
            diagnostics: readonly LanguageServerDiagnostic[];
            publishedCount: number;
          }[];
        }
      >();
      javaScriptTypeScriptDiagnosticsBatchRef.current = batch;
      try {
        events.forEach(({ event, owner }) => {
          applyJavaScriptTypeScriptLanguageServerDiagnostics(event, owner);
        });
      } finally {
        javaScriptTypeScriptDiagnosticsBatchRef.current = null;
      }

      batch.forEach(({ ownerRevision, rootPath, sessionId, updates }, rootKey) => {
        const runtimeStatus = javaScriptTypeScriptRuntimeStatusByRootRef.current[rootKey];
        if (
          runtimeStatus?.kind !== "running" ||
          runtimeStatus.sessionId !== sessionId ||
          !isDiagnosticsOwnerRevisionCurrent(
            diagnosticsOwnerLifecycleKey("typescript", rootKey),
            ownerRevision,
          )
        ) {
          return;
        }

        const lifecycleKey = diagnosticsOwnerLifecycleKey("typescript", rootKey);
        const result = commitDiagnosticsOwnerCacheBatch({
          cacheByOwner: javaScriptTypeScriptDiagnosticsByRootRef.current,
          lifecycleKey,
          lifecycleStore: diagnosticsLifecycleStoreRef.current,
          ownerKey: rootKey,
          updates: updates.map((update) => ({
            diagnostics: update.diagnostics,
            path: update.diagnosticPath,
            publishedCount: update.publishedCount,
          })),
        });
        if (!result) {
          reportDiagnosticsOwnerCapacity("typescript", rootKey, false);
          return;
        }
        reportDiagnosticsOwnerCapacity("typescript", rootKey, true);
        const next = { ...result.byPath };

        if (
          isDiagnosticsOwnerVisible(
            rootKey,
            rootPath,
            visibleJavaScriptTypeScriptDiagnosticsOwnerKeyRef,
          )
        ) {
          setJavaScriptTypeScriptDiagnosticsByPath(next);
          const rebuiltNotices = boundedDiagnosticsNoticesForCache(next, "typescript");
          setNotices((currentNotices) =>
            replaceDiagnosticsRetentionReceipt(
              capWorkbenchNotices(
                [
                  ...rebuiltNotices,
                  ...currentNotices.filter(
                    (notice) =>
                      !notice.groupKey?.startsWith("javascript-typescript-diagnostics:") &&
                      !notice.groupKey?.startsWith(
                        diagnosticsRetentionReceiptOwnerPrefix("typescript", rootKey),
                      ),
                  ),
                ],
                GLOBAL_NOTICE_LIMIT,
                isCappableDiagnosticNotice,
              ),
              {
                kind: "typescript",
                ownerKey: rootKey,
                ownerRevision,
                publishedCount: result.receipt.publishedCount,
                publishedCountKind: result.receipt.publishedCountKind,
                retainedCount: result.receipt.retainedCount,
                sessionId,
              },
            ),
          );
        }
      });
    },
    [
      applyJavaScriptTypeScriptLanguageServerDiagnostics,
      isDiagnosticsOwnerRevisionCurrent,
      isDiagnosticsOwnerVisible,
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      reportDiagnosticsOwnerCapacity,
      setJavaScriptTypeScriptDiagnosticsByPath,
      setNotices,
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
    applyLanguageServerDiagnosticsBatch,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch,
  };
}
