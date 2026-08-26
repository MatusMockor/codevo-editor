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
import type { NpmRunSelectedScriptContextCapture } from "../domain/command";
import type {
  NodePackageTaskLaunchTarget,
  NodePackageScript,
  NodePackageScriptRunGateway,
  NodePackageScriptsGateway,
  NodePackageTaskEvent,
} from "../domain/nodePackageScripts";
import {
  DEFAULT_NODE_PACKAGE_TASK_LAUNCH_TARGET,
  normalizeNodePackageTaskLaunchTarget,
} from "../domain/nodePackageScripts";
import {
  nodePackageProblemMatcherForScript,
  type NodePackageTaskProblemsGateway,
} from "../domain/nodePackageTaskProblems";
import {
  nodePackageTaskIsActive,
  reduceNodePackageTaskState,
  type NodePackageTaskAction,
  type NodePackageTaskState,
} from "./nodePackageTaskLifecycle";
import { useNodePackageScripts } from "./useNodePackageScripts";
import { useWorkbenchNodePackageTaskProblems } from "./useWorkbenchNodePackageTaskProblems";
import type { WorkbenchNotice } from "./workbenchNotice";
import {
  createNpmRunSelectedScriptCoordinator,
  type NpmRunSelectedScriptAuthority,
} from "./npmRunSelectedScriptCoordinator";
import {
  createWorkspaceRoot,
  type WorkspacePathPolicy,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";

interface NodePackageWorkspaceIdentity {
  readonly canonicalRoot: string;
  readonly policy: WorkspacePathPolicy;
  readonly selectedPath: string;
  readonly workspaceId: string;
}

interface UseNodePackageScriptWorkbenchOptions {
  readonly discoveryGateway: NodePackageScriptsGateway;
  readonly discoveryEnabled: boolean;
  readonly discoveryVersion: number;
  readonly executionEnabled: boolean;
  readonly rootPath: string | null;
  readonly runGateway: NodePackageScriptRunGateway;
  readonly workspaceId: string | null;
  readonly createRunId?: () => string;
  readonly additionalSubscriptionReadyRef?: MutableRefObject<Promise<void>>;
  reportError(error: unknown): void;
  requestTerminalSession(consumer: (sessionId: number | null) => void): void;
}

export type NodePackageScriptsWorkbenchGateway = NodePackageScriptsGateway &
  NodePackageScriptRunGateway &
  NodePackageTaskProblemsGateway;

interface UseWorkbenchNodePackageScriptsOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly discoveryVersion: number;
  readonly gateway?: NodePackageScriptsWorkbenchGateway;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly identity?: NodePackageWorkspaceIdentity | null;
  readonly rootPath: string | null;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly trusted: boolean;
  readonly workspaceId?: string | null;
  reportErrorForActiveWorkspaceRoot(
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ): void;
  requestTerminalSession(consumer: (sessionId: number | null) => void): void;
}

export const unavailableNodePackageScriptsWorkbenchGateway: NodePackageScriptsWorkbenchGateway = {
  listNodePackageScripts: async () => ({ scripts: [], total: 0, truncated: false, visited: 0 }),
  startNodePackageTask: async () => {
    throw new Error("Node package script execution is unavailable.");
  },
  acknowledgeNodePackageTaskStart: async () => undefined,
  stopNodePackageTask: async () => undefined,
  subscribeNodePackageTaskEvents: async () => () => undefined,
  subscribeNodePackageTaskOutputEvents: async () => () => undefined,
  subscribeNodePackageTaskProblemsEvents: async () => () => undefined,
};

let fallbackRunSequence = 0;

