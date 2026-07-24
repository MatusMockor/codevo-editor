import type { NodePackageTaskOwner } from "./nodePackageScripts";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { workspaceRelativePath } from "./workspace";

export const MAX_NODE_PACKAGE_TASK_OUTPUT_BYTES = 8_192;
export const MAX_NODE_PACKAGE_TASK_OUTPUT_TOTAL_BYTES = 1_048_576;
export const MAX_NODE_PACKAGE_TASK_OUTPUT_EVENTS = 1_024;
export const MAX_NODE_PACKAGE_TASK_PROBLEMS_PER_EVENT = 32;
export const MAX_NODE_PACKAGE_TASK_PROBLEMS = 256;
export const MAX_NODE_PACKAGE_TASK_PROBLEM_NOTICES = 100;
export const MAX_NODE_PACKAGE_TASK_PROBLEM_MESSAGE_BYTES = 2_048;
export const MAX_NODE_PACKAGE_TASK_PROBLEM_CODE_BYTES = 128;
export const NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX = "node-package-task-problems:";

export type NodePackageProblemMatcher = "eslint" | "typescript";
export type NodePackageTaskOutputStream = "stdout" | "stderr";
export type NodePackageTaskProblemSeverity = "warning" | "error";

export interface NodePackageTaskProblem {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly column: number;
  readonly severity: NodePackageTaskProblemSeverity;
  readonly message: string;
  readonly code: string | null;
  readonly source: "TypeScript" | "ESLint";
}

export interface NodePackageTaskOutputEvent {
  readonly owner: NodePackageTaskOwner;
  readonly sequence: number;
  readonly stream: NodePackageTaskOutputStream;
  readonly data: string;
  readonly truncated: boolean;
}

export interface NodePackageTaskOutputState {
  readonly owner: NodePackageTaskOwner;
  readonly sequence: number;
  readonly bytes: number;
  readonly eventCount: number;
  readonly truncated: boolean;
}

interface NodePackageTaskProblemsEventBase {
  readonly owner: NodePackageTaskOwner;
  readonly sequence: number;
}

export type NodePackageTaskProblemsEvent =
  | (NodePackageTaskProblemsEventBase & { readonly kind: "reset" | "clear" })
  | (NodePackageTaskProblemsEventBase & {
      readonly kind: "append" | "complete";
      readonly problems: readonly NodePackageTaskProblem[];
      readonly total: number;
      readonly truncated: boolean;
    });

export interface NodePackageTaskProblemsGateway {
  subscribeNodePackageTaskOutputEvents(
    handler: (event: NodePackageTaskOutputEvent) => void,
  ): Promise<() => void>;
  subscribeNodePackageTaskProblemsEvents(
    handler: (event: NodePackageTaskProblemsEvent) => void,
  ): Promise<() => void>;
}

export interface NodePackageTaskProblemsState {
  readonly owner: NodePackageTaskOwner;
  readonly sequence: number;
  readonly problems: readonly NodePackageTaskProblem[];
  readonly total: number;
  readonly truncated: boolean;
  readonly complete: boolean;
}

export type NodePackageTaskProblemsAction =
  | { readonly type: "own"; readonly owner: NodePackageTaskOwner }
  | { readonly type: "event"; readonly event: NodePackageTaskProblemsEvent }
  | { readonly type: "clear" };

export function nodePackageProblemMatcherForScript(
  scriptName: string,
): NodePackageProblemMatcher | null {
  if (scriptName === "lint" || scriptName === "eslint" || scriptName.endsWith(":lint")) {
    return "eslint";
  }
  if (
    scriptName === "typecheck" ||
    scriptName === "type-check" ||
    scriptName === "tsc" ||
    scriptName.endsWith(":typecheck")
  ) {
    return "typescript";
  }
  return null;
}

