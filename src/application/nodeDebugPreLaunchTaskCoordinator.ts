import type { NodeDebugPreLaunchTask } from "../domain/nodeDebugPreLaunchTask";
import type { VscodeProcessTaskCompletion } from "./vscodeProcessTaskCoordinator";
import type { VscodeProcessTaskRunOwnership } from "./useVscodeProcessTasks";

export type NodeDebugPreLaunchOutcome =
  | { readonly status: "started" | "cancelled" | "stale" }
  | {
      readonly status: "busy" | "task-unavailable" | "task-failed" | "error";
    };

export interface NodeDebugPreLaunchRequest {
  readonly task: NodeDebugPreLaunchTask | null;
  readonly workspaceEpoch: number;
  readonly workspaceId: string;
}

/**
 * Shared task lifecycle seam. The workbench Tasks surface implements this with
 * its existing coordinator, so pre-launch output, Stop and ownership remain
 * visible in one place.
 */
export interface NodeDebugPreLaunchTaskExecution {
  startAndWait(
    label: string,
    onOwned?: (ownership: VscodeProcessTaskRunOwnership) => void,
  ): Promise<VscodeProcessTaskCompletion | null>;
}

export interface NodeDebugPreLaunchTaskCoordinator {
  cancel(): Promise<boolean>;
  invalidate(): Promise<boolean>;
  occupied(): boolean;
  run(
    request: NodeDebugPreLaunchRequest,
    startDebug: () => Promise<boolean>,
  ): Promise<NodeDebugPreLaunchOutcome>;
}

interface Operation {
  cancelled: boolean;
  readonly cancellation: Promise<void>;
  executingTask: boolean;
  ownership: VscodeProcessTaskRunOwnership | null;
  readonly resolveCancellation: () => void;
}

/**
 * Places an exact process task completion barrier in front of Node debugging.
 *
 * It receives only launch metadata (`label`) and delegates command ownership to
 * the shared Tasks lifecycle. Debug start is admitted only after exit code 0.
 */
export function createNodeDebugPreLaunchTaskCoordinator(options: {
  readonly execution: NodeDebugPreLaunchTaskExecution;
  readonly isWorkspaceCurrent: (workspaceEpoch: number, workspaceId: string) => boolean;
}): NodeDebugPreLaunchTaskCoordinator {
  let active: Operation | null = null;

  const current = (operation: Operation, request: NodeDebugPreLaunchRequest): boolean =>
    active === operation &&
    !operation.cancelled &&
    safeCurrent(options.isWorkspaceCurrent, request.workspaceEpoch, request.workspaceId);

  const finish = (
    operation: Operation,
    result: NodeDebugPreLaunchOutcome,
  ): NodeDebugPreLaunchOutcome => {
    if (active === operation) active = null;
    return result;
  };

  const cancel = async (): Promise<boolean> => {
    const operation = active;
    if (!operation) return false;
    operation.cancelled = true;
    operation.resolveCancellation();
    if (!operation.executingTask) {
      if (active === operation) active = null;
      return true;
    }
    const stopped = operation.ownership ? await safelyCancel(operation.ownership) : true;
    if (active === operation) active = null;
    return stopped;
  };

  return Object.freeze({
    cancel,
    invalidate: cancel,
    occupied: () => active !== null,
    run: async (
      request: NodeDebugPreLaunchRequest,
      startDebug: () => Promise<boolean>,
    ): Promise<NodeDebugPreLaunchOutcome> => {
      if (
        active ||
        !validRequest(request) ||
        !safeCurrent(options.isWorkspaceCurrent, request.workspaceEpoch, request.workspaceId)
      ) {
        return outcome("busy");
      }
      const cancellation = deferredCancellation();
      const operation: Operation = {
        cancelled: false,
        cancellation: cancellation.promise,
        executingTask: false,
        ownership: null,
        resolveCancellation: cancellation.resolve,
      };
      active = operation;

      if (request.task) {
        operation.executingTask = true;
        const race = await Promise.race([
          safelyRunTask(options.execution, request.task.label, (ownership) => {
            operation.ownership = ownership;
            if (operation.cancelled) void safelyCancel(ownership);
          }).then((completion) => ({
            kind: "completion" as const,
            completion,
          })),
          operation.cancellation.then(() => ({ kind: "cancelled" as const })),
        ]);
        operation.executingTask = false;
        if (race.kind === "cancelled" || operation.cancelled) {
          return finish(operation, outcome("cancelled"));
        }
        if (!current(operation, request)) {
          return finish(operation, outcome("stale"));
        }
        const taskOutcome = completionOutcome(race.completion);
        if (taskOutcome) return finish(operation, taskOutcome);
      }

      if (!current(operation, request)) {
        return finish(operation, operation.cancelled ? outcome("cancelled") : outcome("stale"));
      }
      const debugOutcome = await safelyStartDebug(startDebug);
      if (operation.cancelled) return finish(operation, outcome("cancelled"));
      if (!safeCurrent(options.isWorkspaceCurrent, request.workspaceEpoch, request.workspaceId)) {
        return finish(operation, outcome("stale"));
      }
      return finish(operation, debugOutcome);
    },
  });
}

function completionOutcome(
  completion: VscodeProcessTaskCompletion | null,
): NodeDebugPreLaunchOutcome | null {
  if (completion === null) return outcome("task-unavailable");
  if (completion.status === "exited") {
    return completion.exitCode === 0 ? null : outcome("task-failed");
  }
  if (completion.status === "stale") return outcome("stale");
  return outcome("task-failed");
}

async function safelyRunTask(
  execution: NodeDebugPreLaunchTaskExecution,
  label: string,
  onOwned: (ownership: VscodeProcessTaskRunOwnership) => void,
): Promise<VscodeProcessTaskCompletion | null> {
  try {
    return await execution.startAndWait(label, onOwned);
  } catch {
    return null;
  }
}

async function safelyCancel(ownership: VscodeProcessTaskRunOwnership): Promise<boolean> {
  try {
    return await ownership.cancel();
  } catch {
    return false;
  }
}

async function safelyStartDebug(
  startDebug: () => Promise<boolean>,
): Promise<NodeDebugPreLaunchOutcome> {
  try {
    return outcome((await startDebug()) === true ? "started" : "error");
  } catch {
    return outcome("error");
  }
}

function safeCurrent(
  isWorkspaceCurrent: (workspaceEpoch: number, workspaceId: string) => boolean,
  workspaceEpoch: number,
  workspaceId: string,
): boolean {
  try {
    return isWorkspaceCurrent(workspaceEpoch, workspaceId) === true;
  } catch {
    return false;
  }
}

function validRequest(request: NodeDebugPreLaunchRequest): boolean {
  return (
    Number.isSafeInteger(request.workspaceEpoch) &&
    request.workspaceEpoch >= 0 &&
    request.workspaceId.length > 0
  );
}

function deferredCancellation(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function outcome<T extends NodeDebugPreLaunchOutcome["status"]>(
  status: T,
): Extract<NodeDebugPreLaunchOutcome, { status: T }> {
  return Object.freeze({ status }) as Extract<NodeDebugPreLaunchOutcome, { status: T }>;
}