export function useWorkbenchNodePackageScripts({
  currentWorkspaceRootRef,
  discoveryVersion,
  gateway,
  hasJavaScriptTypeScriptWorkspace,
  identity = null,
  reportErrorForActiveWorkspaceRoot,
  requestTerminalSession,
  rootPath,
  setNotices,
  trusted,
  workspaceId: requestedWorkspaceId,
}: UseWorkbenchNodePackageScriptsOptions) {
  const workspaceId = identity?.workspaceId ?? requestedWorkspaceId ?? null;
  const reportError = useCallback(
    (error: unknown) =>
      reportErrorForActiveWorkspaceRoot(
        currentWorkspaceRootRef.current,
        "Node Package Script",
        error,
      ),
    [currentWorkspaceRootRef, reportErrorForActiveWorkspaceRoot],
  );
  const resolvedGateway = gateway ?? unavailableNodePackageScriptsWorkbenchGateway;
  const discoveryEnabled = Boolean(gateway) && hasJavaScriptTypeScriptWorkspace;
  const executionEnabled = discoveryEnabled && trusted;
  const available = executionEnabled;
  const problemSubscriptionReadyRef = useRef<Promise<void>>(Promise.resolve());
  const workbench = useNodePackageScriptWorkbench({
    additionalSubscriptionReadyRef: problemSubscriptionReadyRef,
    discoveryGateway: resolvedGateway,
    discoveryEnabled,
    discoveryVersion,
    executionEnabled,
    reportError,
    requestTerminalSession,
    rootPath,
    runGateway: resolvedGateway,
    workspaceId,
  });
  const workspaceRoots = useMemo(() => nodePackageWorkspaceRoots(identity), [identity]);
  const activationRef = useRef({
    epoch: 0,
    identity: null as NodePackageWorkspaceIdentity | null,
    rootPath: null as string | null,
    workspaceRoots: null as readonly WorkspaceRootDescriptor[] | null,
  });
  if (
    activationRef.current.identity !== identity ||
    activationRef.current.rootPath !== rootPath ||
    activationRef.current.workspaceRoots !== workspaceRoots
  ) {
    activationRef.current = {
      epoch: activationRef.current.epoch + 1,
      identity,
      rootPath,
      workspaceRoots,
    };
  }
  const activationEpoch = activationRef.current.epoch;
  const authorityGenerationRef = useRef(0);
  const authoritySignatureRef = useRef<readonly unknown[]>([]);
  const authoritySignature = [
    activationEpoch,
    available,
    identity,
    rootPath,
    trusted,
    workspaceRoots,
  ] as const;
  if (!sameReferenceTuple(authoritySignatureRef.current, authoritySignature)) {
    authoritySignatureRef.current = authoritySignature;
    authorityGenerationRef.current += 1;
  }
  const discoveryGenerationRef = useRef(0);
  const discoverySignatureRef = useRef<readonly unknown[]>([]);
  const discoverySignature = [discoveryVersion, workbench.scripts] as const;
  if (!sameReferenceTuple(discoverySignatureRef.current, discoverySignature)) {
    discoverySignatureRef.current = discoverySignature;
    discoveryGenerationRef.current += 1;
  }
  const workbenchRef = useRef(workbench);
  workbenchRef.current = workbench;
  const rawCaptureRef = useRef<NpmRunSelectedScriptContextCapture | null>(null);
  const npmAuthorityRef = useRef<NpmRunSelectedScriptAuthority | null>(null);
  npmAuthorityRef.current =
    identity && rootPath && workspaceRoots
      ? {
          activationEpoch,
          authorityGeneration: authorityGenerationRef.current,
          discoveryGeneration: discoveryGenerationRef.current,
          editor: rawCaptureRef.current
            ? {
                ...rawCaptureRef.current,
                activationEpoch,
                ownerKey: `npm-run-selected-script:${identity.workspaceId}:${activationEpoch}`,
                rootPath,
                workspaceId: identity.workspaceId,
              }
            : null,
          executionAvailable: available,
          ownerKey: `npm-run-selected-script:${identity.workspaceId}:${activationEpoch}`,
          rootPath,
          scripts: workbench.scripts,
          trusted,
          workspaceId: identity.workspaceId,
          workspaceRoots,
        }
      : null;
  const npmCoordinator = useMemo(
    () =>
      createNpmRunSelectedScriptCoordinator(
        () => npmAuthorityRef.current,
        {
          isActive: () => workbenchRef.current.isActive(),
          run: (script) => {
            workbenchRef.current.run(script);
          },
        },
        (error) => reportError(error),
      ),
    [reportError],
  );
  const runSelectedScript = useCallback(
    (capture: NpmRunSelectedScriptContextCapture): boolean => {
      authorityGenerationRef.current += 1;
      rawCaptureRef.current = capture;
      const current = npmAuthorityRef.current;
      if (current) {
        npmAuthorityRef.current = {
          ...current,
          authorityGeneration: authorityGenerationRef.current,
          editor: {
            ...capture,
            activationEpoch: current.activationEpoch,
            ownerKey: current.ownerKey,
            rootPath: current.rootPath,
            workspaceId: current.workspaceId,
          },
        };
      }
      try {
        return npmCoordinator.runSelectedScript();
      } finally {
        rawCaptureRef.current = null;
        authorityGenerationRef.current += 1;
        if (npmAuthorityRef.current) {
          npmAuthorityRef.current = {
            ...npmAuthorityRef.current,
            authorityGeneration: authorityGenerationRef.current,
            editor: null,
          };
        }
      }
    },
    [npmCoordinator],
  );
  const problems = useWorkbenchNodePackageTaskProblems({
    enabled: executionEnabled,
    gateway: resolvedGateway,
    rootPath,
    setNotices,
    task: workbench.task,
    workspaceId,
  });
  problemSubscriptionReadyRef.current = problems.ready;
  return {
    ...workbench,
    available,
    problemNotices: problems.notices,
    problemState: problems.state,
    runSelectedScript,
  };
}

