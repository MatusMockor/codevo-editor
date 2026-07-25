import {
  MAX_NODE_PACKAGE_TASK_PROBLEM_NOTICES,
  MAX_NODE_PACKAGE_TASK_PROBLEMS,
  NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX,
  type NodePackageTaskProblem,
} from "./nodePackageTaskProblems";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { workspaceRelativePath } from "./workspace";

export const MAX_VSCODE_PROCESS_TASK_OUTPUT_EVENTS = 1_024;
export const MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES = 1_048_576;

export type VscodeProcessTaskGroup = "build" | "test" | "none";
export type VscodeProcessTaskProblemMatcher = "eslint" | "typescript";
export type VscodeProcessTaskDiagnosticSeverity = "error" | "warning";
export type VscodeProcessTaskStream = "stdout" | "stderr";
export type VscodeProcessTaskTerminalStatus = "exited" | "failed" | "stopped";

export interface VscodeProcessTaskOwner {
  readonly runId: string;
  readonly workspaceId: string;
  readonly sessionId: number;
  readonly label: string;
  readonly configRevision: string;
}

export interface VscodeProcessTaskDisplay {
  readonly label: string;
  readonly detail: string | null;
  readonly group: VscodeProcessTaskGroup;
  readonly source: string;
  readonly executable: boolean;
  readonly dependsOn: readonly string[];
  readonly problemMatcher: VscodeProcessTaskProblemMatcher | null;
}

export interface VscodeProcessTaskDiagnostic {
  readonly severity: VscodeProcessTaskDiagnosticSeverity;
  readonly message: string;
}

export interface VscodeProcessTaskStep {
  readonly label: string;
  readonly index: number;
  readonly total: number;
}

export interface VscodeProcessTasksSnapshot {
  readonly configRevision: string;
  readonly tasks: readonly VscodeProcessTaskDisplay[];
  readonly diagnostics: readonly VscodeProcessTaskDiagnostic[];
  readonly truncated: boolean;
}