export function reduceNodePackageTaskProblems(
  state: NodePackageTaskProblemsState | null,
  action: NodePackageTaskProblemsAction,
): NodePackageTaskProblemsState | null {
  if (action.type === "clear") return null;
  if (action.type === "own") {
    return state && nodePackageTaskOwnersEqual(state.owner, action.owner)
      ? state
      : emptyProblemsState(action.owner);
  }
  if (
    !state ||
    !nodePackageTaskOwnersEqual(state.owner, action.event.owner) ||
    action.event.sequence <= state.sequence
  ) {
    return state;
  }

  const event = action.event;
  if (event.kind === "reset" || event.kind === "clear") {
    return { ...emptyProblemsState(state.owner), sequence: event.sequence };
  }
  if (event.kind === "complete") {
    return {
      owner: state.owner,
      sequence: event.sequence,
      problems: event.problems.slice(0, MAX_NODE_PACKAGE_TASK_PROBLEMS),
      total: event.total,
      truncated: event.truncated || event.problems.length > MAX_NODE_PACKAGE_TASK_PROBLEMS,
      complete: true,
    };
  }
  if (!("problems" in event)) return state;
  if (state.complete) return { ...state, sequence: event.sequence };

  const room = Math.max(0, MAX_NODE_PACKAGE_TASK_PROBLEMS - state.problems.length);
  const problems = [...state.problems, ...event.problems.slice(0, room)];
  return {
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
  };
}

export function reduceNodePackageTaskOutput(
  state: NodePackageTaskOutputState | null,
  action:
    | { readonly type: "own"; readonly owner: NodePackageTaskOwner }
    | { readonly type: "event"; readonly event: NodePackageTaskOutputEvent }
    | { readonly type: "clear" },
): NodePackageTaskOutputState | null {
  if (action.type === "clear") return null;
  if (action.type === "own") {
    return state && nodePackageTaskOwnersEqual(state.owner, action.owner)
      ? state
      : { owner: action.owner, sequence: 0, bytes: 0, eventCount: 0, truncated: false };
  }
  if (
    !state ||
    !nodePackageTaskOwnersEqual(state.owner, action.event.owner) ||
    action.event.sequence <= state.sequence
  )
    return state;
  if (state.truncated) return { ...state, sequence: action.event.sequence };

  const eventBytes = new TextEncoder().encode(action.event.data).byteLength;
  const exceedsCap =
    state.eventCount >= MAX_NODE_PACKAGE_TASK_OUTPUT_EVENTS ||
    state.bytes + eventBytes > MAX_NODE_PACKAGE_TASK_OUTPUT_TOTAL_BYTES;
  if (action.event.truncated || exceedsCap) {
    return { ...state, sequence: action.event.sequence, truncated: true };
  }
  return {
    ...state,
    sequence: action.event.sequence,
    bytes: state.bytes + eventBytes,
    eventCount: state.eventCount + 1,
  };
}

export function nodePackageTaskProblemGroupKey(owner: NodePackageTaskOwner): string {
  return `${NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX}${encodeURIComponent(owner.workspaceId)}:${encodeURIComponent(owner.runId)}`;
}

export function nodePackageTaskProblemsToNotices(
  state: NodePackageTaskProblemsState | null,
  workspaceRoot: string,
): WorkbenchNotice[] {
  if (!state) return [];
  const groupKey = nodePackageTaskProblemGroupKey(state.owner);
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
        "Node Package Task",
        `${hiddenCount} more task problems hidden. Open the file to see complete diagnostics.`,
        groupKey,
        undefined,
        "overflow",
      ),
    );
  }
  return notices;
}

export function nodePackageTaskOwnersEqual(
  left: NodePackageTaskOwner,
  right: NodePackageTaskOwner,
): boolean {
  return (
    left.runId === right.runId &&
    left.workspaceId === right.workspaceId &&
    left.sessionId === right.sessionId &&
    left.manifestRelativePath === right.manifestRelativePath &&
    left.scriptName === right.scriptName
  );
}

function emptyProblemsState(owner: NodePackageTaskOwner): NodePackageTaskProblemsState {
  return { owner, sequence: 0, problems: [], total: 0, truncated: false, complete: false };
}
