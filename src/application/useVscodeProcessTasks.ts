import { useCallback, useEffect, useRef, useState } from "react";
import type {
  VscodeProcessTaskDiagnostic,
  VscodeProcessTaskDisplay,
  VscodeProcessTaskOutputEntry,
  VscodeProcessTaskOwner,
  VscodeProcessTaskState,
  VscodeProcessTasksSnapshot,
} from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import {
  createVscodeProcessTaskCoordinator,
  type VscodeProcessTaskCompletion,
  type VscodeProcessTaskCoordinatorSnapshot,
} from "./vscodeProcessTaskCoordinator";

export interface UseVscodeProcessTasksOptions {
  readonly configurationVersion: number;
  readonly createRunId?: () => string | null;
  readonly gateway: VscodeProcessTasksGateway;
  readonly requestTerminalSession: () => Promise<number | null>;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

export interface VscodeProcessTasksState {
  readonly activeLabel: string | null;
  readonly configRevision: string | null;
  readonly currentStep: VscodeProcessTaskState["currentStep"];
  readonly diagnostics: readonly VscodeProcessTaskDiagnostic[];
  readonly discovering: boolean;
  readonly error: string | null;
  readonly output: readonly VscodeProcessTaskOutputEntry[];
  readonly occupied: boolean;
  readonly running: boolean;
  readonly status: VscodeProcessTaskState["status"] | null;
  readonly stopping: boolean;
  readonly tasks: readonly VscodeProcessTaskDisplay[];
  readonly truncated: boolean;
  readonly unavailable: string | null;
  discover(): Promise<boolean>;
  start(label: string): Promise<boolean>;
  startAndWait(
    label: string,
    onOwned?: (ownership: VscodeProcessTaskRunOwnership) => void,
  ): Promise<VscodeProcessTaskCompletion | null>;
  stop(): Promise<boolean>;
}

/**
 * Capability for one exact process-task run. It deliberately exposes neither
 * the backend owner nor its run id, so consumers can cancel only the run they
 * were admitted to and cannot forge or retarget ownership.
 */
export interface VscodeProcessTaskRunOwnership {
  cancel(): Promise<boolean>;
}

interface ActivationBoundary {
  readonly configurationVersion: number;
  readonly gateway: VscodeProcessTasksGateway;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

interface PendingTerminalAdmission {
  readonly activation: number;
  readonly identity: object;
  readonly label: string;
  readonly workspaceId: string;
}

const EMPTY_TASKS: readonly VscodeProcessTaskDisplay[] = Object.freeze([]);
const EMPTY_DIAGNOSTICS: readonly VscodeProcessTaskDiagnostic[] = Object.freeze([]);
const EMPTY_OUTPUT: readonly VscodeProcessTaskOutputEntry[] = Object.freeze([]);
const EMPTY_COORDINATOR_SNAPSHOT: VscodeProcessTaskCoordinatorSnapshot = Object.freeze({
  activation: null,
  owner: null,
  task: null,
  running: false,
  stopping: false,
});

let nextRunSequence = 0;

export function useVscodeProcessTasks({
  configurationVersion,
  createRunId = defaultRunId,
  gateway,
  requestTerminalSession,
  rootPath,
  workspaceId,
  workspaceTrusted,
}: UseVscodeProcessTasksOptions): VscodeProcessTasksState {
  const mountedRef = useRef(true);
  const activationRef = useRef(0);
  const boundaryRef = useRef<ActivationBoundary | null>(null);
  const boundary: ActivationBoundary = {
    configurationVersion,
    gateway,
    rootPath,
    workspaceId,
    workspaceTrusted,
  };
  if (!sameBoundary(boundaryRef.current, boundary)) {
    boundaryRef.current = boundary;
    activationRef.current += 1;
  }
  const activation = activationRef.current;
  const currentRef = useRef({ activation, gateway, workspaceId, workspaceTrusted });
  currentRef.current = { activation, gateway, workspaceId, workspaceTrusted };
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const [discoveryEntry, setDiscoveryEntry] = useState<{
    readonly activation: number;
    readonly snapshot: VscodeProcessTasksSnapshot;
  } | null>(null);
  const discovery = discoveryEntry?.activation === activation ? discoveryEntry.snapshot : null;
  const discoveryRef = useRef<{
    readonly activation: number;
    readonly snapshot: VscodeProcessTasksSnapshot;
  } | null>(null);
  discoveryRef.current = discoveryEntry;
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverySequenceRef = useRef(0);
  const startAdmissionRef = useRef<PendingTerminalAdmission | null>(null);
  const [pendingAdmission, setPendingAdmission] = useState<PendingTerminalAdmission | null>(null);
  const [execution, setExecution] = useState<VscodeProcessTaskCoordinatorSnapshot>(
    EMPTY_COORDINATOR_SNAPSHOT,
  );
  const [coordinator] = useState(() =>
    createVscodeProcessTaskCoordinator({
      getGateway: () => gatewayRef.current,
      isCurrent: (candidateActivation, owner) => {
        const current = currentRef.current;
        return (
          current.activation === candidateActivation &&
          current.workspaceTrusted &&
          current.workspaceId === owner.workspaceId
        );
      },
      onSnapshot: (snapshot) => {
        if (!mountedRef.current) return;
        setExecution(snapshot);
      },
    }),
  );

  const discover = useCallback(async (): Promise<boolean> => {
    if (!workspaceTrusted || !workspaceId || !rootPath) return false;
    const capturedActivation = activation;
    const sequence = discoverySequenceRef.current + 1;
    discoverySequenceRef.current = sequence;
    setDiscovering(true);
    setError(null);
    try {
      const result = await gateway.discoverVscodeProcessTasks(workspaceId);
      if (
        !mountedRef.current ||
        activationRef.current !== capturedActivation ||
        discoverySequenceRef.current !== sequence
      ) {
        return false;
      }
      const entry = Object.freeze({ activation: capturedActivation, snapshot: result });
      discoveryRef.current = entry;
      setDiscoveryEntry(entry);
      return true;
    } catch {
      if (
        mountedRef.current &&
        activationRef.current === capturedActivation &&
        discoverySequenceRef.current === sequence
      ) {
        discoveryRef.current = null;
        setDiscoveryEntry(null);
        setError("Tasks could not be refreshed.");
      }
      return false;
    } finally {
      if (
        mountedRef.current &&
        activationRef.current === capturedActivation &&
        discoverySequenceRef.current === sequence
      ) {
        setDiscovering(false);
      }
    }
  }, [activation, gateway, rootPath, workspaceId, workspaceTrusted]);

  const start = useCallback(
    async (label: string): Promise<boolean> => {
      const currentDiscoveryEntry = discoveryRef.current;
      const currentDiscovery =
        currentDiscoveryEntry?.activation === activation ? currentDiscoveryEntry.snapshot : null;
      const selected = currentDiscovery?.tasks.find((task) => task.label === label);
      if (
        !currentDiscovery ||
        !selected?.executable ||
        !workspaceId ||
        !rootPath ||
        !workspaceTrusted ||
        execution.running ||
        execution.stopping ||
        startAdmissionRef.current !== null
      ) {
        return false;
      }
      const admission: PendingTerminalAdmission = Object.freeze({
        activation,
        identity: Object.freeze({}),
        label: selected.label,
        workspaceId,
      });
      startAdmissionRef.current = admission;
      setPendingAdmission(admission);
      setError(null);
      const capturedActivation = activation;
      let owner: VscodeProcessTaskOwner;
      try {
        const sessionId = await requestTerminalSession();
        if (
          !mountedRef.current ||
          activationRef.current !== capturedActivation ||
          startAdmissionRef.current?.identity !== admission.identity
        ) {
          return false;
        }
        if (
          sessionId === null ||
          !Number.isSafeInteger(sessionId) ||
          sessionId < 0 ||
          sessionId > 0xffff_ffff
        ) {
          if (mountedRef.current && activationRef.current === capturedActivation) {
            setError("Unable to start configured task. Refresh and try again.");
          }
          return false;
        }
        const runId = createRunId();
        if (runId === null) throw new Error("Run id sequence exhausted.");
        owner = Object.freeze({
          runId,
          workspaceId,
          sessionId,
          label: selected.label,
          configRevision: currentDiscovery.configRevision,
        });
      } catch {
        if (
          mountedRef.current &&
          activationRef.current === capturedActivation &&
          startAdmissionRef.current?.identity === admission.identity
        ) {
          setError("Unable to start configured task. Refresh and try again.");
        }
        return false;
      } finally {
        if (startAdmissionRef.current?.identity === admission.identity) {
          startAdmissionRef.current = null;
          if (mountedRef.current) setPendingAdmission(null);
        }
      }
      setError(null);
      const outcome = await coordinator.start({ activation, owner });
      if (activationRef.current !== activation) return false;
      if (outcome.status === "error") {
        setError("Unable to start configured task. Refresh and try again.");
        return false;
      }
      return outcome.status === "started";
    },
    [
      activation,
      coordinator,
      createRunId,
      execution.running,
      execution.stopping,
      requestTerminalSession,
      rootPath,
      workspaceId,
      workspaceTrusted,
    ],
  );

  const stop = useCallback(async (): Promise<boolean> => {
    const admission = startAdmissionRef.current;
    if (admission) {
      startAdmissionRef.current = null;
      if (mountedRef.current) setPendingAdmission(null);
      return true;
    }
    return coordinator.cancel();
  }, [coordinator]);

  const startAndWait = useCallback(
    async (
      label: string,
      onOwned?: (ownership: VscodeProcessTaskRunOwnership) => void,
    ): Promise<VscodeProcessTaskCompletion | null> => {
      if (!(await discover())) return null;
      if (!(await start(label))) return null;
      const owner = coordinator.snapshot().owner;
      if (!owner || owner.label !== label) return Object.freeze({ status: "stale" });
      if (onOwned) {
        const ownership: VscodeProcessTaskRunOwnership = Object.freeze({
          cancel: () => coordinator.cancelExact(owner),
        });
        try {
          onOwned(ownership);
        } catch {
          // Ownership observers do not own the process lifecycle.
        }
      }
      return coordinator.waitForTerminal(owner);
    },
    [coordinator, discover, start],
  );

  useEffect(() => {
    discoverySequenceRef.current += 1;
    startAdmissionRef.current = null;
    setPendingAdmission(null);
    discoveryRef.current = null;
    setDiscoveryEntry(null);
    setDiscovering(false);
    setError(null);
    setExecution(EMPTY_COORDINATOR_SNAPSHOT);
    void coordinator.invalidate();
    if (workspaceTrusted && workspaceId && rootPath) void discover();
  }, [activation, coordinator, discover, rootPath, workspaceId, workspaceTrusted]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discoverySequenceRef.current += 1;
      startAdmissionRef.current = null;
      void coordinator.invalidate();
    };
  }, [coordinator]);

