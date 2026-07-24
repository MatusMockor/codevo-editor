import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEvent, DebugGateway } from "../domain/debug";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  VscodeProcessTaskRunOwnership,
  VscodeProcessTasksState,
} from "./useVscodeProcessTasks";
import {
  createNodeDebugPreLaunchTaskCoordinator,
  type NodeDebugPreLaunchTaskExecution,
} from "./nodeDebugPreLaunchTaskCoordinator";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";
import {
  PostDebugTaskCoordinator,
  type PostDebugTaskLease,
  type PostDebugTaskCoordinatorSnapshot,
} from "./postDebugTaskCoordinator";
import { clonePreparedNodeDebugLaunch } from "./nodeDebugPreparedLaunchRecipe";
import {
  ServerReadyActionCoordinator,
  type ServerReadyActionLease,
  type ServerReadyActionOwner,
  type ServerReadyOpenRequest,
} from "./serverReadyActionCoordinator";
import type { DebugServerReadyExternalUrlOpener } from "../domain/debugServerReadyUrl";

const PRE_LAUNCH_UNAVAILABLE_WARNING =
  "Debug pre-launch task is unavailable. Refresh Tasks and try again.";
const PRE_LAUNCH_FAILED_WARNING = "Debug pre-launch task failed.";
const PRE_LAUNCH_CHANGED_WARNING =
  "Debug start was cancelled because the workspace or task state changed.";
const PRE_LAUNCH_START_WARNING = "Node debug configuration could not be started.";
const POST_DEBUG_TASK_WARNING = "Debug post-task could not be completed.";