export type VscodeProcessTaskEvent =
  | {
      readonly kind: "output";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly stream: VscodeProcessTaskStream;
      readonly data: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "step";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly label: string;
      readonly index: number;
      readonly total: number;
    }
  | {
      readonly kind: "problems";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly state: "reset" | "clear";
    }
  | {
      readonly kind: "problems";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly state: "append" | "complete";
      readonly problems: readonly NodePackageTaskProblem[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "status";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly status: "running";
    }
  | {
      readonly kind: "status";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly status: "exited";
      readonly exitCode: number | null;
    }
  | {
      readonly kind: "status";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly status: "failed";
      readonly message: string;
    }
  | {
      readonly kind: "status";
      readonly owner: VscodeProcessTaskOwner;
      readonly sequence: number;
      readonly status: "stopped";
    };

export type VscodeProcessTaskOutputEntry =
  | {
      readonly kind: "data";
      readonly stream: VscodeProcessTaskStream;
      readonly data: string;
    }
  | {
      readonly kind: "step";
      readonly label: string;
      readonly index: number;
      readonly total: number;
    }
  | { readonly kind: "truncated" };

export interface VscodeProcessTaskState {
  readonly owner: VscodeProcessTaskOwner;
  readonly sequence: number;
  readonly status: "pending" | "running" | VscodeProcessTaskTerminalStatus;
  readonly exitCode: number | null;
  readonly failure: string | null;
  readonly currentStep: VscodeProcessTaskStep | null;
  readonly output: readonly VscodeProcessTaskOutputEntry[];
  readonly outputBytes: number;
  readonly outputEventCount: number;
  readonly outputTruncated: boolean;
}

export type VscodeProcessTaskProblem = NodePackageTaskProblem;

export interface VscodeProcessTaskProblemsState {
  readonly owner: VscodeProcessTaskOwner;
  readonly sequence: number;
  readonly problems: readonly VscodeProcessTaskProblem[];
  readonly total: number;
  readonly truncated: boolean;
  readonly complete: boolean;
}

export type VscodeProcessTaskProblemsAction =
  | { readonly type: "own"; readonly owner: VscodeProcessTaskOwner }
  | {
      readonly type: "event";
      readonly event: Extract<VscodeProcessTaskEvent, { readonly kind: "problems" }>;
    }
  | { readonly type: "clear" };

export type VscodeProcessTaskAction =
  | { readonly type: "own"; readonly owner: VscodeProcessTaskOwner }
  | { readonly type: "event"; readonly event: VscodeProcessTaskEvent }
  | { readonly type: "clear" };

const UTF8_ENCODER = new TextEncoder();

export function reduceVscodeProcessTask(
  state: VscodeProcessTaskState | null,
  action: VscodeProcessTaskAction,
): VscodeProcessTaskState | null {
  if (action.type === "clear") return null;
  if (action.type === "own") {
    return state && vscodeProcessTaskOwnersEqual(state.owner, action.owner)
      ? state
      : emptyState(action.owner);
  }
  if (
    !state ||
    !vscodeProcessTaskOwnersEqual(state.owner, action.event.owner) ||
    action.event.sequence <= state.sequence ||
    isTerminal(state.status)
  ) {
    return state;
  }

  const event = action.event;
  if (event.kind === "step") {
    const validTransition =
      state.status === "running" &&
      Number.isSafeInteger(event.index) &&
      Number.isSafeInteger(event.total) &&
      event.total >= 1 &&
      event.index >= 1 &&
      event.index <= event.total &&
      (state.currentStep === null
        ? event.index === 1
        : event.total === state.currentStep.total && event.index === state.currentStep.index + 1);
    if (!validTransition) return state;
    const currentStep = Object.freeze({
      label: event.label,
      index: event.index,
      total: event.total,
    });
    return frozenState({
      ...state,
      sequence: event.sequence,
      currentStep,
      output: Object.freeze([
        ...state.output,
        Object.freeze({
          kind: "step" as const,
          label: event.label,
          index: event.index,
          total: event.total,
        }),
      ]),
    });
  }
  if (event.kind === "status") {
    if (event.status === "running") {
      return frozenState({ ...state, sequence: event.sequence, status: "running" });
    }
    if (event.status === "exited") {
      return frozenState({
        ...state,
        sequence: event.sequence,
        status: "exited",
        exitCode: event.exitCode,
      });
    }
    if (event.status === "failed") {
      return frozenState({
        ...state,
        sequence: event.sequence,
        status: "failed",
        failure: event.message,
      });
    }
    return frozenState({ ...state, sequence: event.sequence, status: "stopped" });
  }
  if (event.kind === "problems") return state;

  if (state.currentStep === null) return state;
  if (state.outputTruncated) {
    return frozenState({ ...state, sequence: event.sequence });
  }
  if (event.truncated) {
    return frozenState({
      ...state,
      sequence: event.sequence,
      output: Object.freeze([...state.output, Object.freeze({ kind: "truncated" as const })]),
      outputTruncated: true,
    });
  }
  const eventBytes = UTF8_ENCODER.encode(event.data).byteLength;
  return appendBoundedOutput(
    state,
    event.sequence,
    eventBytes,
    Object.freeze({ kind: "data" as const, stream: event.stream, data: event.data }),
  );
}

export function reduceVscodeProcessTaskProblems(
  state: VscodeProcessTaskProblemsState | null,
  action: VscodeProcessTaskProblemsAction,
): VscodeProcessTaskProblemsState | null {
  if (action.type === "clear") return null;
  if (action.type === "own") {
    return state && vscodeProcessTaskOwnersEqual(state.owner, action.owner)
      ? state
      : emptyProblemsState(action.owner);
  }
  if (
    !state ||
    !vscodeProcessTaskOwnersEqual(state.owner, action.event.owner) ||
    action.event.sequence <= state.sequence
  ) {
    return state;
  }

  const event = action.event;
  if (event.state === "reset" || event.state === "clear") {
    return Object.freeze({ ...emptyProblemsState(state.owner), sequence: event.sequence });
  }
  if (!("problems" in event)) return state;
  if (event.state === "complete") {
    const problems = Object.freeze(event.problems.slice(0, MAX_NODE_PACKAGE_TASK_PROBLEMS));
    return Object.freeze({
      owner: state.owner,
      sequence: event.sequence,
      problems,
      total: event.total,
      truncated: event.truncated || event.problems.length > MAX_NODE_PACKAGE_TASK_PROBLEMS,
      complete: true,
    });
  }
  if (state.complete) return Object.freeze({ ...state, sequence: event.sequence });

  const room = Math.max(0, MAX_NODE_PACKAGE_TASK_PROBLEMS - state.problems.length);
  const problems = Object.freeze([...state.problems, ...event.problems.slice(0, room)]);
  return Object.freeze({
    owner: state.owner,
    sequence: event.sequence,
    problems,
    total: event.total,
    truncated:
      state.truncated ||
      event.truncated ||
      event.total > problems.length ||
      event.problems.length > room,
    complete: false,
  });
}

export function vscodeProcessTaskProblemGroupKey(owner: VscodeProcessTaskOwner): string {
  const ownerKey = [
    owner.workspaceId,
    owner.runId,
    String(owner.sessionId),
    owner.label,
    owner.configRevision,
  ]
    .map(encodeURIComponent)
    .join(":");
  return `${NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX}${ownerKey}`;
}

export function vscodeProcessTaskProblemsToNotices(
  state: VscodeProcessTaskProblemsState | null,
  workspaceRoot: string,
): WorkbenchNotice[] {
  if (!state) return [];
  const groupKey = vscodeProcessTaskProblemGroupKey(state.owner);
  const retainedProblems = state.problems.filter(
    (problem) => workspaceRelativePath(workspaceRoot, problem.filePath) !== null,
  );
  const notices = retainedProblems.slice(0, MAX_NODE_PACKAGE_TASK_PROBLEM_NOTICES).map((problem) =>
    createWorkbenchNotice(
      problem.severity,
      problem.source,
      problem.code ? `${problem.message} (${problem.code})` : problem.message,
      groupKey,
      {
        path: problem.filePath,
        range: {
          start: { lineNumber: problem.lineNumber, column: problem.column },
          end: { lineNumber: problem.lineNumber, column: problem.column },
        },
      },
    ),
  );
  const hiddenCount =
    (retainedProblems.length === state.problems.length ? state.total : retainedProblems.length) -
    notices.length;
  if (hiddenCount > 0) {
    notices.push(
      createWorkbenchNotice(
        "info",
        "Configured Task",
        `${hiddenCount} more task problems hidden. Open the file to see complete diagnostics.`,
        groupKey,
        undefined,
        "overflow",
      ),
    );
  }
  return notices;
}

function appendBoundedOutput(
  state: VscodeProcessTaskState,
  sequence: number,
  eventBytes: number,
  entry: VscodeProcessTaskOutputEntry,
): VscodeProcessTaskState {
  const exceedsCap =
    state.outputEventCount >= MAX_VSCODE_PROCESS_TASK_OUTPUT_EVENTS ||
    state.outputBytes + eventBytes > MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES;
  if (exceedsCap) {
    return frozenState({
      ...state,
      sequence,
      output: Object.freeze([...state.output, Object.freeze({ kind: "truncated" as const })]),
      outputTruncated: true,
    });
  }
  return frozenState({
    ...state,
    sequence,
    output: Object.freeze([...state.output, entry]),
    outputBytes: state.outputBytes + eventBytes,
    outputEventCount: state.outputEventCount + 1,
  });
}

export function vscodeProcessTaskOwnersEqual(
  left: VscodeProcessTaskOwner,
  right: VscodeProcessTaskOwner,
): boolean {
  return (
    left.runId === right.runId &&
    left.workspaceId === right.workspaceId &&
    left.sessionId === right.sessionId &&
    left.label === right.label &&
    left.configRevision === right.configRevision
  );
}

function emptyState(owner: VscodeProcessTaskOwner): VscodeProcessTaskState {
  const immutableOwner = Object.freeze({ ...owner });
  return frozenState({
    owner: immutableOwner,
    sequence: 0,
    status: "pending",
    exitCode: null,
    failure: null,
    currentStep: null,
    output: Object.freeze([]),
    outputBytes: 0,
    outputEventCount: 0,
    outputTruncated: false,
  });
}

function emptyProblemsState(owner: VscodeProcessTaskOwner): VscodeProcessTaskProblemsState {
  return Object.freeze({
    owner: Object.freeze({ ...owner }),
    sequence: 0,
    problems: Object.freeze([]),
    total: 0,
    truncated: false,
    complete: false,
  });
}

function frozenState(state: VscodeProcessTaskState): VscodeProcessTaskState {
  return Object.freeze(state);
}

function isTerminal(status: VscodeProcessTaskState["status"]): boolean {
  return status === "exited" || status === "failed" || status === "stopped";
}
