import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type LanguageServerGateway,
  type LanguageServerPlan,
} from "../domain/languageServer";
import {
  isLanguageServerActive,
  languageServerCrashMessage,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type UnsubscribeFn,
} from "../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForRoot,
  cacheLanguageServerRuntimeStatus,
  removeCachedLanguageServerRuntimeStatus,
} from "../domain/languageServerRuntimeStatusCache";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import {
  shouldStartLanguageServer,
} from "../domain/intelligence";
import type {
  AppSettings,
  BackgroundRuntimePolicy,
  WorkspaceSettings,
} from "../domain/settings";
import type {
  IntelligenceMode,
  PhpToolAvailability,
  PhpToolGateway,
} from "../domain/workspace";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  javaScriptTypeScriptLanguageServerOptions,
} from "./javaScriptTypeScriptLanguageServerSettings";

const PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS = 2;

export interface LanguageServerRuntimeLifecycleDependencies {
  workspaceRoot: string | null;
  workspaceTrust: WorkspaceTrustState | null;
  intelligenceMode: IntelligenceMode;
  workspaceSettings: WorkspaceSettings;
  shouldAutoStartJavaScriptTypeScriptLanguageServer: boolean;
  phpLanguageServerAutostartRetryVersion: number;

  languageServerPlan: LanguageServerPlan | null;
  javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;

  appSettingsRef: MutableRefObject<AppSettings>;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  autoStartedLanguageServerRootRef: MutableRefObject<string | null>;
  phpLanguageServerAutostartAttemptsByRootRef: MutableRefObject<
    Record<string, number>
  >;
  manuallyStoppedPhpLanguageServerRootsRef: MutableRefObject<Set<string>>;
  autoStartedJavaScriptTypeScriptLanguageServerRootRef: MutableRefObject<
    string | null
  >;
  lastLanguageServerCrashRef: MutableRefObject<string | null>;
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<
    LanguageServerRuntimeStatus | null
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<
    string | null
  >;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
  setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  setJavaScriptTypeScriptLanguageServerPlan: Dispatch<
    SetStateAction<LanguageServerPlan | null>
  >;
  setLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  setLanguageServerRuntimeStatusRoot: Dispatch<SetStateAction<string | null>>;
  setJavaScriptTypeScriptLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: Dispatch<
    SetStateAction<string | null>
  >;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  setPhpLanguageServerAutostartRetryVersion: Dispatch<SetStateAction<number>>;

  phpToolGateway: PhpToolGateway;
  languageServerGateway: LanguageServerGateway;
  languageServerRuntimeGateway: LanguageServerRuntimeGateway;
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway;
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway;
  terminalGateway: TerminalGateway;