function nodePackageWorkspaceRoots(
  identity: NodePackageWorkspaceIdentity | null,
): readonly WorkspaceRootDescriptor[] | null {
  if (!identity) return null;
  const selected = createWorkspaceRoot(
    identity.workspaceId,
    identity.selectedPath,
    identity.policy,
  );
  const canonical = createWorkspaceRoot(
    identity.workspaceId,
    identity.canonicalRoot,
    identity.policy,
  );
  if (!selected.ok || !canonical.ok) return null;
  return selected.value.nativePath === canonical.value.nativePath
    ? [selected.value]
    : [selected.value, canonical.value];
}

function sameReferenceTuple(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function useNodePackageScriptWorkbench({
  additionalSubscriptionReadyRef,
  createRunId = createNodePackageTaskRunId,
  discoveryGateway,
  discoveryEnabled,
  discoveryVersion,
  executionEnabled,
  reportError,
  requestTerminalSession,
  rootPath,
  runGateway,
  workspaceId,
}: UseNodePackageScriptWorkbenchOptions) {
  const discovery = useNodePackageScripts({
    discoveryEnabled,
    discoveryVersion,
    gateway: discoveryGateway,
    rootPath,
    workspaceId,
  });
  const [task, setTask] = useState<NodePackageTaskState | null>(null);
  const taskRef = useRef<NodePackageTaskState | null>(null);
  const mountedRef = useRef(false);
  const ownerSequenceRef = useRef(0);
  const subscriptionReadyRef = useRef<Promise<void>>(Promise.resolve());
  const subscriptionErrorRef = useRef<unknown>(null);
  const stopRequestedRef = useRef(new Set<string>());
  const stopCompletedRef = useRef(new Set<string>());
  const startDispatchedRef = useRef(new Set<string>());
  const currentRef = useRef({
    executionEnabled,
    rootPath,
    scripts: discovery.scripts,
    workspaceId,
  });
  currentRef.current = { executionEnabled, rootPath, scripts: discovery.scripts, workspaceId };

  const transition = useCallback((action: NodePackageTaskAction) => {
    const next = reduceNodePackageTaskState(taskRef.current, action);
    taskRef.current = next;
    if (mountedRef.current) setTask(next);
    return next;
  }, []);

  const requestBackendStop = useCallback(
    (captured: NodePackageTaskState, reportCurrentError = false) => {
      const operationKey = taskOperationKey(captured.workspaceId, captured.runId);
      if (stopCompletedRef.current.has(operationKey) || stopRequestedRef.current.has(operationKey))
        return;
      stopRequestedRef.current.add(operationKey);
      void runGateway
        .stopNodePackageTask({ runId: captured.runId, workspaceId: captured.workspaceId })
        .then(() => {
          stopRequestedRef.current.delete(operationKey);
          stopCompletedRef.current.add(operationKey);
          startDispatchedRef.current.delete(operationKey);
          if (!mountedRef.current || taskRef.current?.runId !== captured.runId) return;
          transition({ type: "stop-accepted", runId: captured.runId });
          if (currentRef.current.workspaceId !== captured.workspaceId)
            transition({ type: "reset" });
        })
        .catch((error: unknown) => {
          stopRequestedRef.current.delete(operationKey);
          if (!mountedRef.current || taskRef.current?.runId !== captured.runId) return;
          transition({ type: "stop-rejected", runId: captured.runId });
          const current = currentRef.current;
          if (reportCurrentError && current.workspaceId === captured.workspaceId)
            reportError(error);
        });
    },
    [reportError, runGateway, transition],
  );

  const eventHandlerRef = useRef<(event: NodePackageTaskEvent) => void>(() => undefined);
  eventHandlerRef.current = (event) => {
    if (!mountedRef.current || !taskRef.current) {
      return;
    }
    const previous = taskRef.current;
    const next = transition({ type: "event", event });
    if (next !== previous && !nodePackageTaskIsActive(next)) {
      const operationKey = taskOperationKey(event.workspaceId, event.runId);
      stopRequestedRef.current.delete(operationKey);
      stopCompletedRef.current.add(operationKey);
      startDispatchedRef.current.delete(operationKey);
      const current = currentRef.current;
      if (
        event.status === "failed" &&
        current.executionEnabled &&
        current.workspaceId === event.workspaceId
      )
        reportError(new Error(event.message));
      if (current.workspaceId !== event.workspaceId) transition({ type: "reset" });
    }
  };

  useEffect(() => {
    if (!executionEnabled) {
      subscriptionErrorRef.current = null;
      subscriptionReadyRef.current = Promise.resolve();
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    subscriptionErrorRef.current = null;
    subscriptionReadyRef.current = runGateway
      .subscribeNodePackageTaskEvents((event) => eventHandlerRef.current(event))
      .then((listener) => {
        if (disposed) listener();
        else unsubscribe = listener;
      })
      .catch((error: unknown) => {
        subscriptionErrorRef.current = error;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [executionEnabled, runGateway]);

  useEffect(() => {
    mountedRef.current = true;
    const dispatched = startDispatchedRef.current;
    return () => {
      mountedRef.current = false;
      ownerSequenceRef.current += 1;
      const current = taskRef.current;
      if (current && dispatched.has(taskOperationKey(current.workspaceId, current.runId)))
        requestBackendStop(current);
      taskRef.current = null;
    };
  }, [requestBackendStop]);

  useEffect(() => {
    ownerSequenceRef.current += 1;
    const previous = taskRef.current;
    if (
      previous &&
      startDispatchedRef.current.has(taskOperationKey(previous.workspaceId, previous.runId))
    ) {
      const stopping = transition({ type: "stopping", runId: previous.runId });
      if (stopping) requestBackendStop(stopping);
    } else {
      transition({ type: "reset" });
    }
  }, [executionEnabled, requestBackendStop, rootPath, transition, workspaceId]);

  const run = useCallback(
    (
      script: NodePackageScript,
      launchTarget: NodePackageTaskLaunchTarget = DEFAULT_NODE_PACKAGE_TASK_LAUNCH_TARGET,
      repositoryRoot?: string,
    ) => {
      const captured = currentRef.current;
      const capturedScript = { ...script };
      const capturedLaunchTarget = normalizeNodePackageTaskLaunchTarget(launchTarget);
      if (
        !mountedRef.current ||
        !captured.executionEnabled ||
        !captured.rootPath ||
        !captured.workspaceId ||
        nodePackageTaskIsActive(taskRef.current) ||
        !captured.scripts.some((candidate) => candidate.key === capturedScript.key)
      ) {
        return false;
      }
      const capturedRepositoryRoot = repositoryRoot ?? captured.rootPath;
      const runId = createRunId();
      const capturedWorkspaceId = captured.workspaceId;
      const ownerSequence = ownerSequenceRef.current;
      transition({
        type: "stage",
        identity: {
          runId,
          workspaceId: capturedWorkspaceId,
          manifestRelativePath: capturedScript.manifestRelativePath,
          scriptName: capturedScript.scriptName,
        },
      });

      requestTerminalSession((sessionId) => {
        const current = currentRef.current;
        if (
          sessionId === null ||
          !Number.isSafeInteger(sessionId) ||
          sessionId < 0 ||
          !mountedRef.current ||
          ownerSequenceRef.current !== ownerSequence ||
          !current.executionEnabled ||
          current.rootPath !== captured.rootPath ||
          current.workspaceId !== capturedWorkspaceId ||
          taskRef.current?.runId !== runId ||
          !nodePackageTaskIsActive(taskRef.current) ||
          !current.scripts.some((candidate) => candidate.key === capturedScript.key)
        ) {
          if (taskRef.current?.runId === runId) transition({ type: "stopping", runId });
          return;
        }
        transition({ type: "terminal-acquired", runId, sessionId });
        void (async () => {
          await subscriptionReadyRef.current;
          if (subscriptionErrorRef.current) throw subscriptionErrorRef.current;
          await additionalSubscriptionReadyRef?.current;
          const latest = currentRef.current;
          if (
            !mountedRef.current ||
            ownerSequenceRef.current !== ownerSequence ||
            !latest.executionEnabled ||
            latest.rootPath !== captured.rootPath ||
            latest.workspaceId !== capturedWorkspaceId ||
            taskRef.current?.runId !== runId ||
            !nodePackageTaskIsActive(taskRef.current)
          ) {
            return;
          }
          const operationKey = taskOperationKey(capturedWorkspaceId, runId);
          startDispatchedRef.current.add(operationKey);
          const problemMatcher = nodePackageProblemMatcherForScript(capturedScript.scriptName);
          const result = await runGateway.startNodePackageTask({
            runId,
            workspaceId: capturedWorkspaceId,
            sessionId,
            manifestRelativePath: capturedScript.manifestRelativePath,
            scriptName: capturedScript.scriptName,
            repositoryRoot: capturedRepositoryRoot,
            target: capturedLaunchTarget,
            ...(problemMatcher ? { problemMatcher } : {}),
          });
          if (result.runId !== runId)
            throw new Error("Node package task start response lost ownership.");
          const afterStart = currentRef.current;
          if (
            !mountedRef.current ||
            ownerSequenceRef.current !== ownerSequence ||
            !afterStart.executionEnabled ||
            afterStart.rootPath !== captured.rootPath ||
            afterStart.workspaceId !== capturedWorkspaceId ||
            taskRef.current?.runId !== runId
          ) {
            const owner = taskRef.current?.runId === runId ? taskRef.current : null;
            if (owner) requestBackendStop(owner);
            else
              requestBackendStop({
                runId,
                workspaceId: capturedWorkspaceId,
                sessionId,
                manifestRelativePath: capturedScript.manifestRelativePath,
                scriptName: capturedScript.scriptName,
                status: "stopping",
              });
            return;
          }
          await runGateway.acknowledgeNodePackageTaskStart({
            runId,
            workspaceId: capturedWorkspaceId,
          });
          const afterAcknowledgement = currentRef.current;
          if (
            !mountedRef.current ||
            ownerSequenceRef.current !== ownerSequence ||
            !afterAcknowledgement.executionEnabled ||
            afterAcknowledgement.rootPath !== captured.rootPath ||
            afterAcknowledgement.workspaceId !== capturedWorkspaceId ||
            taskRef.current?.runId !== runId
          ) {
            const owner = taskRef.current?.runId === runId ? taskRef.current : null;
            if (owner) requestBackendStop(owner);
            return;
          }
          transition({ type: "start-accepted", runId });
        })().catch((error: unknown) => {
          const owner = taskRef.current?.runId === runId ? taskRef.current : null;
          const isCurrentOwner =
            mountedRef.current &&
            ownerSequenceRef.current === ownerSequence &&
            owner?.runId === runId &&
            currentRef.current.workspaceId === capturedWorkspaceId;
          if (isCurrentOwner) reportError(error);
          const operationKey = taskOperationKey(capturedWorkspaceId, runId);
          if (startDispatchedRef.current.has(operationKey)) {
            if (owner) {
              const stopping = transition({ type: "stopping", runId });
              if (stopping) requestBackendStop(stopping, true);
            } else {
              requestBackendStop({
                runId,
                workspaceId: capturedWorkspaceId,
                sessionId,
                manifestRelativePath: capturedScript.manifestRelativePath,
                scriptName: capturedScript.scriptName,
                status: "stopping",
              });
            }
          }
          if (
            isCurrentOwner &&
            nodePackageTaskIsActive(taskRef.current) &&
            !startDispatchedRef.current.has(operationKey)
          ) {
            transition({ type: "start-rejected", runId, message: errorMessage(error) });
          }
        });
      });
      return true;
    },
    [
      additionalSubscriptionReadyRef,
      createRunId,
      reportError,
      requestBackendStop,
      requestTerminalSession,
      runGateway,
      transition,
    ],
  );

  const stop = useCallback(() => {
    const current = taskRef.current;
    if (!current || !nodePackageTaskIsActive(current)) return;
    const stopped =
      current.status === "stopping"
        ? current
        : transition({ type: "stopping", runId: current.runId });
    if (!stopped || stopped.sessionId === null) return;
    requestBackendStop(stopped, true);
  }, [requestBackendStop, transition]);
  const isActive = useCallback(() => nodePackageTaskIsActive(taskRef.current), []);

  return { ...discovery, isActive, pending: nodePackageTaskIsActive(task), run, stop, task };
}

function createNodePackageTaskRunId(): string {
  fallbackRunSequence = (fallbackRunSequence + 1) % Number.MAX_SAFE_INTEGER;
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${fallbackRunSequence}`;
  return `node-task-${random}`;
}

function taskOperationKey(workspaceId: string, runId: string): string {
  return `${workspaceId}\0${runId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not start Node package task.";
}
