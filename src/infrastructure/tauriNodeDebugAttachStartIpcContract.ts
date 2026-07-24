import type {
  Breakpoint,
  DebugExceptionPauseMode,
  DebugExceptionTypeFilter,
} from "../domain/debug";
import { isExceptionTypeFilter } from "../domain/debugExceptionTypeFilter";
import { isNodeDebugAttachCandidateLeaseId } from "../domain/nodeDebugAttachCandidate";
import type { NodeDebugJustMyCodePolicy } from "../domain/nodeDebugJustMyCode";
import { decodeDebugStartResponse, type DebugStartResponseWire } from "./tauriDebugIpcContract";

export const DEBUG_START_NODE_ATTACH_CANDIDATE_IPC_COMMAND =
  "debug_start_node_attach_candidate" as const;
export const NODE_DEBUG_ATTACH_START_FAILED =
  "Node attach candidate could not be started safely." as const;

export interface NodeDebugAttachCandidateStartRequest {
  readonly rootPath: string;
  readonly candidateLeaseId: string;
  readonly breakpoints: readonly Breakpoint[];
  readonly exceptionPauseMode: DebugExceptionPauseMode;
  readonly exceptionTypeFilter: DebugExceptionTypeFilter;
  readonly justMyCode?: NodeDebugJustMyCodePolicy;
}

export type InvokeNodeDebugAttachStartCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const GENERIC_FAILED_START: DebugStartResponseWire = Object.freeze({
  status: "error",
  message: NODE_DEBUG_ATTACH_START_FAILED,
});

export async function invokeNodeDebugAttachCandidateStartIpc(
  invokeCommand: InvokeNodeDebugAttachStartCommand,
  request: NodeDebugAttachCandidateStartRequest,
): Promise<DebugStartResponseWire> {
  if (!isNodeDebugAttachCandidateLeaseId(request.candidateLeaseId)) {
    return GENERIC_FAILED_START;
  }
  const exceptionTypeFilter = snapshotExceptionTypeFilter(request);
  if (!isExceptionTypeFilter(exceptionTypeFilter)) {
    return GENERIC_FAILED_START;
  }
  try {
    return decodeDebugStartResponse(
      await invokeCommand(DEBUG_START_NODE_ATTACH_CANDIDATE_IPC_COMMAND, {
        request: exactRequest(request, exceptionTypeFilter),
      }),
    );
  } catch {
    // Transport and decode failures are deliberately indistinguishable. Never
    // include the lease capability or backend exception text in the result.
    return GENERIC_FAILED_START;
  }
}

function snapshotExceptionTypeFilter(request: NodeDebugAttachCandidateStartRequest): unknown {
  try {
    const filter: unknown = request.exceptionTypeFilter;
    if (!Array.isArray(filter)) return filter;
    return [...filter];
  } catch {
    return null;
  }
}

function exactRequest(
  request: NodeDebugAttachCandidateStartRequest,
  exceptionTypeFilter: DebugExceptionTypeFilter,
) {
  return {
    rootPath: request.rootPath,
    candidateLeaseId: request.candidateLeaseId,
    breakpoints: request.breakpoints.map(exactBreakpoint),
    exceptionPauseMode: request.exceptionPauseMode,
    exceptionTypeFilter: [...exceptionTypeFilter],
    justMyCode: request.justMyCode ?? null,
  };
}

function exactBreakpoint(breakpoint: Breakpoint): Breakpoint {
  return {
    id: breakpoint.id,
    filePath: breakpoint.filePath,
    lineNumber: breakpoint.lineNumber,
    ...(breakpoint.columnNumber === undefined ? {} : { columnNumber: breakpoint.columnNumber }),
    condition: breakpoint.condition ?? null,
    ...(breakpoint.hitCondition === undefined || breakpoint.hitCondition === null
      ? {}
      : {
          hitCondition: {
            kind: breakpoint.hitCondition.kind,
            count: breakpoint.hitCondition.count,
          },
        }),
    logMessage: breakpoint.logMessage ?? null,
    enabled: breakpoint.enabled,
    verified: breakpoint.verified ?? false,
  };
}
