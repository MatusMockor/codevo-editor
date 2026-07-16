import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  cachedLanguageServerRuntimeStatusForOwner,
  cacheLanguageServerRuntimeStatusForOwner,
  forgetCachedLanguageServerRuntimeStatus,
} from "../domain/languageServerRuntimeStatusCache";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustState } from "../domain/trust";
import type {
  ProjectRuntimeStopResult,
  WorkspaceRuntimeLifecycleGateway,
} from "../domain/workspaceRuntimeLifecycle";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createLegacyWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
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
  languageServerCrashNoticeGroupKey,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  javaScriptTypeScriptLanguageServerOptions,
} from "./javaScriptTypeScriptLanguageServerSettings";

const PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS = 2;

export interface LanguageServerRuntimeLifecycleDependencies {
  workspaceRoot: string | null;
  workspaceRuntimeOwner?: WorkspaceRuntimeOwner | null;
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

  clearLanguageServerDiagnosticsForRoot: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  clearJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareLanguageServerDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetLanguageServerDocuments: () => void;
  resetJavaScriptTypeScriptLanguageServerDocuments: () => void;
  isLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  reportError: (source: string, error: unknown) => void;
  reportLanguageServerCrash: (error: unknown) => void;
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
  refreshLanguageServerPlan: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerPlan | null>;
  runPhpWorkspaceProbe: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<void>;
  refreshJavaScriptTypeScriptLanguageServerPlan: (
    rootPath: string,
    typeScriptVersionPreference?: WorkspaceSettings["javaScriptTypeScriptVersion"],
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerPlan | null>;
  clearManualPhpLanguageServerStop: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  forgetLanguageServerRuntimeStatuses: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
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
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  handleJavaScriptTypeScriptLanguageServerRuntimeStatus: (
    status: LanguageServerRuntimeStatus,
    fallbackRootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  stopLanguageServerRuntime: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopJavaScriptTypeScriptLanguageServerRuntime: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopProjectRuntimes: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<ProjectRuntimeStopResult>;
  stopBackgroundProjectRuntimes: (
    policy: BackgroundRuntimePolicy,
    activeRootPath: string | null,
    previousRootPath: string | null,
  ) => Promise<void>;
  startLanguageServer: () => Promise<void>;
  stopLanguageServer: () => Promise<void>;
  restartJavaScriptTypeScriptService: () => Promise<void>;
}

interface LanguageServerRuntimeStatusFence {
  authority: "command" | "snapshot";
  commandSequence: number;
  subscriptionSequence: number;
}

export function useLanguageServerRuntimeLifecycle(
  dependencies: LanguageServerRuntimeLifecycleDependencies,
): LanguageServerRuntimeLifecycle {
  const {
    workspaceRoot,
    workspaceRuntimeOwner,
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
    resetLanguageServerDiagnosticsForRoot,
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    prepareLanguageServerDiagnosticsForRuntimeStart,
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    resetLanguageServerDocuments,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    isLanguageServerSessionCurrentForRoot,
    reportError,
    reportLanguageServerCrash,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const currentRuntimeOwner = useMemo(() => {
    if (workspaceRuntimeOwner) {
      return workspaceRuntimeOwner;
    }

    if (!workspaceRoot) {
      return null;
    }

    return createLegacyWorkspaceRuntimeOwner(workspaceRoot);
  }, [
    workspaceRoot,
    workspaceRuntimeOwner?.executionRoot,
    workspaceRuntimeOwner?.ownerKey,
  ]);
  const currentRuntimeOwnerRef = useRef(currentRuntimeOwner);
  currentRuntimeOwnerRef.current = currentRuntimeOwner;
  const ownerRevisionByKeyRef = useRef<Record<string, number>>({});
  const languageServerRuntimeStatusSequenceByOwnerRef = useRef<
    Record<string, number>
  >({});
  const languageServerRuntimeCommandSequenceByOwnerRef = useRef<
    Record<string, number>
  >({});
  const previousRuntimeOwnerRef = useRef(currentRuntimeOwner);
  const retainedRuntimeAliasesByOwnerRef = useRef<
    Record<string, { revision: number; rootPaths: string[] }>
  >({});
  const admittedRuntimeOwnersByRootRef = useRef<
    Array<{
      owner: WorkspaceRuntimeOwner;
      revision: number;
      rootPath: string;
    }>
  >([]);
  const [ownerRevisionVersion, setOwnerRevisionVersion] = useState(0);

  useEffect(() => {
    const previousOwner = previousRuntimeOwnerRef.current;
    previousRuntimeOwnerRef.current = currentRuntimeOwner;

    if (!workspaceRuntimeOwner || !currentRuntimeOwner) {
      return;
    }

    const currentOwnerRevision =
      ownerRevisionByKeyRef.current[currentRuntimeOwner.ownerKey] ?? 0;

    for (const admittedOwner of admittedRuntimeOwnersByRootRef.current) {
      if (admittedOwner.owner.ownerKey !== currentRuntimeOwner.ownerKey) {
        continue;
      }

      admittedOwner.owner = currentRuntimeOwner;
      admittedOwner.revision = currentOwnerRevision;
    }

    const admittedExecutionRoot = admittedRuntimeOwnersByRootRef.current.find(
      ({ rootPath }) =>
        workspaceRootKeysEqual(rootPath, currentRuntimeOwner.executionRoot),
    );

    if (admittedExecutionRoot) {
      admittedExecutionRoot.owner = currentRuntimeOwner;
      admittedExecutionRoot.revision = currentOwnerRevision;
    }

    if (!admittedExecutionRoot) {
      admittedRuntimeOwnersByRootRef.current.push({
        owner: currentRuntimeOwner,
        revision: currentOwnerRevision,
        rootPath: currentRuntimeOwner.executionRoot,
      });
    }

    if (!previousOwner) {
      return;
    }

    if (previousOwner.ownerKey !== currentRuntimeOwner.ownerKey) {
      return;
    }

    if (
      workspaceRootKeysEqual(
        previousOwner.executionRoot,
        currentRuntimeOwner.executionRoot,
      )
    ) {
      return;
    }

    const revision =
      ownerRevisionByKeyRef.current[currentRuntimeOwner.ownerKey] ?? 0;
    const retainedAliases =
      retainedRuntimeAliasesByOwnerRef.current[currentRuntimeOwner.ownerKey];
    const rootPaths =
      retainedAliases?.revision === revision ? retainedAliases.rootPaths : [];

    if (
      rootPaths.some((rootPath) =>
        workspaceRootKeysEqual(rootPath, previousOwner.executionRoot),
      )
    ) {
      return;
    }

    retainedRuntimeAliasesByOwnerRef.current[currentRuntimeOwner.ownerKey] = {
      revision,
      rootPaths: [...rootPaths, previousOwner.executionRoot],
    };
  }, [currentRuntimeOwner, ownerRevisionVersion, workspaceRuntimeOwner]);

  const admittedRuntimeOwnerForRoot = useCallback(
    (rootPath: string): WorkspaceRuntimeOwner | undefined => {
      if (!workspaceRuntimeOwner) {
        return undefined;
      }

      return admittedRuntimeOwnersByRootRef.current.find((admittedOwner) =>
        workspaceRootKeysEqual(admittedOwner.rootPath, rootPath),
      )?.owner;
    },
    [workspaceRuntimeOwner],
  );

  const runtimeOwnerForRoot = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      if (owner) {
        return owner;
      }

      if (
        currentRuntimeOwnerRef.current &&
        workspaceRootKeysEqual(
          currentRuntimeOwnerRef.current.executionRoot,
          rootPath,
        )
      ) {
        return currentRuntimeOwnerRef.current;
      }

      return createLegacyWorkspaceRuntimeOwner(rootPath);
    },
    [currentRuntimeOwnerRef],
  );

  const isCurrentRuntimeOwner = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      currentRuntimeOwnerRef.current?.ownerKey === owner.ownerKey,
    [currentRuntimeOwnerRef],
  );

