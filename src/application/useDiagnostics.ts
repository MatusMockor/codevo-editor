import {
  useCallback,
  useEffect,
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
import { cachedLanguageServerRuntimeStatusForRoot } from "../domain/languageServerRuntimeStatusCache";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
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
  ) => void;
  clearLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
  ) => void;
  clearJavaScriptTypeScriptLanguageServerDiagnostics: () => void;
  clearPhpLocalDiagnostics: () => void;
  restoreJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
  ) => void;
  clearJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
  ) => void;
  clearPhpLocalDiagnosticsForPath: (diagnosticPath: string) => void;
  clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null | undefined,
    diagnosticPath: string,
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
  applyLanguageServerDiagnostics: (event: LanguageServerDiagnosticEvent) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
  ) => void;
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

  const restoreLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const cachedDiagnostics = rootKey
        ? languageServerDiagnosticsByRootRef.current[rootKey] ?? {}
        : {};
      setLanguageServerDiagnosticsByPath({ ...cachedDiagnostics });
    },
    [],
  );

  const updateLanguageServerDiagnosticsForRoot = useCallback(
    (
      rootPath: string,
      diagnosticPath: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const currentByPath =
        languageServerDiagnosticsByRootRef.current[rootKey] ?? {};
      const nextByPath = {
        ...currentByPath,
        [diagnosticPath]: diagnostics,
      };

      languageServerDiagnosticsByRootRef.current[rootKey] = nextByPath;

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        setLanguageServerDiagnosticsByPath(nextByPath);
      }
    },
    [],
  );

  const clearLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);

      if (rootKey) {
        delete languageServerDiagnosticsByRootRef.current[rootKey];
      }

      languageServerDiagnosticsCoalescerRef.current?.dropRoot(rootPath);

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        clearLanguageServerDiagnostics();
      }
    },
    [clearLanguageServerDiagnostics],
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
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const cachedDiagnostics = rootKey
        ? javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {}
        : {};
      setJavaScriptTypeScriptDiagnosticsByPath({ ...cachedDiagnostics });
    },
    [],
  );

  const updateJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string,
      diagnosticPath: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
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

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        setJavaScriptTypeScriptDiagnosticsByPath(nextByPath);
      }
    },
    [],
  );

  const clearJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);

      if (rootKey) {
        delete javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey];
      }

      javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(rootPath);

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        clearJavaScriptTypeScriptLanguageServerDiagnostics();
      }
    },
    [clearJavaScriptTypeScriptLanguageServerDiagnostics],
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
    (rootPath: string | null | undefined, diagnosticPath: string) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const isActiveRoot = workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        rootPath,
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

      if (!isActiveRoot) {
        return;
      }

      if (phpChanged) {
        setLanguageServerDiagnosticsByPath((current) => {
          if (!(diagnosticPath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        });
      }

      if (javaScriptTypeScriptChanged) {
        setJavaScriptTypeScriptDiagnosticsByPath((current) => {
          if (!(diagnosticPath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[diagnosticPath];
          return next;
        });
      }

      setFrameworkDiagnosticsByPath((current) => {
        if (!(diagnosticPath in current)) {
          return current;
        }

        const next = { ...current };
        delete next[diagnosticPath];
        return next;
      });
      clearPhpLocalDiagnosticsForPath(diagnosticPath);

      const uri = fileUriFromPath(diagnosticPath);
      const phpGroupKey = languageServerDiagnosticNoticeGroup(uri);
      const javaScriptTypeScriptGroupKey =
        javaScriptTypeScriptDiagnosticNoticeGroup(uri);

      setNotices((current) =>
        current.filter(
          (notice) =>
            notice.groupKey !== phpGroupKey &&
            notice.groupKey !== javaScriptTypeScriptGroupKey,
        ),
      );
    },
    [clearPhpLocalDiagnosticsForPath],
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
    (event: LanguageServerDiagnosticEvent) => {
      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;

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

      const runtimeStatus = cachedLanguageServerRuntimeStatusForRoot(
        languageServerRuntimeStatusByRootRef.current,
        diagnosticsRootPath,
      );
      const currentSessionId =
        runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticUriSyncKey = languageServerUriSyncKey(
        diagnosticsRootPath,
        event.uri,
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
      const isActiveRoot = workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        diagnosticsRootPath,
      );

      if (diagnosticPath && isExternallyRemovedDocumentPath(diagnosticPath)) {
        clearLanguageServerDiagnosticsForPath(diagnosticsRootPath, diagnosticPath);
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

        const isLatestActiveRoot = workspaceRootKeysEqual(
          diagnosticsRootPath,
          currentWorkspaceRootRef.current,
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
          );
        }
      })().catch((error) => {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, diagnosticsRootPath)) {
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
      isLanguageServerSessionCurrentForRoot,
      isExternallyRemovedDocumentPath,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      updateLanguageServerDiagnosticsForRoot,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;

      if (
        !workspaceRootKeysEqual(diagnosticsRootPath, currentWorkspaceRootRef.current) &&
        !appSettingsRef.current.workspaceTabs.some((tabPath) =>
          workspaceRootKeysEqual(tabPath, diagnosticsRootPath),
        )
      ) {
        return;
      }

      const runtimeStatus = cachedLanguageServerRuntimeStatusForRoot(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        diagnosticsRootPath,
      );
      const currentSessionId =
        runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticUriSyncKey = languageServerUriSyncKey(
        diagnosticsRootPath,
        event.uri,
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
      const isActiveRoot = workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        diagnosticsRootPath,
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
        );
      }
    },
    [updateJavaScriptTypeScriptDiagnosticsForRoot, workspaceSettingsForRoot],
  );

  return {
    replaceEslintDiagnostics,
    clearEslintDiagnosticsForRoot,
    replacePhpstanDiagnostics,
    clearPhpstanDiagnosticsForRoot,
    clearLanguageServerDiagnostics,
    restoreLanguageServerDiagnosticsForRoot,
    clearLanguageServerDiagnosticsForRoot,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    restoreJavaScriptTypeScriptDiagnosticsForRoot,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    updateLocalPhpDiagnostics,
    refreshLocalPhpDiagnosticsForContent,
    applyLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
  };
}