  const currentExecution =
    execution.activation === activation ? execution : EMPTY_COORDINATOR_SNAPSHOT;
  const currentPending =
    pendingAdmission?.activation === activation &&
    pendingAdmission.workspaceId === workspaceId &&
    startAdmissionRef.current?.identity === pendingAdmission.identity
      ? pendingAdmission
      : null;
  const unavailable = !workspaceTrusted
    ? "Trust this workspace to run configured tasks."
    : !workspaceId || !rootPath
      ? "Open a workspace to discover configured tasks."
      : null;

  return Object.freeze({
    activeLabel: currentPending?.label ?? currentExecution.owner?.label ?? null,
    configRevision: discovery?.configRevision ?? null,
    currentStep: currentExecution.task?.currentStep ?? null,
    diagnostics: discovery?.diagnostics ?? EMPTY_DIAGNOSTICS,
    discover,
    discovering,
    error,
    output: currentExecution.task?.output ?? EMPTY_OUTPUT,
    occupied: currentPending !== null || execution.running || execution.stopping,
    running: currentPending !== null || currentExecution.running,
    start,
    startAndWait,
    status: currentPending ? "pending" : (currentExecution.task?.status ?? null),
    stop,
    stopping: execution.stopping,
    tasks: discovery?.tasks ?? EMPTY_TASKS,
    truncated: discovery?.truncated ?? false,
    unavailable,
  });
}

function sameBoundary(previous: ActivationBoundary | null, next: ActivationBoundary): boolean {
  return (
    previous !== null &&
    previous.configurationVersion === next.configurationVersion &&
    previous.gateway === next.gateway &&
    previous.rootPath === next.rootPath &&
    previous.workspaceId === next.workspaceId &&
    previous.workspaceTrusted === next.workspaceTrusted
  );
}

function defaultRunId(): string | null {
  const next = nextVscodeProcessTaskRunId(nextRunSequence);
  if (!next) return null;
  nextRunSequence = next.sequence;
  return next.runId;
}

export function nextVscodeProcessTaskRunId(
  currentSequence: number,
): { readonly runId: string; readonly sequence: number } | null {
  if (
    !Number.isSafeInteger(currentSequence) ||
    currentSequence < 0 ||
    currentSequence >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  const sequence = currentSequence + 1;
  return Object.freeze({ runId: `vscode-task-${sequence}`, sequence });
}