  const latestRuntimeOwner = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      if (currentRuntimeOwnerRef.current?.ownerKey === owner.ownerKey) {
        return currentRuntimeOwnerRef.current;
      }

      return owner;
    },
    [currentRuntimeOwnerRef],
  );

  const ownerRevision = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      ownerRevisionByKeyRef.current[owner.ownerKey] ?? 0,
    [ownerRevisionByKeyRef],
  );

  const isOwnerRevisionCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, revision: number) =>
      ownerRevision(owner) === revision,
    [ownerRevision],
  );

  const languageServerRuntimeStatusSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      languageServerRuntimeStatusSequenceByOwnerRef.current[owner.ownerKey] ?? 0,
    [languageServerRuntimeStatusSequenceByOwnerRef],
  );

  const advanceLanguageServerRuntimeStatusSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      languageServerRuntimeStatusSequenceByOwnerRef.current[owner.ownerKey] =
        languageServerRuntimeStatusSequence(owner) + 1;
    },
    [
      languageServerRuntimeStatusSequence,
      languageServerRuntimeStatusSequenceByOwnerRef,
    ],
  );

  const languageServerRuntimeCommandSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      languageServerRuntimeCommandSequenceByOwnerRef.current[owner.ownerKey] ??
      0,
    [languageServerRuntimeCommandSequenceByOwnerRef],
  );

  const advanceLanguageServerRuntimeCommandSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      const sequence = languageServerRuntimeCommandSequence(owner) + 1;
      languageServerRuntimeCommandSequenceByOwnerRef.current[owner.ownerKey] =
        sequence;
      return sequence;
    },
    [
      languageServerRuntimeCommandSequence,
      languageServerRuntimeCommandSequenceByOwnerRef,
    ],
  );

  const isLanguageServerRuntimeStatusSequenceCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, sequence: number) =>
      languageServerRuntimeStatusSequence(owner) === sequence,
    [languageServerRuntimeStatusSequence],
  );

  const isLanguageServerRuntimeStatusFenceCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, fence: LanguageServerRuntimeStatusFence) =>
      isLanguageServerRuntimeStatusSequenceCurrent(
        owner,
        fence.subscriptionSequence,
      ) &&
      languageServerRuntimeCommandSequence(owner) === fence.commandSequence,
    [
      isLanguageServerRuntimeStatusSequenceCurrent,
      languageServerRuntimeCommandSequence,
    ],
  );

  const acceptLanguageServerRuntimeCommandFence = useCallback(
    (owner: WorkspaceRuntimeOwner, fence: LanguageServerRuntimeStatusFence) => {
      if (!isLanguageServerRuntimeStatusFenceCurrent(owner, fence)) {
        return false;
      }

      advanceLanguageServerRuntimeCommandSequence(owner);
      return true;
    },
    [
      advanceLanguageServerRuntimeCommandSequence,
      isLanguageServerRuntimeStatusFenceCurrent,
    ],
  );

  const isAdmittedRuntimeOwnerForRoot = useCallback(
    (
      rootPath: string,
      owner: WorkspaceRuntimeOwner,
      revision: number,
    ): boolean => {
      const currentOwner = currentRuntimeOwnerRef.current;

      if (
        currentOwner &&
        workspaceRootKeysEqual(currentOwner.executionRoot, rootPath) &&
        currentOwner.ownerKey !== owner.ownerKey
      ) {
        return false;
      }

      const admittedOwner = admittedRuntimeOwnersByRootRef.current.find(
        (candidate) => workspaceRootKeysEqual(candidate.rootPath, rootPath),
      );

      if (!admittedOwner) {
        return false;
      }

      return (
        admittedOwner.owner.ownerKey === owner.ownerKey &&
        admittedOwner.revision === revision &&
        isOwnerRevisionCurrent(owner, revision)
      );
    },
    [isOwnerRevisionCurrent],
  );

  const retainedRuntimeStatusForOwner = useCallback(
    (
      status: LanguageServerRuntimeStatus,
      owner: WorkspaceRuntimeOwner,
      revision: number,
    ): LanguageServerRuntimeStatus | null => {
      if (!isOwnerRevisionCurrent(owner, revision)) {
        return null;
      }

      const currentOwner = currentRuntimeOwnerRef.current;

      if (!currentOwner || currentOwner.ownerKey !== owner.ownerKey) {
        return null;
      }

      const statusRootPath = runtimeStatusRootPath(status, owner.executionRoot);

      if (!statusRootPath) {
        return null;
      }

      const isExecutionRoot = workspaceRootKeysEqual(
        statusRootPath,
        owner.executionRoot,
      );
      const retainedAliases =
        retainedRuntimeAliasesByOwnerRef.current[owner.ownerKey];
      const isRetainedAlias =
        retainedAliases?.revision === revision &&
        retainedAliases.rootPaths.some((rootPath) =>
          workspaceRootKeysEqual(rootPath, statusRootPath),
        );

      if (!isExecutionRoot && !isRetainedAlias) {
        return null;
      }

      return {
        ...status,
        rootPath: currentOwner.executionRoot,
      };
    },
    [isOwnerRevisionCurrent],
  );

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

      try {
        const plan = await languageServerGateway.planPhpLanguageServer(
          rootPath,
          phpLanguageServerOptions(workspaceSettingsRef.current),
        );

        if (
          isOwnerRevisionCurrent(requestedOwner, requestedRevision) &&
          isCurrentRuntimeOwner(requestedOwner)
        ) {
          setLanguageServerPlan(plan);
        }
        return plan;
      } catch (error) {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return null;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return null;
        }

        setLanguageServerPlan(null);
        reportError("Language Server", error);
        return null;
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      languageServerGateway,
      ownerRevision,
      reportError,
      runtimeOwnerForRoot,
      setLanguageServerPlan,
      workspaceSettingsRef,
    ],
  );

  const runPhpWorkspaceProbe = useCallback(
    async (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

      try {
        const tools = await phpToolGateway.detectPhpTools(rootPath);
        const phpSetupNoticeGroup = `phpactor-setup:${rootPath}`;

        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return;
        }

        setPhpTools(tools);

        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, []),
          );
          await refreshLanguageServerPlan(rootPath, requestedOwner);
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
        await refreshLanguageServerPlan(rootPath, requestedOwner);
      } catch (error) {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(rootPath, "PHP Tools", error);
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      ownerRevision,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      runtimeOwnerForRoot,
      setNotices,
      setPhpTools,
    ],
  );

  const refreshJavaScriptTypeScriptLanguageServerPlan = useCallback(
    async (
      rootPath: string,
      typeScriptVersionPreference =
        workspaceSettingsRef.current.javaScriptTypeScriptVersion,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

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

        if (
          isOwnerRevisionCurrent(requestedOwner, requestedRevision) &&
          isCurrentRuntimeOwner(requestedOwner)
        ) {
          setJavaScriptTypeScriptLanguageServerPlan(plan);
        }

        return plan;
      } catch (error) {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return null;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return null;
        }

        setJavaScriptTypeScriptLanguageServerPlan(null);
        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
        return null;
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      languageServerGateway,
      ownerRevision,
      reportErrorForActiveWorkspaceRoot,
      runtimeOwnerForRoot,
      setJavaScriptTypeScriptLanguageServerPlan,
      workspaceSettingsRef,
    ],
  );

  const cacheJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (
      rootPath: string,
      status: LanguageServerRuntimeStatus,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      return cacheLanguageServerRuntimeStatusForOwner(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        runtimeOwnerForRoot(rootPath, owner),
        status,
      );
    },
    [javaScriptTypeScriptRuntimeStatusByRootRef, runtimeOwnerForRoot],
  );

  const cachePhpLanguageServerRuntimeStatus = useCallback(
    (
      rootPath: string,
      status: LanguageServerRuntimeStatus,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      return cacheLanguageServerRuntimeStatusForOwner(
        languageServerRuntimeStatusByRootRef.current,
        runtimeOwnerForRoot(rootPath, owner),
        status,
      );
    },
    [languageServerRuntimeStatusByRootRef, runtimeOwnerForRoot],
  );

  const clearManualPhpLanguageServerStop = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      manuallyStoppedPhpLanguageServerRootsRef.current.delete(
        runtimeOwnerForRoot(rootPath, owner).ownerKey,
      );
    },
    [manuallyStoppedPhpLanguageServerRootsRef, runtimeOwnerForRoot],
  );

  const markManualPhpLanguageServerStop = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      manuallyStoppedPhpLanguageServerRootsRef.current.add(
        runtimeOwnerForRoot(rootPath, owner).ownerKey,
      );
    },
    [manuallyStoppedPhpLanguageServerRootsRef, runtimeOwnerForRoot],
  );

  const isPhpLanguageServerManuallyStopped = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) =>
      manuallyStoppedPhpLanguageServerRootsRef.current.has(
        runtimeOwnerForRoot(rootPath, owner).ownerKey,
      ),
    [manuallyStoppedPhpLanguageServerRootsRef, runtimeOwnerForRoot],
  );

  const forgetLanguageServerRuntimeStatuses = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      const targetOwner = runtimeOwnerForRoot(rootPath, owner);
      ownerRevisionByKeyRef.current[targetOwner.ownerKey] =
        ownerRevision(targetOwner) + 1;
      setOwnerRevisionVersion((current) => current + 1);
      clearManualPhpLanguageServerStop(rootPath, targetOwner);
      forgetCachedLanguageServerRuntimeStatus(
        languageServerRuntimeStatusByRootRef.current,
        targetOwner,
      );
      forgetCachedLanguageServerRuntimeStatus(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        targetOwner,
      );
      delete phpLanguageServerAutostartAttemptsByRootRef.current[
        targetOwner.ownerKey
      ];

      if (autoStartedLanguageServerRootRef.current === targetOwner.ownerKey) {
        autoStartedLanguageServerRootRef.current = null;
      }

      if (
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
        targetOwner.ownerKey
      ) {
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
      }
    },
    [
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      autoStartedLanguageServerRootRef,
      clearManualPhpLanguageServerStop,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      ownerRevision,
      ownerRevisionByKeyRef,
      phpLanguageServerAutostartAttemptsByRootRef,
      runtimeOwnerForRoot,
      setOwnerRevisionVersion,
    ],
  );

  const isOpenWorkspaceRuntimeRoot = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      if (
        owner &&
        isCurrentRuntimeOwner(owner)
      ) {
        return true;
      }

      if (workspaceRootKeysEqual(rootPath, currentWorkspaceRootRef.current)) {
        return true;
      }

      return appSettingsRef.current.workspaceTabs.some((tabPath) =>
        workspaceRootKeysEqual(tabPath, rootPath),
      );
    },
    [appSettingsRef, currentWorkspaceRootRef, isCurrentRuntimeOwner],
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
      const currentRuntimeStatus = cachedLanguageServerRuntimeStatusForOwner(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        runtimeOwnerForRoot(rootPath),
      );

      if (currentRuntimeStatus) {
        return isRunningLanguageServerSessionForWorkspace(
          currentRuntimeStatus,
          currentRuntimeStatus.rootPath ?? null,
          rootPath,
          sessionId,
        );
      }

      if (workspaceRuntimeOwner) {
        return false;
      }

      const legacyRuntimeStatus = workspaceRootKeysEqual(
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? javaScriptTypeScriptLanguageServerRuntimeStatusRef.current
        : null;

      return isRunningLanguageServerSessionForWorkspace(
        legacyRuntimeStatus,
        legacyRuntimeStatus?.rootPath ??
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      );
    },
    [
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      runtimeOwnerForRoot,
      workspaceRuntimeOwner,
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
    (
      status: LanguageServerRuntimeStatus,
      fallbackRootPath?: string,
      owner?: WorkspaceRuntimeOwner,
      revision?: number,
      fence?: LanguageServerRuntimeStatusFence,
    ): boolean => {
      if (
        owner &&
        revision !== undefined &&
        !isOwnerRevisionCurrent(owner, revision)
      ) {
        return false;
      }

      const statusRootPath = runtimeStatusRootPath(
        status,
        owner?.executionRoot ?? fallbackRootPath,
      );

      if (!statusRootPath) {
        return false;
      }

      const statusOwner = latestRuntimeOwner(
        runtimeOwnerForRoot(statusRootPath, owner),
      );
      const ownedRootPath = statusOwner.executionRoot;

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath, statusOwner)) {
        return false;
      }

      if (
        fence &&
        !isLanguageServerRuntimeStatusFenceCurrent(statusOwner, fence)
      ) {
        return false;
      }

      if (!fence) {
        advanceLanguageServerRuntimeStatusSequence(statusOwner);
      }

      if (fence?.authority === "command") {
        acceptLanguageServerRuntimeCommandFence(statusOwner, fence);
      }

      const rootedStatus = cachePhpLanguageServerRuntimeStatus(
        ownedRootPath,
        status,
        statusOwner,
      );
      const crash = languageServerCrashMessage(status);

      if (status.kind === "starting" || status.kind === "running") {
        clearManualPhpLanguageServerStop(ownedRootPath, statusOwner);
      }

      if (!isCurrentRuntimeOwner(statusOwner)) {
        if (status.kind !== "running") {
          resetLanguageServerDiagnosticsForRoot(ownedRootPath, statusOwner);
        }

        return true;
      }

      setLanguageServerRuntimeStatus(rootedStatus);
      setLanguageServerRuntimeStatusRoot(ownedRootPath);

      if (status.kind !== "running") {
        resetLanguageServerDiagnosticsForRoot(ownedRootPath, statusOwner);
      }

      if (!crash) {
        const previousCrash = lastLanguageServerCrashRef.current;
        if (previousCrash) {
          setMessage((current) => (current === previousCrash ? null : current));
        }
        lastLanguageServerCrashRef.current = null;

        if (status.kind !== "running") {
          return true;
        }

        const crashNoticeGroup =
          languageServerCrashNoticeGroupKey(ownedRootPath);
        if (!crashNoticeGroup) {
          return true;
        }

        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, crashNoticeGroup, []),
        );
        return true;
      }

      reportLanguageServerCrash(crash);
      return true;
    },
    [
      cachePhpLanguageServerRuntimeStatus,
      advanceLanguageServerRuntimeStatusSequence,
      acceptLanguageServerRuntimeCommandFence,
      clearManualPhpLanguageServerStop,
      currentWorkspaceRootRef,
      isOpenWorkspaceRuntimeRoot,
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      isLanguageServerRuntimeStatusFenceCurrent,
      lastLanguageServerCrashRef,
      latestRuntimeOwner,
      reportLanguageServerCrash,
      resetLanguageServerDiagnosticsForRoot,
      runtimeOwnerForRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      setMessage,
      setNotices,
    ],
  );

  const handleJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (
      status: LanguageServerRuntimeStatus,
      fallbackRootPath?: string,
      owner?: WorkspaceRuntimeOwner,
      revision?: number,
    ) => {
      if (
        owner &&
        revision !== undefined &&
        !isOwnerRevisionCurrent(owner, revision)
      ) {
        return;
      }

      const statusRootPath = runtimeStatusRootPath(
        status,
        owner?.executionRoot ?? fallbackRootPath,
      );

      if (!statusRootPath) {
        return;
      }

      const statusOwner = latestRuntimeOwner(
        runtimeOwnerForRoot(statusRootPath, owner),
      );
      const ownedRootPath = statusOwner.executionRoot;

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath, statusOwner)) {
        return;
      }

      const rootedStatus = cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        ownedRootPath,
        status,
        statusOwner,
      );
      const crash = languageServerCrashMessage(status);

      if (!isCurrentRuntimeOwner(statusOwner)) {
        if (status.kind !== "running") {
          resetJavaScriptTypeScriptDiagnosticsForRoot(
            ownedRootPath,
            statusOwner,
          );
        }

        return;
      }

      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current = rootedStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        ownedRootPath;
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(ownedRootPath);

      if (status.kind !== "running") {
        resetJavaScriptTypeScriptDiagnosticsForRoot(
          ownedRootPath,
          statusOwner,
        );
      }

      if (!crash) {
        return;
      }

      reportError("JavaScript/TypeScript", crash);
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      currentWorkspaceRootRef,
      isOpenWorkspaceRuntimeRoot,
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      latestRuntimeOwner,
      reportError,
      resetJavaScriptTypeScriptDiagnosticsForRoot,
      runtimeOwnerForRoot,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopLanguageServerRuntime = useCallback(
    async (rootPath?: string, owner?: WorkspaceRuntimeOwner) => {
      const requestedRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!requestedRootPath) {
        return null;
      }

      const targetOwner = runtimeOwnerForRoot(requestedRootPath, owner);
      const targetRootPath = targetOwner.executionRoot;
      const requestedRevision = ownerRevision(targetOwner);
      const requestedFence: LanguageServerRuntimeStatusFence = {
        authority: "command",
        commandSequence:
          advanceLanguageServerRuntimeCommandSequence(targetOwner),
        subscriptionSequence: languageServerRuntimeStatusSequence(targetOwner),
      };

      try {
        const status = await languageServerRuntimeGateway.stop(targetRootPath);

        if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
          return null;
        }

        if (
          !acceptLanguageServerRuntimeCommandFence(
            targetOwner,
            requestedFence,
          )
        ) {
          return null;
        }

        const completionOwner = latestRuntimeOwner(targetOwner);
        const completionRootPath = completionOwner.executionRoot;
        const requestedStatus = runtimeStatusForRequestedRoot(
          status,
          completionRootPath,
        );
        const rootedStatus = cachePhpLanguageServerRuntimeStatus(
          completionRootPath,
          requestedStatus,
          completionOwner,
        );
        clearLanguageServerDiagnosticsForRoot(
          completionRootPath,
          completionOwner,
        );

        if (isCurrentRuntimeOwner(completionOwner)) {
          setLanguageServerRuntimeStatus(rootedStatus);
          setLanguageServerRuntimeStatusRoot(completionRootPath);
          lastLanguageServerCrashRef.current = null;
          resetLanguageServerDocuments();
        }

        return rootedStatus;
      } catch (error) {
        if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
          return null;
        }

        if (
          !isLanguageServerRuntimeStatusFenceCurrent(
            targetOwner,
            requestedFence,
          )
        ) {
          return null;
        }

        if (!isCurrentRuntimeOwner(targetOwner)) {
          return null;
        }

        reportLanguageServerError(error);
        return null;
      }
    },
    [
      acceptLanguageServerRuntimeCommandFence,
      advanceLanguageServerRuntimeCommandSequence,
      cachePhpLanguageServerRuntimeStatus,
      clearLanguageServerDiagnosticsForRoot,
      currentWorkspaceRootRef,
      isCurrentRuntimeOwner,
      isLanguageServerRuntimeStatusFenceCurrent,
      isOwnerRevisionCurrent,
      languageServerRuntimeGateway,
      languageServerRuntimeStatusSequence,
      lastLanguageServerCrashRef,
      latestRuntimeOwner,
      ownerRevision,
      reportLanguageServerError,
      resetLanguageServerDocuments,
      runtimeOwnerForRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopJavaScriptTypeScriptLanguageServerRuntime = useCallback(
    async (
      rootPath?: string,
      owner?: WorkspaceRuntimeOwner,
      resetDiagnosticsLifecycle = false,
    ) => {
      const requestedRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!requestedRootPath) {
        return null;
      }

      const targetOwner = runtimeOwnerForRoot(requestedRootPath, owner);
      const targetRootPath = targetOwner.executionRoot;
      const requestedRevision = ownerRevision(targetOwner);

      try {
        const status =
          await javaScriptTypeScriptLanguageServerRuntimeGateway.stop(
            targetRootPath,
          );

        if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
          return null;
        }

        const completionOwner = latestRuntimeOwner(targetOwner);
        const completionRootPath = completionOwner.executionRoot;
        const requestedStatus = runtimeStatusForRequestedRoot(
          status,
          completionRootPath,
        );
        const rootedStatus =
          cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
            completionRootPath,
            requestedStatus,
            completionOwner,
          );
        if (resetDiagnosticsLifecycle) {
          resetJavaScriptTypeScriptDiagnosticsForRoot(
            completionRootPath,
            completionOwner,
          );
        }

        if (!resetDiagnosticsLifecycle) {
          clearJavaScriptTypeScriptDiagnosticsForRoot(
            completionRootPath,
            completionOwner,
          );
        }

        if (isCurrentRuntimeOwner(completionOwner)) {
          setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
            completionRootPath,
          );
          resetJavaScriptTypeScriptLanguageServerDocuments();
        }

        return rootedStatus;
      } catch (error) {
        if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
          return null;
        }

        if (!isCurrentRuntimeOwner(targetOwner)) {
          return null;
        }

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
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      latestRuntimeOwner,
      ownerRevision,
      reportErrorForActiveWorkspaceRoot,
      resetJavaScriptTypeScriptDiagnosticsForRoot,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      runtimeOwnerForRoot,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    ],
  );

  const stopProjectRuntimes = useCallback(
    async (
      rootPath?: string,
      owner?: WorkspaceRuntimeOwner,
    ): Promise<ProjectRuntimeStopResult> => {
      const requestedRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!requestedRootPath) {
        return "stopped";
      }

      const targetOwner = runtimeOwnerForRoot(requestedRootPath, owner);
      const targetRootPath = targetOwner.executionRoot;
      const requestedRevision = ownerRevision(targetOwner);
      const requestedFence: LanguageServerRuntimeStatusFence = {
        authority: "command",
        commandSequence:
          advanceLanguageServerRuntimeCommandSequence(targetOwner),
        subscriptionSequence: languageServerRuntimeStatusSequence(targetOwner),
      };

      try {
        await workspaceRuntimeLifecycleGateway.disposeWorkspace(targetRootPath);
      } catch (error) {
        if (
          workspaceRuntimeOwner &&
          !isAdmittedRuntimeOwnerForRoot(
            targetRootPath,
            targetOwner,
            requestedRevision,
          )
        ) {
          return "stale";
        }

        const [phpStop, javaScriptTypeScriptStop, terminalStop] =
          await Promise.allSettled([
            languageServerRuntimeGateway.stop(targetRootPath),
            javaScriptTypeScriptLanguageServerRuntimeGateway.stop(
              targetRootPath,
            ),
            terminalGateway.stopRoot(targetRootPath),
          ]);

        if (
          workspaceRuntimeOwner &&
          !isAdmittedRuntimeOwnerForRoot(
            targetRootPath,
            targetOwner,
            requestedRevision,
          )
        ) {
          return "stale";
        }

        if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
          return "stale";
        }

        const stoppedStatus: LanguageServerRuntimeStatus = {
          kind: "stopped",
          rootPath: targetRootPath,
        };
        const phpStopAccepted =
          phpStop.status === "fulfilled" &&
          acceptLanguageServerRuntimeCommandFence(targetOwner, requestedFence);

        if (phpStopAccepted) {
          cachePhpLanguageServerRuntimeStatus(
            targetRootPath,
            stoppedStatus,
            targetOwner,
          );
          clearLanguageServerDiagnosticsForRoot(targetRootPath, targetOwner);
        }

        if (javaScriptTypeScriptStop.status === "fulfilled") {
          cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
            targetRootPath,
            stoppedStatus,
            targetOwner,
          );
          clearJavaScriptTypeScriptDiagnosticsForRoot(
            targetRootPath,
            targetOwner,
          );
        }

        const fallbackResult =
          phpStop.status === "fulfilled" &&
          javaScriptTypeScriptStop.status === "fulfilled" &&
          terminalStop.status === "fulfilled"
            ? "stopped"
            : "incomplete";

        if (!isCurrentRuntimeOwner(targetOwner)) {
          return fallbackResult;
        }

        if (phpStopAccepted) {
          setLanguageServerRuntimeStatus(stoppedStatus);
          setLanguageServerRuntimeStatusRoot(targetRootPath);
          lastLanguageServerCrashRef.current = null;
          resetLanguageServerDocuments();
        }

        if (javaScriptTypeScriptStop.status === "fulfilled") {
          setJavaScriptTypeScriptLanguageServerRuntimeStatus(stoppedStatus);
          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
            targetRootPath,
          );
          resetJavaScriptTypeScriptLanguageServerDocuments();
        }

        reportErrorForActiveWorkspaceRoot(
          targetRootPath,
          "Workspace Runtime",
          error,
        );
        return fallbackResult;
      }

      if (!isOwnerRevisionCurrent(targetOwner, requestedRevision)) {
        return "stale";
      }

      const completionOwner = latestRuntimeOwner(targetOwner);
      const completionRootPath = completionOwner.executionRoot;
      const phpStopAccepted = acceptLanguageServerRuntimeCommandFence(
        targetOwner,
        requestedFence,
      );

      const stoppedStatus: LanguageServerRuntimeStatus = {
        kind: "stopped",
        rootPath: completionRootPath,
      };
      if (phpStopAccepted) {
        cachePhpLanguageServerRuntimeStatus(
          completionRootPath,
          stoppedStatus,
          completionOwner,
        );
      }
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        completionRootPath,
        stoppedStatus,
        completionOwner,
      );
      if (phpStopAccepted) {
        clearLanguageServerDiagnosticsForRoot(
          completionRootPath,
          completionOwner,
        );
      }
      clearJavaScriptTypeScriptDiagnosticsForRoot(
        completionRootPath,
        completionOwner,
      );

      if (!isCurrentRuntimeOwner(completionOwner)) {
        return "stopped";
      }

      if (phpStopAccepted) {
        setLanguageServerRuntimeStatus(stoppedStatus);
        setLanguageServerRuntimeStatusRoot(completionRootPath);
        lastLanguageServerCrashRef.current = null;
        resetLanguageServerDocuments();
      }
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(stoppedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
        completionRootPath,
      );
      resetJavaScriptTypeScriptLanguageServerDocuments();
      return "stopped";
    },
    [
      acceptLanguageServerRuntimeCommandFence,
      advanceLanguageServerRuntimeCommandSequence,
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      cachePhpLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      clearLanguageServerDiagnosticsForRoot,
      currentWorkspaceRootRef,
      isCurrentRuntimeOwner,
      isAdmittedRuntimeOwnerForRoot,
      isOwnerRevisionCurrent,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      lastLanguageServerCrashRef,
      languageServerRuntimeGateway,
      languageServerRuntimeStatusSequence,
      latestRuntimeOwner,
      ownerRevision,
      reportErrorForActiveWorkspaceRoot,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      runtimeOwnerForRoot,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      terminalGateway,
      workspaceRuntimeOwner,
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

      await Promise.all(
        rootPaths.map((rootPath) =>
          stopProjectRuntimes(
            rootPath,
            admittedRuntimeOwnerForRoot(rootPath),
          ),
        ),
      );
    },
    [admittedRuntimeOwnerForRoot, appSettingsRef, stopProjectRuntimes],
  );

  const startLanguageServer = useCallback(async () => {
    if (!currentRuntimeOwner) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      setMessage("Enable IDE Mode to start the PHP language server.");
      return;
    }

    const requestedOwner = currentRuntimeOwner;
    const requestedRoot = requestedOwner.executionRoot;
    const requestedRevision = ownerRevision(requestedOwner);
    const requestedFence: LanguageServerRuntimeStatusFence = {
      authority: "command",
      commandSequence:
        advanceLanguageServerRuntimeCommandSequence(requestedOwner),
      subscriptionSequence:
        languageServerRuntimeStatusSequence(requestedOwner),
    };
    clearManualPhpLanguageServerStop(requestedRoot, requestedOwner);
    prepareLanguageServerDiagnosticsForRuntimeStart(
      requestedRoot,
      requestedOwner,
    );

    try {
      const status = await languageServerRuntimeGateway.start(
        requestedRoot,
        phpLanguageServerOptions(workspaceSettingsRef.current),
      );
      handleLanguageServerRuntimeStatus(
        status,
        requestedRoot,
        requestedOwner,
        requestedRevision,
        requestedFence,
      );
    } catch (error) {
      if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
        return;
      }

      if (
        !isLanguageServerRuntimeStatusFenceCurrent(requestedOwner, requestedFence)
      ) {
        return;
      }

      if (isCurrentRuntimeOwner(requestedOwner)) {
        reportLanguageServerError(error);
      }
    }
  }, [
    clearManualPhpLanguageServerStop,
    advanceLanguageServerRuntimeCommandSequence,
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    isCurrentRuntimeOwner,
    isLanguageServerRuntimeStatusFenceCurrent,
    isOwnerRevisionCurrent,
    languageServerRuntimeGateway,
    languageServerRuntimeStatusSequence,
    ownerRevision,
    prepareLanguageServerDiagnosticsForRuntimeStart,
    reportLanguageServerError,
    setMessage,
    workspaceSettingsRef,
  ]);

  const stopLanguageServer = useCallback(async () => {
    const targetOwner = currentRuntimeOwner;

    if (!targetOwner) {
      return;
    }

    const targetRootPath = targetOwner.executionRoot;
    const status = await stopLanguageServerRuntime(targetRootPath, targetOwner);

    if (status?.kind !== "stopped") {
      return;
    }

    markManualPhpLanguageServerStop(targetRootPath, targetOwner);
  }, [
    currentRuntimeOwner,
    markManualPhpLanguageServerStop,
    stopLanguageServerRuntime,
  ]);

  const restartJavaScriptTypeScriptService = useCallback(async () => {
    if (!currentRuntimeOwner) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;

    if (currentSettings.javaScriptTypeScriptService === "off") {
      setMessage("Enable JavaScript/TypeScript service to restart it.");
      return;
    }

    const requestedOwner = currentRuntimeOwner;
    const requestedRoot = requestedOwner.executionRoot;
    const requestedRevision = ownerRevision(requestedOwner);
    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
    await stopJavaScriptTypeScriptLanguageServerRuntime(
      requestedRoot,
      requestedOwner,
      true,
    );

    if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
      return;
    }

    const plan = await refreshJavaScriptTypeScriptLanguageServerPlan(
      requestedRoot,
      currentSettings.javaScriptTypeScriptVersion,
      requestedOwner,
    );

    if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
      return;
    }

    if (!isCurrentRuntimeOwner(requestedOwner)) {
      return;
    }

    if (plan?.status !== "ready") {
      setMessage(plan?.message ?? "JavaScript/TypeScript service is unavailable.");
      return;
    }

    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart(
      requestedRoot,
      requestedOwner,
    );

    try {
      const status =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.start(requestedRoot, {
          ...javaScriptTypeScriptLanguageServerOptions(currentSettings),
        });

      if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
        return;
      }

      if (!isCurrentRuntimeOwner(requestedOwner)) {
        return;
      }

      handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        status,
        requestedRoot,
        requestedOwner,
        requestedRevision,
      );
      setMessage("JavaScript/TypeScript service restarted.");
    } catch (error) {
      if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
        return;
      }

      if (!isCurrentRuntimeOwner(requestedOwner)) {
        return;
      }

      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
    }
  }, [
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    isCurrentRuntimeOwner,
    isOwnerRevisionCurrent,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    ownerRevision,
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceSettingsRef,
  ]);

  useEffect(() => {
    if (!currentRuntimeOwner) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      clearManualPhpLanguageServerStop(
        currentRuntimeOwner.executionRoot,
        currentRuntimeOwner,
      );
    }
  }, [clearManualPhpLanguageServerStop, currentRuntimeOwner, intelligenceMode]);

  useEffect(() => {
    if (!currentRuntimeOwner) {
      return;
    }

    const requestedOwner = currentRuntimeOwner;
    const requestedRoot = requestedOwner.executionRoot;
    const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(
      languageServerRuntimeStatusByRootRef.current,
      requestedOwner,
    );
    const currentStatus =
      cachedStatus ?? (workspaceRuntimeOwner ? null : languageServerRuntimeStatus);
    const currentStatusRoot =
      cachedStatus?.rootPath ??
      (workspaceRuntimeOwner ? null : languageServerRuntimeStatusRoot);

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
      currentStatusRoot &&
      !workspaceRootKeysEqual(currentStatusRoot, requestedRoot)
    ) {
      return;
    }

    if (
      isLanguageServerActiveForWorkspace(
        currentStatus,
        currentStatusRoot,
        requestedRoot,
      )
    ) {
      return;
    }

    const autostartOwnerKey = requestedOwner.ownerKey;
    const autostartAttempts =
      phpLanguageServerAutostartAttemptsByRootRef.current[autostartOwnerKey] ??
      0;

    if (
      isCrashedLanguageServerForWorkspace(
        currentStatus,
        currentStatusRoot,
        requestedRoot,
      ) &&
      autostartAttempts === 0
    ) {
      return;
    }

    if (autostartAttempts >= PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS) {
      return;
    }

    if (isPhpLanguageServerManuallyStopped(requestedRoot, requestedOwner)) {
      return;
    }

    if (autoStartedLanguageServerRootRef.current === autostartOwnerKey) {
      return;
    }

    const requestedRevision = ownerRevision(requestedOwner);
    const requestedFence: LanguageServerRuntimeStatusFence = {
      authority: "command",
      commandSequence:
        advanceLanguageServerRuntimeCommandSequence(requestedOwner),
      subscriptionSequence:
        languageServerRuntimeStatusSequence(requestedOwner),
    };
    autoStartedLanguageServerRootRef.current = autostartOwnerKey;
    phpLanguageServerAutostartAttemptsByRootRef.current[autostartOwnerKey] =
      autostartAttempts + 1;
    prepareLanguageServerDiagnosticsForRuntimeStart(
      requestedRoot,
      requestedOwner,
    );
    languageServerRuntimeGateway
      .start(requestedRoot, phpLanguageServerOptions(workspaceSettingsRef.current))
      .then((status) => {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (
          !isLanguageServerRuntimeStatusFenceCurrent(
            requestedOwner,
            requestedFence,
          )
        ) {
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
          if (autoStartedLanguageServerRootRef.current === autostartOwnerKey) {
            autoStartedLanguageServerRootRef.current = null;
          }

          setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
          return;
        }

        const accepted = handleLanguageServerRuntimeStatus(
          status,
          requestedRoot,
          requestedOwner,
          requestedRevision,
          requestedFence,
        );

        if (!accepted) {
          return;
        }

        if (
          isRunningLanguageServerForWorkspace(
            status,
            status.rootPath ?? null,
            requestedRoot,
          )
        ) {
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            autostartOwnerKey
          ];
          return;
        }

        if (!languageServerCrashMessage(status)) {
          return;
        }

        if (autoStartedLanguageServerRootRef.current === autostartOwnerKey) {
          autoStartedLanguageServerRootRef.current = null;
        }

        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      })
      .catch((error) => {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (
          !isLanguageServerRuntimeStatusFenceCurrent(
            requestedOwner,
            requestedFence,
          )
        ) {
          return;
        }

        if (autoStartedLanguageServerRootRef.current === autostartOwnerKey) {
          autoStartedLanguageServerRootRef.current = null;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return;
        }

        reportLanguageServerError(error);
        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      });
  }, [
    autoStartedLanguageServerRootRef,
    advanceLanguageServerRuntimeCommandSequence,
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    isPhpLanguageServerManuallyStopped,
    isCurrentRuntimeOwner,
    isLanguageServerRuntimeStatusFenceCurrent,
    isOwnerRevisionCurrent,
    languageServerPlan,
    languageServerRuntimeGateway,
    languageServerRuntimeStatusSequence,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusByRootRef,
    languageServerRuntimeStatusRoot,
    phpLanguageServerAutostartAttemptsByRootRef,
    phpLanguageServerAutostartRetryVersion,
    ownerRevision,
    prepareLanguageServerDiagnosticsForRuntimeStart,
    reportLanguageServerError,
    setPhpLanguageServerAutostartRetryVersion,
    workspaceSettings.intelephensePath,
    workspaceSettings.phpBackend,
    workspaceSettings.phpactorPath,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
    workspaceRuntimeOwner,
  ]);

  useEffect(() => {
    if (!currentRuntimeOwner) {
      return;
    }

    const requestedOwner = currentRuntimeOwner;
    const requestedRoot = requestedOwner.executionRoot;
    const requestedRevision = ownerRevision(requestedOwner);
    const autostartOwnerKey = requestedOwner.ownerKey;
    const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(
      javaScriptTypeScriptRuntimeStatusByRootRef.current,
      requestedOwner,
    );
    const currentStatus =
      cachedStatus ??
      (workspaceRuntimeOwner
        ? null
        : javaScriptTypeScriptLanguageServerRuntimeStatus);
    const currentStatusRoot =
      cachedStatus?.rootPath ??
      (workspaceRuntimeOwner
        ? null
        : javaScriptTypeScriptLanguageServerRuntimeStatusRoot);

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
        currentStatus,
        currentStatusRoot,
        requestedRoot,
      )
    ) {
      return;
    }

    if (
      isCrashedLanguageServerForWorkspace(
        currentStatus,
        currentStatusRoot,
        requestedRoot,
      )
    ) {
      return;
    }

    if (
      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
      autostartOwnerKey
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (cancelled) {
        return;
      }

      let latestStatus =
        cachedStatus ??
        (workspaceRuntimeOwner
          ? null
          : javaScriptTypeScriptLanguageServerRuntimeStatusRef.current);
      let latestStatusRoot =
        cachedStatus?.rootPath ??
        (workspaceRuntimeOwner
          ? null
          : javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current);

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

        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (probedStatus) {
          latestStatus = probedStatus;
          latestStatusRoot = probedStatus.rootPath ?? null;
        }
      }

      if (!isCurrentRuntimeOwner(requestedOwner)) {
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
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
        autostartOwnerKey
      ) {
        return;
      }

      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current =
        autostartOwnerKey;
      prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart(
        requestedRoot,
        requestedOwner,
      );
      javaScriptTypeScriptLanguageServerRuntimeGateway
        .start(requestedRoot, {
          ...javaScriptTypeScriptLanguageServerOptions(
            workspaceSettingsRef.current,
          ),
        })
        .then((status) => {
          if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            if (
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
              autostartOwnerKey
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
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
              autostartOwnerKey
            ) {
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
            }

            handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
              runtimeStatusForRequestedRoot(status, requestedRoot),
              requestedRoot,
              requestedOwner,
              requestedRevision,
            );
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            requestedRoot,
            requestedOwner,
            requestedRevision,
          );
        })
        .catch((error) => {
          if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            return;
          }

          if (
            autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
            autostartOwnerKey
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
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    isCurrentRuntimeOwner,
    isOwnerRevisionCurrent,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    ownerRevision,
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
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
    workspaceRuntimeOwner,
  ]);

  useEffect(() => {
    if (!currentRuntimeOwner) {
      return;
    }

    if (workspaceSettings.javaScriptTypeScriptService !== "off") {
      return;
    }

    const targetOwner = currentRuntimeOwner;
    const targetRootPath = targetOwner.executionRoot;
    const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(
      javaScriptTypeScriptRuntimeStatusByRootRef.current,
      targetOwner,
    );

    if (
      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
      targetOwner.ownerKey
    ) {
      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
    }

    if (
      isLanguageServerActiveForWorkspace(
        cachedStatus,
        cachedStatus?.rootPath ?? null,
        targetRootPath,
      ) ||
      isCrashedLanguageServerForWorkspace(
        cachedStatus,
        cachedStatus?.rootPath ?? null,
        targetRootPath,
      )
    ) {
      void stopJavaScriptTypeScriptLanguageServerRuntime(
        targetRootPath,
        targetOwner,
      );
      return;
    }

    clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath, targetOwner);
    resetJavaScriptTypeScriptLanguageServerDocuments();
  }, [
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    currentRuntimeOwner,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceSettings.javaScriptTypeScriptService,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;
    const requestedOwner = currentRuntimeOwner;
    const requestedRevision = requestedOwner
      ? ownerRevision(requestedOwner)
      : null;
    const requestedFence: LanguageServerRuntimeStatusFence | null =
      requestedOwner
        ? {
            authority: "snapshot",
            commandSequence:
              languageServerRuntimeCommandSequence(requestedOwner),
            subscriptionSequence:
              languageServerRuntimeStatusSequence(requestedOwner),
          }
        : null;

    if (requestedOwner) {
      const requestedRoot = requestedOwner.executionRoot;
      const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(
        languageServerRuntimeStatusByRootRef.current,
        requestedOwner,
      );

      if (cachedStatus) {
        setLanguageServerRuntimeStatus(cachedStatus);
        setLanguageServerRuntimeStatusRoot(requestedRoot);
      } else {
        setLanguageServerRuntimeStatus(null);
        setLanguageServerRuntimeStatusRoot(null);
      }

      languageServerRuntimeGateway
        .getStatus(requestedRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          if (
            !requestedFence ||
            !isLanguageServerRuntimeStatusFenceCurrent(
              requestedOwner,
              requestedFence,
            )
          ) {
            return;
          }

          handleLanguageServerRuntimeStatus(
            status,
            requestedRoot,
            requestedOwner,
            requestedRevision,
            requestedFence ?? undefined,
          );
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          if (
            !requestedFence ||
            !isLanguageServerRuntimeStatusFenceCurrent(
              requestedOwner,
              requestedFence,
            )
          ) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            return;
          }

          setLanguageServerRuntimeStatusRoot(requestedRoot);
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

        if (!workspaceRuntimeOwner) {
          handleLanguageServerRuntimeStatus(
            status,
            requestedOwner?.executionRoot,
          );
          return;
        }

        if (!requestedOwner || requestedRevision === null) {
          handleLanguageServerRuntimeStatus(status);
          return;
        }

        const retainedStatus = retainedRuntimeStatusForOwner(
          status,
          requestedOwner,
          requestedRevision,
        );

        if (!retainedStatus) {
          return;
        }

        handleLanguageServerRuntimeStatus(
          retainedStatus,
          requestedOwner.executionRoot,
          requestedOwner,
          requestedRevision,
        );
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (requestedOwner) {
          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            return;
          }

          reportLanguageServerErrorForActiveWorkspaceRoot(
            requestedOwner.executionRoot,
            error,
          );
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(
          currentWorkspaceRootRef.current,
          error,
        );
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleLanguageServerRuntimeStatus,
    isCurrentRuntimeOwner,
    isLanguageServerRuntimeStatusFenceCurrent,
    isOwnerRevisionCurrent,
    languageServerRuntimeGateway,
    languageServerRuntimeCommandSequence,
    languageServerRuntimeStatusSequence,
    languageServerRuntimeStatusByRootRef,
    ownerRevisionVersion,
    ownerRevision,
    reportError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    retainedRuntimeStatusForOwner,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    workspaceRuntimeOwner,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;
    const requestedOwner = currentRuntimeOwner;
    const requestedRevision = requestedOwner
      ? ownerRevision(requestedOwner)
      : null;

    if (requestedOwner) {
      const requestedRoot = requestedOwner.executionRoot;
      const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        requestedOwner,
      );

      if (cachedStatus) {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(cachedStatus);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(requestedRoot);
      } else {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      }

      javaScriptTypeScriptLanguageServerRuntimeGateway
        .getStatus(requestedRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            requestedRoot,
            requestedOwner,
            requestedRevision,
          );
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            return;
          }

          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(requestedRoot);
          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
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

        if (!workspaceRuntimeOwner) {
          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            requestedOwner?.executionRoot,
          );
          return;
        }

        if (!requestedOwner || requestedRevision === null) {
          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(status);
          return;
        }

        const retainedStatus = retainedRuntimeStatusForOwner(
          status,
          requestedOwner,
          requestedRevision,
        );

        if (!retainedStatus) {
          return;
        }

        handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
          retainedStatus,
          requestedOwner.executionRoot,
          requestedOwner,
          requestedRevision,
        );
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (requestedOwner) {
          if (
            requestedRevision === null ||
            !isOwnerRevisionCurrent(requestedOwner, requestedRevision)
          ) {
            return;
          }

          if (!isCurrentRuntimeOwner(requestedOwner)) {
            return;
          }

          reportErrorForActiveWorkspaceRoot(
            requestedOwner.executionRoot,
            "JavaScript/TypeScript",
            error,
          );
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          currentWorkspaceRootRef.current,
          "JavaScript/TypeScript",
          error,
        );
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    currentRuntimeOwner,
    currentWorkspaceRootRef,
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    isCurrentRuntimeOwner,
    isOwnerRevisionCurrent,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    ownerRevisionVersion,
    ownerRevision,
    reportErrorForActiveWorkspaceRoot,
    retainedRuntimeStatusForOwner,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    workspaceRuntimeOwner,
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