interface NodeDebugPreLaunchBoundary {
  readonly launchConfigurationVersion: number;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

interface RetainedPostDebugRestart {
  readonly attached: boolean;
  readonly boundary: NodeDebugPreLaunchBoundary;
  readonly lease: PostDebugTaskLease | null;
  readonly prepared: PreparedNodeDebugLaunch;
  readonly sessionId: number;
  readonly workspaceEpoch: number;
}

interface OwnedPostTaskExecution {
  cancellationRequested: boolean;
  ownership: VscodeProcessTaskRunOwnership | null;
}

export function useNodeDebugPreLaunchComposition(options: {
  readonly debugGateway: Pick<DebugGateway, "disconnect" | "stop" | "subscribe">;
  readonly disconnectExactDebugSession: (sessionId: number) => Promise<boolean>;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly launchConfigurationVersion: number;
  readonly serverReadyExternalUrlOpener: DebugServerReadyExternalUrlOpener;
  readonly processTasks: VscodeProcessTasksState;
  readonly reportWarning: (message: string) => void;
  readonly rootPath: string | null;
  readonly startDebug: (launch: PreparedNodeDebugLaunch["launch"]) => Promise<number | null>;
  readonly startNativeNodeWatch?: (prepared: PreparedNodeDebugLaunch) => Promise<number | null>;
  readonly stopExactDebugSession: (sessionId: number) => Promise<boolean>;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}): {
  readonly isPostTaskActive: () => boolean;
  readonly isPostTaskBusy: () => boolean;
  readonly canRestartPostTask: () => boolean;
  readonly cancelServerReadyAction: () => void;
  readonly cancelServerReadyActionForSession: (rootPath: string, sessionId: number) => void;
  readonly hasPostTaskRestart: () => boolean;
  readonly postTaskActive: boolean;
  readonly postTaskBusy: boolean;
  readonly postRestartPending: boolean;
  readonly restartPostTask: () => Promise<boolean>;
  readonly start: (prepared: PreparedNodeDebugLaunch) => Promise<boolean>;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const boundaryRef = useRef<NodeDebugPreLaunchBoundary | null>(null);
  const epochRef = useRef(0);
  const boundary = useMemo(
    () => ({
      launchConfigurationVersion: options.launchConfigurationVersion,
      rootPath: options.rootPath,
      workspaceId: options.workspaceId,
      workspaceTrusted: options.workspaceTrusted,
    }),
    [
      options.launchConfigurationVersion,
      options.rootPath,
      options.workspaceId,
      options.workspaceTrusted,
    ],
  );
  if (!sameBoundary(boundaryRef.current, boundary)) {
    boundaryRef.current = boundary;
    epochRef.current = nextEpoch(epochRef.current);
  }
  const epoch = epochRef.current;
  const executionRef = useRef(options.processTasks);
  executionRef.current = options.processTasks;
  const ownedPostTaskExecutionRef = useRef<OwnedPostTaskExecution | null>(null);
  const [execution] = useState<NodeDebugPreLaunchTaskExecution>(() => ({
    startAndWait: (label, onOwned) => executionRef.current.startAndWait(label, onOwned),
  }));
  const [coordinator] = useState(() =>
    createNodeDebugPreLaunchTaskCoordinator({
      execution,
      isWorkspaceCurrent: (candidateEpoch, candidateWorkspaceId) => {
        const current = boundaryRef.current;
        return (
          candidateEpoch === epochRef.current &&
          current?.workspaceId === candidateWorkspaceId &&
          current.rootPath !== null
        );
      },
    }),
  );
  const [postCoordinator] = useState(() => new PostDebugTaskCoordinator());
  const [serverReadyCoordinator] = useState(() => new ServerReadyActionCoordinator());
  const serverReadyOpenerRef = useRef<{
    readonly lease: ServerReadyActionLease;
    readonly openExternal: DebugServerReadyExternalUrlOpener["openExternal"];
  } | null>(null);
  const retainedPostRestartRef = useRef<RetainedPostDebugRestart | null>(null);
  const postRestartPendingRef = useRef(false);
  const [postRestartPending, setPostRestartPending] = useState(false);
  const [, setPostRestartRevision] = useState(0);
  const [postSnapshot, setPostSnapshot] = useState<PostDebugTaskCoordinatorSnapshot>(() =>
    postCoordinator.snapshot(),
  );
  const appliedPostBoundaryRef = useRef({
    boundary,
    epoch,
  });
  const refreshPostSnapshot = useCallback(() => {
    if (mountedRef.current) setPostSnapshot(postCoordinator.snapshot());
  }, [postCoordinator]);
  const cancelOwnedPostTaskExecution = useCallback(() => {
    const execution = ownedPostTaskExecutionRef.current;
    if (!execution) return;
    execution.cancellationRequested = true;
    void execution.ownership?.cancel();
  }, []);
  const clearRetainedPostRestart = useCallback(
    (expected: RetainedPostDebugRestart | null = null) => {
      if (expected && retainedPostRestartRef.current !== expected) return;
      if (!retainedPostRestartRef.current) return;
      retainedPostRestartRef.current = null;
      if (mountedRef.current) {
        setPostRestartRevision((current) => current + 1);
      }
    },
    [],
  );
  const appliedEpochRef = useRef(epoch);
  useEffect(() => {
    if (appliedEpochRef.current === epoch) return;
    const previous = appliedPostBoundaryRef.current;
    appliedEpochRef.current = epoch;
    appliedPostBoundaryRef.current = { boundary, epoch };
    void coordinator.invalidate();
    serverReadyCoordinator.clear();
    serverReadyOpenerRef.current = null;
    if (previous.boundary.rootPath && previous.boundary.workspaceId) {
      postCoordinator.invalidate({
        rootPath: previous.boundary.rootPath,
        workspaceEpoch: previous.epoch,
        workspaceId: previous.boundary.workspaceId,
      });
      clearRetainedPostRestart();
      cancelOwnedPostTaskExecution();
      refreshPostSnapshot();
    }
  }, [
    boundary,
    cancelOwnedPostTaskExecution,
    clearRetainedPostRestart,
    coordinator,
    epoch,
    postCoordinator,
    refreshPostSnapshot,
    serverReadyCoordinator,
  ]);
  useEffect(
    () => () => {
      void coordinator.invalidate();
      const current = appliedPostBoundaryRef.current;
      if (current.boundary.rootPath && current.boundary.workspaceId) {
        postCoordinator.invalidate({
          rootPath: current.boundary.rootPath,
          workspaceEpoch: current.epoch,
          workspaceId: current.boundary.workspaceId,
        });
      }
      retainedPostRestartRef.current = null;
      serverReadyCoordinator.clear();
      serverReadyOpenerRef.current = null;
      cancelOwnedPostTaskExecution();
    },
    [cancelOwnedPostTaskExecution, coordinator, postCoordinator, serverReadyCoordinator],
  );
  const openServerReady = useCallback(
    (request: ServerReadyOpenRequest | null) => {
      if (!request) return;
      const ownedOpener = serverReadyOpenerRef.current;
      if (!ownedOpener || ownedOpener.lease !== request.lease) return;
      void Promise.resolve()
        .then(async () => {
          if (serverReadyOpenerRef.current !== ownedOpener) return;
          const authorized = serverReadyCoordinator.authorize(request);
          serverReadyOpenerRef.current = null;
          if (authorized) await ownedOpener.openExternal(authorized);
        })
        .catch(() => {
          safelyWarn(optionsRef.current.reportWarning, "Server ready URL could not be opened.");
        });
    },
    [serverReadyCoordinator],
  );
  useEffect(
    () =>
      options.debugGateway.subscribe((event) => {
        openServerReady(serverReadyCoordinator.observe(event));
        if (event.payload.kind !== "terminated") return;
        const currentRoot = optionsRef.current.rootPath;
        if (!currentRoot || !workspaceRootKeysEqual(currentRoot, event.rootPath)) return;
        const retained = retainedPostRestartRef.current;
        if (
          retained &&
          retained.lease === null &&
          retained.sessionId === event.sessionId &&
          workspaceRootKeysEqual(retained.boundary.rootPath, event.rootPath)
        ) {
          clearRetainedPostRestart(retained);
        }
        void settleTerminalEvent(postCoordinator, event, refreshPostSnapshot);
      }),
    [
      clearRetainedPostRestart,
      openServerReady,
      options.debugGateway,
      postCoordinator,
      refreshPostSnapshot,
      serverReadyCoordinator,
    ],
  );

  const start = useCallback(
    async (prepared: PreparedNodeDebugLaunch): Promise<boolean> => {
      const captured = boundaryRef.current;
      const capturedEpoch = epochRef.current;
      const postState = postCoordinator.snapshot();
      if (
        !captured?.rootPath ||
        !captured.workspaceId ||
        postState.kind === "armed" ||
        postState.kind === "settling"
      ) {
        return false;
      }
      const capturedRoot = captured.rootPath;
      const capturedWorkspaceId = captured.workspaceId;
      let acceptedSessionId: number | null = null;
      let serverReadyLease: ServerReadyActionLease | null = null;
      const outcome = await coordinator.run(
        {
          task: prepared.preLaunchTask,
          workspaceEpoch: capturedEpoch,
          workspaceId: captured.workspaceId,
        },
        async () => {
          serverReadyCoordinator.clear();
          serverReadyOpenerRef.current = null;
          if (prepared.serverReadyAction) {
            const owner: ServerReadyActionOwner = Object.freeze({
              configurationVersion: captured.launchConfigurationVersion,
              rootPath: capturedRoot,
              workspaceEpoch: capturedEpoch,
              workspaceId: capturedWorkspaceId,
            });
            serverReadyLease = serverReadyCoordinator.begin({
              isOwnerCurrent: (candidate) =>
                postTaskOwnerIsCurrent(
                  optionsRef.current,
                  {
                    rootPath: candidate.rootPath,
                    workspaceEpoch: candidate.workspaceEpoch,
                    workspaceId: candidate.workspaceId,
                  },
                  candidate.configurationVersion,
                  epochRef.current,
                ),
              owner,
              recipe: prepared.serverReadyAction,
            });
            if (serverReadyLease) {
              const opener = optionsRef.current.serverReadyExternalUrlOpener;
              serverReadyOpenerRef.current = {
                lease: serverReadyLease,
                openExternal: opener.openExternal.bind(opener),
              };
            }
          }
          acceptedSessionId = prepared.nativeWatch
            ? ((await optionsRef.current.startNativeNodeWatch?.(prepared)) ?? null)
            : await optionsRef.current.startDebug(prepared.launch);
          if (serverReadyLease && acceptedSessionId !== null) {
            openServerReady(serverReadyCoordinator.adopt(serverReadyLease, acceptedSessionId));
          } else if (serverReadyLease) {
            serverReadyCoordinator.cancel(serverReadyLease);
          }
          return acceptedSessionId !== null;
        },
      );
      const ownerStillCurrent = postTaskOwnerIsCurrent(
        optionsRef.current,
        {
          rootPath: captured.rootPath,
          workspaceEpoch: capturedEpoch,
          workspaceId: captured.workspaceId,
        },
        captured.launchConfigurationVersion,
        epochRef.current,
      );
      if (acceptedSessionId !== null && (outcome.status !== "started" || !ownerStillCurrent)) {
        if (serverReadyLease) serverReadyCoordinator.cancel(serverReadyLease);
        await compensateAcceptedSession(
          optionsRef.current.debugGateway,
          prepared,
          captured.rootPath,
          acceptedSessionId,
        );
      }
      if (
        !ownerStillCurrent ||
        boundaryRef.current?.workspaceId !== captured.workspaceId ||
        !workspaceRootKeysEqual(boundaryRef.current?.rootPath ?? null, captured.rootPath)
      ) {
        if (serverReadyLease) serverReadyCoordinator.cancel(serverReadyLease);
        return false;
      }
      if (outcome.status === "started" && acceptedSessionId !== null) {
        let postLease: PostDebugTaskLease | null = null;
        if (prepared.postDebugTask) {
          const retainedPrepared = clonePreparedNodeDebugLaunch(prepared);
          if (!retainedPrepared) {
            await compensateAcceptedSession(
              optionsRef.current.debugGateway,
              prepared,
              captured.rootPath,
              acceptedSessionId,
            );
            safelyWarn(optionsRef.current.reportWarning, POST_DEBUG_TASK_WARNING);
            return false;
          }
          const armResult = postCoordinator.armAfterAcceptedSession({
            cleanup: () => undefined,
            reportError: () =>
              safelyWarn(optionsRef.current.reportWarning, POST_DEBUG_TASK_WARNING),
            revalidate: (_task, identity) =>
              postTaskOwnerIsCurrent(
                optionsRef.current,
                identity,
                captured.launchConfigurationVersion,
                epochRef.current,
              ),
            rootPath: captured.rootPath,
            run: async (task) => {
              const ownedExecution: OwnedPostTaskExecution = {
                cancellationRequested: false,
                ownership: null,
              };
              ownedPostTaskExecutionRef.current = ownedExecution;
              try {
                const completion = await execution.startAndWait(task.label, (ownedRun) => {
                  ownedExecution.ownership = ownedRun;
                  if (
                    ownedExecution.cancellationRequested ||
                    ownedPostTaskExecutionRef.current !== ownedExecution
                  ) {
                    void ownedRun.cancel();
                  }
                });
                if (completion?.status !== "exited" || completion.exitCode !== 0) {
                  throw new Error("post task failed");
                }
              } finally {
                if (ownedPostTaskExecutionRef.current === ownedExecution) {
                  ownedPostTaskExecutionRef.current = null;
                }
              }
            },
            sessionId: acceptedSessionId,
            task: prepared.postDebugTask,
            workspaceEpoch: capturedEpoch,
            workspaceId: captured.workspaceId,
          });
          refreshPostSnapshot();
          if (armResult.kind === "rejected") {
            await compensateAcceptedSession(
              optionsRef.current.debugGateway,
              prepared,
              captured.rootPath,
              acceptedSessionId,
            );
            safelyWarn(optionsRef.current.reportWarning, POST_DEBUG_TASK_WARNING);
            return false;
          }
          if (armResult.kind === "armed") {
            postLease = armResult.lease;
          }
          if (armResult.kind === "settling") {
            void armResult.completion.then(refreshPostSnapshot);
          }
        }
        if (prepared.postDebugTask || prepared.serverReadyAction) {
          const retainedPrepared = clonePreparedNodeDebugLaunch(prepared);
          if (!retainedPrepared) {
            if (serverReadyLease) serverReadyCoordinator.cancel(serverReadyLease);
            await compensateAcceptedSession(
              optionsRef.current.debugGateway,
              prepared,
              captured.rootPath,
              acceptedSessionId,
            );
            safelyWarn(optionsRef.current.reportWarning, POST_DEBUG_TASK_WARNING);
            return false;
          }
          const retained: RetainedPostDebugRestart = Object.freeze({
            attached: retainedPrepared.launch.kind === "node-attach",
            boundary: Object.freeze({ ...captured }),
            lease: postLease,
            prepared: retainedPrepared,
            sessionId: acceptedSessionId,
            workspaceEpoch: capturedEpoch,
          });
          retainedPostRestartRef.current = retained;
          if (mountedRef.current) setPostRestartRevision((current) => current + 1);
          if (postLease) {
            void postLease.completion.then(() => clearRetainedPostRestart(retained));
          }
        }
        return true;
      }
      if (outcome.status === "cancelled") return false;
      const warning =
        outcome.status === "task-unavailable"
          ? PRE_LAUNCH_UNAVAILABLE_WARNING
          : outcome.status === "task-failed"
            ? PRE_LAUNCH_FAILED_WARNING
            : outcome.status === "busy" || outcome.status === "stale"
              ? PRE_LAUNCH_CHANGED_WARNING
              : PRE_LAUNCH_START_WARNING;
      safelyWarn(optionsRef.current.reportWarning, warning);
      return false;
    },
    [
      clearRetainedPostRestart,
      coordinator,
      execution,
      openServerReady,
      postCoordinator,
      refreshPostSnapshot,
      serverReadyCoordinator,
    ],
  );

  const isPostTaskActive = useCallback(() => {
    const current = postCoordinator.snapshot();
    return postRestartPendingRef.current || current.kind === "armed" || current.kind === "settling";
  }, [postCoordinator]);
  const isPostTaskBusy = useCallback(() => postCoordinator.snapshot().occupied, [postCoordinator]);
  const hasPostTaskRestart = useCallback(() => retainedPostRestartRef.current !== null, []);
  const canRestartPostTask = useCallback(() => {
    const retained = retainedPostRestartRef.current;
    return Boolean(
      retained &&
      !postRestartPendingRef.current &&
      (retained.lease === null || postCoordinator.snapshot().kind === "armed") &&
      retained.boundary.rootPath &&
      retained.boundary.workspaceId &&
      postTaskOwnerIsCurrent(
        optionsRef.current,
        {
          rootPath: retained.boundary.rootPath,
          workspaceEpoch: retained.workspaceEpoch,
          workspaceId: retained.boundary.workspaceId,
        },
        retained.boundary.launchConfigurationVersion,
        epochRef.current,
      ),
    );
  }, [postCoordinator]);
  const restartPostTask = useCallback(async (): Promise<boolean> => {
    const retained = retainedPostRestartRef.current;
    if (!retained || !canRestartPostTask()) return false;
    postRestartPendingRef.current = true;
    if (mountedRef.current) setPostRestartPending(true);
    try {
      if (
        serverReadyCoordinator.cancelSession(retained.boundary.rootPath ?? "", retained.sessionId)
      ) {
        serverReadyOpenerRef.current = null;
      }
      let ended = false;
      try {
        ended = await (retained.attached
          ? optionsRef.current.disconnectExactDebugSession(retained.sessionId)
          : optionsRef.current.stopExactDebugSession(retained.sessionId));
      } catch {
        return false;
      }
      if (!ended) return false;
      if (retained.lease) {
        const settlement = await postCoordinator.settleExact(retained.lease);
        refreshPostSnapshot();
        if (settlement.kind !== "completed") return false;
      }
      if (
        !retained.boundary.rootPath ||
        !retained.boundary.workspaceId ||
        !postTaskOwnerIsCurrent(
          optionsRef.current,
          {
            rootPath: retained.boundary.rootPath,
            workspaceEpoch: retained.workspaceEpoch,
            workspaceId: retained.boundary.workspaceId,
          },
          retained.boundary.launchConfigurationVersion,
          epochRef.current,
        )
      ) {
        return false;
      }
      return await start(retained.prepared);
    } finally {
      postRestartPendingRef.current = false;
      if (mountedRef.current) setPostRestartPending(false);
    }
  }, [canRestartPostTask, postCoordinator, refreshPostSnapshot, serverReadyCoordinator, start]);
  const cancelServerReadyAction = useCallback(() => {
    serverReadyOpenerRef.current = null;
    serverReadyCoordinator.clear();
  }, [serverReadyCoordinator]);
  const cancelServerReadyActionForSession = useCallback(
    (rootPath: string, sessionId: number) => {
      if (serverReadyCoordinator.cancelSession(rootPath, sessionId)) {
        serverReadyOpenerRef.current = null;
      }
    },
    [serverReadyCoordinator],
  );
  return useMemo(
    () => ({
      canRestartPostTask,
      cancelServerReadyAction,
      cancelServerReadyActionForSession,
      hasPostTaskRestart,
      isPostTaskActive,
      isPostTaskBusy,
      postTaskActive:
        postRestartPending || postSnapshot.kind === "armed" || postSnapshot.kind === "settling",
      postTaskBusy: postSnapshot.occupied,
      postRestartPending,
      restartPostTask,
      start,
    }),
    [
      canRestartPostTask,
      cancelServerReadyAction,
      cancelServerReadyActionForSession,
      hasPostTaskRestart,
      isPostTaskActive,
      isPostTaskBusy,
      postRestartPending,
      postSnapshot,
      restartPostTask,
      start,
    ],
  );
}

async function compensateAcceptedSession(
  gateway: Pick<DebugGateway, "disconnect" | "stop">,
  prepared: PreparedNodeDebugLaunch,
  rootPath: string,
  sessionId: number,
): Promise<void> {
  try {
    await (prepared.launch.kind === "node-attach"
      ? gateway.disconnect({ rootPath, sessionId })
      : gateway.stop(sessionId));
  } catch {
    // Compensation is best effort and has no presentation surface of its own.
  }
}

async function settleTerminalEvent(
  coordinator: PostDebugTaskCoordinator,
  event: DebugEvent,
  refresh: () => void,
): Promise<void> {
  const completion = coordinator.handleTerminal({
    rootPath: event.rootPath,
    sessionId: event.sessionId,
  });
  refresh();
  await completion;
  refresh();
}

function postTaskOwnerIsCurrent(
  options: {
    readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
    readonly launchConfigurationVersion: number;
    readonly rootPath: string | null;
    readonly workspaceId: string | null;
    readonly workspaceTrusted: boolean;
  },
  identity: {
    readonly rootPath: string;
    readonly workspaceEpoch: number;
    readonly workspaceId: string;
  },
  launchConfigurationVersion: number,
  workspaceEpoch: number,
): boolean {
  if (
    !options.workspaceTrusted ||
    options.launchConfigurationVersion !== launchConfigurationVersion ||
    identity.workspaceEpoch !== workspaceEpoch ||
    options.workspaceId !== identity.workspaceId ||
    !workspaceRootKeysEqual(options.rootPath, identity.rootPath)
  ) {
    return false;
  }
  try {
    return options.isWorkspaceCurrent(identity.rootPath, identity.workspaceId);
  } catch {
    return false;
  }
}

function sameBoundary(
  previous: NodeDebugPreLaunchBoundary | null,
  next: NodeDebugPreLaunchBoundary,
): boolean {
  return (
    previous !== null &&
    previous.launchConfigurationVersion === next.launchConfigurationVersion &&
    workspaceRootKeysEqual(previous.rootPath, next.rootPath) &&
    previous.workspaceId === next.workspaceId &&
    previous.workspaceTrusted === next.workspaceTrusted
  );
}

function nextEpoch(current: number): number {
  return Number.isSafeInteger(current) && current >= 0 && current < Number.MAX_SAFE_INTEGER
    ? current + 1
    : Number.MAX_SAFE_INTEGER;
}

function safelyWarn(reportWarning: (message: string) => void, message: string): void {
  try {
    reportWarning(message);
  } catch {
    // Presentation failures never own task or debug admission.
  }
}