  clearLanguageServerDiagnosticsForRoot: (rootPath: string) => void;
  clearJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
  ) => void;
  resetLanguageServerDocuments: () => void;
  resetJavaScriptTypeScriptLanguageServerDocuments: () => void;
  isLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  reportError: (source: string, error: unknown) => void;
  reportLanguageServerError: (error: unknown) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface LanguageServerRuntimeLifecycle {
  refreshLanguageServerPlan: (rootPath: string) => Promise<LanguageServerPlan | null>;
  runPhpWorkspaceProbe: (rootPath: string) => Promise<void>;
  refreshJavaScriptTypeScriptLanguageServerPlan: (
    rootPath: string,
    typeScriptVersionPreference?: WorkspaceSettings["javaScriptTypeScriptVersion"],
  ) => Promise<LanguageServerPlan | null>;
  clearManualPhpLanguageServerStop: (rootPath: string) => void;
  forgetLanguageServerRuntimeStatuses: (rootPath: string) => void;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  handleLanguageServerRuntimeStatus: (
    status: LanguageServerRuntimeStatus,
    fallbackRootPath?: string,
  ) => void;
  handleJavaScriptTypeScriptLanguageServerRuntimeStatus: (
    status: LanguageServerRuntimeStatus,
    fallbackRootPath?: string,
  ) => void;
  stopLanguageServerRuntime: (
    rootPath?: string,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopJavaScriptTypeScriptLanguageServerRuntime: (
    rootPath?: string,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopProjectRuntimes: (rootPath?: string) => Promise<void>;
  stopBackgroundProjectRuntimes: (
    policy: BackgroundRuntimePolicy,
    activeRootPath: string | null,
    previousRootPath: string | null,
  ) => Promise<void>;
  startLanguageServer: () => Promise<void>;
  stopLanguageServer: () => Promise<void>;
  restartJavaScriptTypeScriptService: () => Promise<void>;
}

export function useLanguageServerRuntimeLifecycle(
  dependencies: LanguageServerRuntimeLifecycleDependencies,
): LanguageServerRuntimeLifecycle {
  const {
    workspaceRoot,
    workspaceTrust,
    intelligenceMode,
    workspaceSettings,
    shouldAutoStartJavaScriptTypeScriptLanguageServer,
    phpLanguageServerAutostartRetryVersion,
    languageServerPlan,
    javaScriptTypeScriptLanguageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    appSettingsRef,
    workspaceSettingsRef,
    currentWorkspaceRootRef,
    autoStartedLanguageServerRootRef,
    phpLanguageServerAutostartAttemptsByRootRef,
    manuallyStoppedPhpLanguageServerRootsRef,
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    lastLanguageServerCrashRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    setPhpTools,
    setLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerPlan,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setMessage,
    setNotices,
    setPhpLanguageServerAutostartRetryVersion,
    phpToolGateway,
    languageServerGateway,
    languageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    workspaceRuntimeLifecycleGateway,
    terminalGateway,
    clearLanguageServerDiagnosticsForRoot,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    resetLanguageServerDocuments,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    isLanguageServerSessionCurrentForRoot,
    reportError,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string) => {
      try {
        const plan = await languageServerGateway.planPhpLanguageServer(
          rootPath,
          phpLanguageServerOptions(workspaceSettingsRef.current),
        );
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setLanguageServerPlan(plan);
        }
        return plan;
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setLanguageServerPlan(null);
          reportError("Language Server", error);
        }
        return null;
      }
    },
    [currentWorkspaceRootRef, languageServerGateway, reportError, setLanguageServerPlan, workspaceSettingsRef],
  );

  const runPhpWorkspaceProbe = useCallback(
    async (rootPath: string) => {
      try {
        const tools = await phpToolGateway.detectPhpTools(rootPath);
        const phpSetupNoticeGroup = `phpactor-setup:${rootPath}`;

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        setPhpTools(tools);

        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, []),
          );
          await refreshLanguageServerPlan(rootPath);
          return;
        }

        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, [
            createWorkbenchNotice(
              "warning",
              "PHP IDE Engine",
              "Install the managed PHP IDE engine (one-click user profile bootstrap) to enable hover, completion, definition, and implementation support.",
              phpSetupNoticeGroup,
            ),
          ]),
        );
        await refreshLanguageServerPlan(rootPath);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(rootPath, "PHP Tools", error);
      }
    },
    [
      currentWorkspaceRootRef,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      setNotices,
      setPhpTools,
    ],
  );

  const refreshJavaScriptTypeScriptLanguageServerPlan = useCallback(
    async (
      rootPath: string,
      typeScriptVersionPreference =
        workspaceSettingsRef.current.javaScriptTypeScriptVersion,
    ) => {
      try {
        const plan =
          await languageServerGateway.planJavaScriptTypeScriptLanguageServer(
            rootPath,
            {
              ...javaScriptTypeScriptLanguageServerOptions(
                workspaceSettingsRef.current,
              ),
              typeScriptVersionPreference,
            },
          );

        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setJavaScriptTypeScriptLanguageServerPlan(plan);
        }

        return plan;
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setJavaScriptTypeScriptLanguageServerPlan(null);
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
        return null;
      }
    },
    [
      currentWorkspaceRootRef,
      languageServerGateway,
      reportErrorForActiveWorkspaceRoot,
      setJavaScriptTypeScriptLanguageServerPlan,
      workspaceSettingsRef,
    ],
  );

  const cacheJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (rootPath: string, status: LanguageServerRuntimeStatus) => {
      return cacheLanguageServerRuntimeStatus(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        rootPath,
        status,
      );
    },
    [javaScriptTypeScriptRuntimeStatusByRootRef],
  );

  const cachePhpLanguageServerRuntimeStatus = useCallback(
    (rootPath: string, status: LanguageServerRuntimeStatus) => {
      return cacheLanguageServerRuntimeStatus(
        languageServerRuntimeStatusByRootRef.current,
        rootPath,
        status,
      );
    },
    [languageServerRuntimeStatusByRootRef],
  );

  const clearManualPhpLanguageServerStop = useCallback(
    (rootPath: string) => {
      manuallyStoppedPhpLanguageServerRootsRef.current.delete(
        normalizedWorkspaceRootKey(rootPath),
      );
    },
    [manuallyStoppedPhpLanguageServerRootsRef],
  );

  const markManualPhpLanguageServerStop = useCallback(
    (rootPath: string) => {
      manuallyStoppedPhpLanguageServerRootsRef.current.add(
        normalizedWorkspaceRootKey(rootPath),
      );
    },
    [manuallyStoppedPhpLanguageServerRootsRef],
  );

  const isPhpLanguageServerManuallyStopped = useCallback(
    (rootPath: string) =>
      manuallyStoppedPhpLanguageServerRootsRef.current.has(
        normalizedWorkspaceRootKey(rootPath),
      ),
    [manuallyStoppedPhpLanguageServerRootsRef],
  );

  const forgetLanguageServerRuntimeStatuses = useCallback(
    (rootPath: string) => {
      clearManualPhpLanguageServerStop(rootPath);
      removeCachedLanguageServerRuntimeStatus(
        languageServerRuntimeStatusByRootRef.current,
        rootPath,
      );
      removeCachedLanguageServerRuntimeStatus(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        rootPath,
      );
    },
    [
      clearManualPhpLanguageServerStop,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
    ],
  );

  const isOpenWorkspaceRuntimeRoot = useCallback(
    (rootPath: string) => {
      if (workspaceRootKeysEqual(rootPath, currentWorkspaceRootRef.current)) {
        return true;
      }

      return appSettingsRef.current.workspaceTabs.some((tabPath) =>
        workspaceRootKeysEqual(tabPath, rootPath),
      );
    },
    [appSettingsRef, currentWorkspaceRootRef],
  );

  const isLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      return (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isLanguageServerSessionCurrentForRoot(rootPath, sessionId)
      );
    },
    [currentWorkspaceRootRef, isLanguageServerSessionCurrentForRoot],
  );

  const isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      const currentRuntimeStatus =
        cachedLanguageServerRuntimeStatusForRoot(
          javaScriptTypeScriptRuntimeStatusByRootRef.current,
          rootPath,
        ) ??
        (workspaceRootKeysEqual(
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
          rootPath,
        )
          ? javaScriptTypeScriptLanguageServerRuntimeStatusRef.current
          : null);

      return isRunningLanguageServerSessionForWorkspace(
        currentRuntimeStatus,
        currentRuntimeStatus?.rootPath ??
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      );
    },
    [
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
    ],
  );

  const isJavaScriptTypeScriptLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      return (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          sessionId,
        )
      );
    },
    [
      currentWorkspaceRootRef,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    ],
  );

  const handleLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus, fallbackRootPath?: string) => {
      const statusRootPath = runtimeStatusRootPath(status, fallbackRootPath);

      if (!statusRootPath) {
        return;
      }

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath)) {
        return;
      }

      const rootedStatus = cachePhpLanguageServerRuntimeStatus(
        statusRootPath,
        status,
      );
      const crash = languageServerCrashMessage(status);

      if (status.kind === "starting" || status.kind === "running") {
        clearManualPhpLanguageServerStop(statusRootPath);
      }

      if (!workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)) {
        if (status.kind !== "running") {
          clearLanguageServerDiagnosticsForRoot(statusRootPath);
        }

        return;
      }

      setLanguageServerRuntimeStatus(rootedStatus);
      setLanguageServerRuntimeStatusRoot(statusRootPath);

      if (status.kind !== "running") {
        clearLanguageServerDiagnosticsForRoot(statusRootPath);
      }

      if (!crash) {
        const previousCrash = lastLanguageServerCrashRef.current;
        if (previousCrash) {
          setMessage((current) => (current === previousCrash ? null : current));
          setNotices((current) =>
            current.filter(
              (notice) =>
                notice.source !== "Language Server" ||
                notice.message !== previousCrash,
            ),
          );
        }
        lastLanguageServerCrashRef.current = null;
        return;
      }

      reportLanguageServerError(crash);
    },
    [
      cachePhpLanguageServerRuntimeStatus,
      clearLanguageServerDiagnosticsForRoot,
      clearManualPhpLanguageServerStop,
      currentWorkspaceRootRef,
      isOpenWorkspaceRuntimeRoot,
      lastLanguageServerCrashRef,
      reportLanguageServerError,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      setMessage,
      setNotices,
    ],
  );

  const handleJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus, fallbackRootPath?: string) => {
      const statusRootPath = runtimeStatusRootPath(status, fallbackRootPath);

      if (!statusRootPath) {
        return;
      }

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath)) {
        return;
      }

      const rootedStatus = cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        statusRootPath,
        status,
      );
      const crash = languageServerCrashMessage(status);

      if (!workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)) {
        if (status.kind !== "running") {
          clearJavaScriptTypeScriptDiagnosticsForRoot(statusRootPath);
        }

        return;
      }

      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current = rootedStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        statusRootPath;
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(statusRootPath);

      if (status.kind !== "running") {
        clearJavaScriptTypeScriptDiagnosticsForRoot(statusRootPath);
      }

      if (!crash) {
        return;
      }

      reportError("JavaScript/TypeScript", crash);
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      currentWorkspaceRootRef,
      isOpenWorkspaceRuntimeRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      reportError,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopLanguageServerRuntime = useCallback(
    async (rootPath?: string) => {
      const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!targetRootPath) {
        return null;
      }

      try {
        const status = await languageServerRuntimeGateway.stop(targetRootPath);
        const requestedStatus = runtimeStatusForRequestedRoot(
          status,
          targetRootPath,
        );
        const rootedStatus = cachePhpLanguageServerRuntimeStatus(
          targetRootPath,
          requestedStatus,
        );
        clearLanguageServerDiagnosticsForRoot(targetRootPath);

        if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
          setLanguageServerRuntimeStatus(rootedStatus);
          setLanguageServerRuntimeStatusRoot(targetRootPath);
          lastLanguageServerCrashRef.current = null;
          resetLanguageServerDocuments();
        }

        return rootedStatus;
      } catch (error) {
        if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
          reportLanguageServerError(error);
        }
        return null;
      }
    },
    [
      cachePhpLanguageServerRuntimeStatus,
      clearLanguageServerDiagnosticsForRoot,
      currentWorkspaceRootRef,
      languageServerRuntimeGateway,
      lastLanguageServerCrashRef,
      reportLanguageServerError,
      resetLanguageServerDocuments,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopJavaScriptTypeScriptLanguageServerRuntime = useCallback(
    async (rootPath?: string) => {
      const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!targetRootPath) {
        return null;
      }

      try {
        const status =
          await javaScriptTypeScriptLanguageServerRuntimeGateway.stop(
            targetRootPath,
          );
        const requestedStatus = runtimeStatusForRequestedRoot(
          status,
          targetRootPath,
        );
        const rootedStatus =
          cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
            targetRootPath,
            requestedStatus,
          );
        clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath);

        if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
          setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
          resetJavaScriptTypeScriptLanguageServerDocuments();
        }

        return rootedStatus;
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(
          targetRootPath,
          "JavaScript/TypeScript",
          error,
        );
        return null;
      }
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      currentWorkspaceRootRef,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      reportErrorForActiveWorkspaceRoot,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopProjectRuntimes = useCallback(
    async (rootPath?: string) => {
      const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!targetRootPath) {
        return;
      }

      try {
        await workspaceRuntimeLifecycleGateway.disposeWorkspace(targetRootPath);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(
          targetRootPath,
          "Workspace Runtime",
          error,
        );
        await Promise.allSettled([
          stopLanguageServerRuntime(targetRootPath),
          stopJavaScriptTypeScriptLanguageServerRuntime(targetRootPath),
          terminalGateway.stopRoot(targetRootPath),
        ]);
        return;
      }

      const stoppedStatus: LanguageServerRuntimeStatus = {
        kind: "stopped",
        rootPath: targetRootPath,
      };
      cachePhpLanguageServerRuntimeStatus(targetRootPath, stoppedStatus);
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        targetRootPath,
        stoppedStatus,
      );
      clearLanguageServerDiagnosticsForRoot(targetRootPath);
      clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath);

      if (!workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        return;
      }

      setLanguageServerRuntimeStatus(stoppedStatus);
      setLanguageServerRuntimeStatusRoot(targetRootPath);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(stoppedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
      lastLanguageServerCrashRef.current = null;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      cachePhpLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      clearLanguageServerDiagnosticsForRoot,
      currentWorkspaceRootRef,
      lastLanguageServerCrashRef,
      reportErrorForActiveWorkspaceRoot,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      stopJavaScriptTypeScriptLanguageServerRuntime,
      stopLanguageServerRuntime,
      terminalGateway,
      workspaceRuntimeLifecycleGateway,
    ],
  );

  const stopBackgroundProjectRuntimes = useCallback(
    async (
      policy: BackgroundRuntimePolicy,
      activeRootPath: string | null,
      previousRootPath: string | null,
    ) => {
      if (policy === "keepAlive") {
        return;
      }

      const rootPaths =
        policy === "singleActive" || previousRootPath === null
          ? appSettingsRef.current.workspaceTabs.filter(
              (rootPath) => !workspaceRootKeysEqual(rootPath, activeRootPath),
            )
          : previousRootPath &&
              !workspaceRootKeysEqual(previousRootPath, activeRootPath)
            ? [previousRootPath]
            : [];

      await Promise.all(rootPaths.map((rootPath) => stopProjectRuntimes(rootPath)));
    },
    [appSettingsRef, stopProjectRuntimes],
  );

  const startLanguageServer = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      setMessage("Enable IDE Mode to start the PHP language server.");
      return;
    }

    const requestedRoot = workspaceRoot;
    clearManualPhpLanguageServerStop(requestedRoot);

    try {
      const status = await languageServerRuntimeGateway.start(
        requestedRoot,
        phpLanguageServerOptions(workspaceSettingsRef.current),
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      handleLanguageServerRuntimeStatus(status, requestedRoot);
    } catch (error) {
      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        reportLanguageServerError(error);
      }
    }
  }, [
    clearManualPhpLanguageServerStop,
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    languageServerRuntimeGateway,
    reportLanguageServerError,
    setMessage,
    workspaceRoot,
    workspaceSettingsRef,
  ]);

  const stopLanguageServer = useCallback(async () => {
    const targetRootPath = currentWorkspaceRootRef.current;

    if (!targetRootPath) {
      return;
    }

    const status = await stopLanguageServerRuntime(targetRootPath);

    if (status?.kind !== "stopped") {
      return;
    }

    markManualPhpLanguageServerStop(targetRootPath);
  }, [
    currentWorkspaceRootRef,
    markManualPhpLanguageServerStop,
    stopLanguageServerRuntime,
  ]);

  const restartJavaScriptTypeScriptService = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;

    if (currentSettings.javaScriptTypeScriptService === "off") {
      setMessage("Enable JavaScript/TypeScript service to restart it.");
      return;
    }

    const requestedRoot = workspaceRoot;
    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
    await stopJavaScriptTypeScriptLanguageServerRuntime(requestedRoot);

    const plan = await refreshJavaScriptTypeScriptLanguageServerPlan(
      requestedRoot,
      currentSettings.javaScriptTypeScriptVersion,
    );

    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
      return;
    }

    if (plan?.status !== "ready") {
      setMessage(plan?.message ?? "JavaScript/TypeScript service is unavailable.");
      return;
    }

    try {
      const status =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.start(requestedRoot, {
          ...javaScriptTypeScriptLanguageServerOptions(currentSettings),
        });

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        status,
        requestedRoot,
      );
      setMessage("JavaScript/TypeScript service restarted.");
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
    }
  }, [
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceRoot,
    workspaceSettingsRef,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      clearManualPhpLanguageServerStop(workspaceRoot);
    }
  }, [clearManualPhpLanguageServerStop, intelligenceMode, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      return;
    }

    if (!workspaceTrust?.trusted) {
      return;
    }

    if (languageServerPlan?.status !== "ready") {
      return;
    }

    if (
      languageServerRuntimeStatusRoot &&
      !workspaceRootKeysEqual(languageServerRuntimeStatusRoot, workspaceRoot)
    ) {
      return;
    }

    if (
      isLanguageServerActiveForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    const autostartRootKey = normalizedWorkspaceRootKey(workspaceRoot);
    const autostartAttempts =
      phpLanguageServerAutostartAttemptsByRootRef.current[autostartRootKey] ??
      0;

    if (
      isCrashedLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      ) &&
      autostartAttempts === 0
    ) {
      return;
    }

    if (autostartAttempts >= PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS) {
      return;
    }

    if (isPhpLanguageServerManuallyStopped(workspaceRoot)) {
      return;
    }

    if (workspaceRootKeysEqual(autoStartedLanguageServerRootRef.current, workspaceRoot)) {
      return;
    }

    autoStartedLanguageServerRootRef.current = workspaceRoot;
    phpLanguageServerAutostartAttemptsByRootRef.current[autostartRootKey] =
      autostartAttempts + 1;
    languageServerRuntimeGateway
      .start(workspaceRoot, phpLanguageServerOptions(workspaceSettingsRef.current))
      .then((status) => {
        handleLanguageServerRuntimeStatus(status, workspaceRoot);

        if (
          isRunningLanguageServerForWorkspace(
            status,
            status.rootPath ?? null,
            workspaceRoot,
          )
        ) {
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            autostartRootKey
          ];
          return;
        }

        if (
          isLanguageServerActive(status) &&
          !isLanguageServerActiveForWorkspace(
            status,
            status.rootPath ?? null,
            workspaceRoot,
          )
        ) {
          if (
            workspaceRootKeysEqual(
              autoStartedLanguageServerRootRef.current,
              workspaceRoot,
            )
          ) {
            autoStartedLanguageServerRootRef.current = null;
          }

          setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
          return;
        }

        if (!languageServerCrashMessage(status)) {
          return;
        }

        if (
          workspaceRootKeysEqual(
            autoStartedLanguageServerRootRef.current,
            workspaceRoot,
          )
        ) {
          autoStartedLanguageServerRootRef.current = null;
        }

        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      })
      .catch((error) => {
        if (
          workspaceRootKeysEqual(
            autoStartedLanguageServerRootRef.current,
            workspaceRoot,
          )
        ) {
          autoStartedLanguageServerRootRef.current = null;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)) {
          return;
        }

        reportLanguageServerError(error);
        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      });
  }, [
    autoStartedLanguageServerRootRef,
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    isPhpLanguageServerManuallyStopped,
    languageServerPlan,
    languageServerRuntimeGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    phpLanguageServerAutostartAttemptsByRootRef,
    phpLanguageServerAutostartRetryVersion,
    reportLanguageServerError,
    setPhpLanguageServerAutostartRetryVersion,
    workspaceSettings.intelephensePath,
    workspaceSettings.phpBackend,
    workspaceSettings.phpactorPath,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (workspaceSettings.javaScriptTypeScriptService !== "auto") {
      return;
    }

    if (!shouldAutoStartJavaScriptTypeScriptLanguageServer) {
      return;
    }

    if (javaScriptTypeScriptLanguageServerPlan?.status !== "ready") {
      return;
    }

    if (
      isLanguageServerActiveForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    if (
      isCrashedLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    if (
      workspaceRootKeysEqual(
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
        workspaceRoot,
      )
    ) {
      return;
    }

    const requestedRoot = workspaceRoot;
    let cancelled = false;

    void (async () => {
      if (cancelled) {
        return;
      }

      let latestStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      let latestStatusRoot =
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current;

      if (!latestStatus && !latestStatusRoot) {
        const probedStatus = await Promise.race([
          javaScriptTypeScriptLanguageServerRuntimeGateway
            .getStatus(requestedRoot)
            .catch(() => null),
          (async () => {
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await Promise.resolve();
            }

            return null;
          })(),
        ]);

        if (cancelled) {
          return;
        }

        if (probedStatus) {
          latestStatus = probedStatus;
          latestStatusRoot = probedStatus.rootPath ?? null;
        }
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (
        workspaceSettingsRef.current.javaScriptTypeScriptService !== "auto" ||
        !shouldAutoStartJavaScriptTypeScriptLanguageServer
      ) {
        return;
      }

      if (
        latestStatusRoot &&
        !workspaceRootKeysEqual(latestStatusRoot, requestedRoot)
      ) {
        return;
      }

      if (
        isLanguageServerActiveForWorkspace(
          latestStatus,
          latestStatusRoot,
          requestedRoot,
        )
      ) {
        return;
      }

      if (
        isCrashedLanguageServerForWorkspace(
          latestStatus,
          latestStatusRoot,
          requestedRoot,
        )
      ) {
        return;
      }

      if (
        workspaceRootKeysEqual(
          autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
          requestedRoot,
        )
      ) {
        return;
      }

      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current =
        requestedRoot;
      javaScriptTypeScriptLanguageServerRuntimeGateway
        .start(requestedRoot, {
          ...javaScriptTypeScriptLanguageServerOptions(
            workspaceSettingsRef.current,
          ),
        })
        .then((status) => {
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            if (
              workspaceRootKeysEqual(
                autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
                requestedRoot,
              )
            ) {
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
            }

            return;
          }

          if (
            isLanguageServerActive(status) &&
            !isLanguageServerActiveForWorkspace(
              status,
              status.rootPath ?? null,
              requestedRoot,
            )
          ) {
            if (
              workspaceRootKeysEqual(
                autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
                requestedRoot,
              )
            ) {
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
            }

            handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
              runtimeStatusForRequestedRoot(status, requestedRoot),
              requestedRoot,
            );
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            requestedRoot,
          );
        })
        .catch((error) => {
          if (
            workspaceRootKeysEqual(
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
              requestedRoot,
            )
          ) {
            autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
          }

          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "JavaScript/TypeScript",
            error,
          );
        });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    reportErrorForActiveWorkspaceRoot,
    shouldAutoStartJavaScriptTypeScriptLanguageServer,
    workspaceSettings.javaScriptTypeScriptAutoImports,
    workspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition,
    workspaceSettings.javaScriptTypeScriptCodeLens,
    workspaceSettings.javaScriptTypeScriptCompleteFunctionCalls,
    workspaceSettings.javaScriptTypeScriptInlayHints,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceSettings.javaScriptTypeScriptVersion,
    workspaceSettings.javaScriptTypeScriptValidation,
    workspaceRoot,
    workspaceSettingsRef,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (workspaceSettings.javaScriptTypeScriptService !== "off") {
      return;
    }

    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;

    if (
      isLanguageServerActiveForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      ) ||
      isCrashedLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      void stopJavaScriptTypeScriptLanguageServerRuntime(workspaceRoot);
      return;
    }

    clearJavaScriptTypeScriptDiagnosticsForRoot(workspaceRoot);
    resetJavaScriptTypeScriptLanguageServerDocuments();
  }, [
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    if (workspaceRoot) {
      const cachedStatus = cachedLanguageServerRuntimeStatusForRoot(
        languageServerRuntimeStatusByRootRef.current,
        workspaceRoot,
      );

      if (cachedStatus) {
        setLanguageServerRuntimeStatus(cachedStatus);
        setLanguageServerRuntimeStatusRoot(workspaceRoot);
      } else {
        setLanguageServerRuntimeStatus(null);
        setLanguageServerRuntimeStatusRoot(null);
      }

      languageServerRuntimeGateway
        .getStatus(workspaceRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          handleLanguageServerRuntimeStatus(status, workspaceRoot);
        })
        .catch((error) => {
          if (
            !active ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
          ) {
            return;
          }

          setLanguageServerRuntimeStatusRoot(workspaceRoot);
          reportError("Language Server", error);
        });
    } else {
      setLanguageServerRuntimeStatus(null);
      setLanguageServerRuntimeStatusRoot(null);
    }

    languageServerRuntimeGateway
      .subscribeStatus((status) => {
        if (!active) {
          return;
        }

        handleLanguageServerRuntimeStatus(status);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (
          !active ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(workspaceRoot, error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    languageServerRuntimeGateway,
    languageServerRuntimeStatusByRootRef,
    reportError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    if (workspaceRoot) {
      const cachedStatus = cachedLanguageServerRuntimeStatusForRoot(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        workspaceRoot,
      );

      if (cachedStatus) {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(cachedStatus);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
      } else {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      }

      javaScriptTypeScriptLanguageServerRuntimeGateway
        .getStatus(workspaceRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            workspaceRoot,
          );
        })
        .catch((error) => {
          if (
            !active ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
          ) {
            return;
          }

          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
          reportErrorForActiveWorkspaceRoot(
            workspaceRoot,
            "JavaScript/TypeScript",
            error,
          );
        });
    } else {
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
    }

    javaScriptTypeScriptLanguageServerRuntimeGateway
      .subscribeStatus((status) => {
        if (!active) {
          return;
        }

        handleJavaScriptTypeScriptLanguageServerRuntimeStatus(status);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (
          !active ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          workspaceRoot,
          "JavaScript/TypeScript",
          error,
        );
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    reportErrorForActiveWorkspaceRoot,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    workspaceRoot,
  ]);

  return {
    refreshLanguageServerPlan,
    runPhpWorkspaceProbe,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    clearManualPhpLanguageServerStop,
    forgetLanguageServerRuntimeStatuses,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    handleLanguageServerRuntimeStatus,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    stopLanguageServerRuntime,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    stopProjectRuntimes,
    stopBackgroundProjectRuntimes,
    startLanguageServer,
    stopLanguageServer,
    restartJavaScriptTypeScriptService,
  };
}

function phpLanguageServerOptions(settings: WorkspaceSettings) {
  return {
    intelephensePath: settings.intelephensePath,
    phpBackend: settings.phpBackend,
    phpactorPath: settings.phpactorPath,
  };
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

function isLanguageServerActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    isLanguageServerActive(status)
  );
}

function isCrashedLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    status.kind === "crashed"
  );
}

function runtimeStatusRootPath(
  status: LanguageServerRuntimeStatus,
  fallbackRootPath?: string,
): string | null {
  if (status.rootPath) {
    return status.rootPath;
  }

  return status.kind === "stopped" ? (fallbackRootPath ?? null) : null;
}

function runtimeStatusForRequestedRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (status.rootPath && workspaceRootKeysEqual(status.rootPath, rootPath)) {
    return status;
  }

  return { kind: "stopped", rootPath };
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
