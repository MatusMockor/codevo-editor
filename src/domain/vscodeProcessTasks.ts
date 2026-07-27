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
export const MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS = 128 * 1_024;
export const MAX_VSCODE_PROCESS_TASK_OWNER_LABEL_BYTES = 256;
export type VscodeProcessTaskGroup = "build" | "test" | "none";
export type VscodeProcessTaskProblemMatcher = "eslint" | "typescript";
export type VscodeProcessTaskDiagnosticSeverity = "error" | "warning";
export type VscodeProcessTaskStream = "stdout" | "stderr";
export type VscodeProcessTaskTerminalStatus = "exited" | "failed" | "stopped";

export interface VscodeProcessTaskIdentity {
  readonly package: string;
  readonly label: string;
}

export interface VscodeProcessTaskOwner {
  readonly runId: string;
  readonly workspaceId: string;
  readonly sessionId: number;
  readonly label: string;
  readonly configRevision: string;
}

export interface VscodeProcessTaskDisplay {
  readonly package: string;
  readonly label: string;
  readonly configRevision: string;
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

export interface VscodeProcessTaskOutputChunk {
  readonly previous: VscodeProcessTaskOutputChunk | null;
  readonly text: string;
}

export interface VscodeProcessTaskOutputStream {
  readonly chunkCount: number;
  readonly codeUnits: number;
  readonly tail: VscodeProcessTaskOutputChunk | null;
}

export interface VscodeProcessTaskOutput {
  /** Opaque owner-scoped reset boundary for incremental presenters. */
  readonly identity?: object;
  readonly stdout: VscodeProcessTaskOutputStream;
  readonly stderr: VscodeProcessTaskOutputStream;
  readonly truncated: boolean;
}

export interface VscodeProcessTaskOutputTail {
  readonly omitted: boolean;
  readonly text: string;
}

export interface VscodeProcessTaskState {
  readonly owner: VscodeProcessTaskOwner;
  readonly sequence: number;
  readonly status: "pending" | "running" | VscodeProcessTaskTerminalStatus;
  readonly exitCode: number | null;
  readonly failure: string | null;
  readonly currentStep: VscodeProcessTaskStep | null;
  readonly output: VscodeProcessTaskOutput;
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
      output: appendStepBoundary(state.output, currentStep),
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
      output: truncatedOutput(state.output),
      outputTruncated: true,
    });
  }
  const eventBytes = UTF8_ENCODER.encode(event.data).byteLength;
  return appendBoundedOutput(state, event.sequence, eventBytes, event.stream, event.data);
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
  stream: VscodeProcessTaskStream,
  data: string,
): VscodeProcessTaskState {
  const exceedsCap =
    state.outputEventCount >= MAX_VSCODE_PROCESS_TASK_OUTPUT_EVENTS ||
    state.outputBytes + eventBytes > MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES;
  if (exceedsCap) {
    return frozenState({
      ...state,
      sequence,
      output: truncatedOutput(state.output),
      outputTruncated: true,
    });
  }
  return frozenState({
    ...state,
    sequence,
    output: appendStreamData(state.output, stream, data),
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

export function vscodeProcessTaskIdentity(
  task: Pick<VscodeProcessTaskDisplay, "label" | "package">,
): VscodeProcessTaskIdentity | null {
  if (!isNormalizedPackageRoot(task.package)) return null;
  return Object.freeze({ package: task.package, label: task.label });
}

export function encodeVscodeProcessTaskOwnerLabel(
  identity: VscodeProcessTaskIdentity,
): string | null {
  const encoded = JSON.stringify(["v1", identity.package, identity.label]);
  if (UTF8_ENCODER.encode(encoded).byteLength > MAX_VSCODE_PROCESS_TASK_OWNER_LABEL_BYTES) {
    return null;
  }
  return encoded;
}

export function decodeVscodeProcessTaskOwnerLabel(value: string): VscodeProcessTaskIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== "v1" ||
    typeof parsed[1] !== "string" ||
    typeof parsed[2] !== "string" ||
    !isNormalizedPackageRoot(parsed[1])
  ) {
    return null;
  }
  return Object.freeze({ package: parsed[1], label: parsed[2] });
}

function isNormalizedPackageRoot(value: string): boolean {
  if (value === ".") return true;
  if (!value || value.startsWith("/") || value.endsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
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
    output: createVscodeProcessTaskOutput(),
    outputBytes: 0,
    outputEventCount: 0,
    outputTruncated: false,
  });
}

function appendStepBoundary(
  output: VscodeProcessTaskOutput,
  step: VscodeProcessTaskStep,
): VscodeProcessTaskOutput {
  const boundary = `\n--- Step ${step.index} of ${step.total}: ${step.label} ---\n`;
  return outputProjection(
    appendOutputChunk(output.stdout, boundary),
    appendOutputChunk(output.stderr, boundary),
    output.truncated,
    output.identity,
  );
}

function appendStreamData(
  output: VscodeProcessTaskOutput,
  stream: VscodeProcessTaskStream,
  data: string,
): VscodeProcessTaskOutput {
  return outputProjection(
    stream === "stdout" ? appendOutputChunk(output.stdout, data) : output.stdout,
    stream === "stderr" ? appendOutputChunk(output.stderr, data) : output.stderr,
    output.truncated,
    output.identity,
  );
}

function truncatedOutput(output: VscodeProcessTaskOutput): VscodeProcessTaskOutput {
  if (output.truncated) return output;
  return outputProjection(output.stdout, output.stderr, true, output.identity);
}

function outputProjection(
  stdout: VscodeProcessTaskOutputStream,
  stderr: VscodeProcessTaskOutputStream,
  truncated: boolean,
  identity?: object,
): VscodeProcessTaskOutput {
  const output: {
    identity?: object;
    stderr: VscodeProcessTaskOutputStream;
    stdout: VscodeProcessTaskOutputStream;
    truncated: boolean;
  } = { stdout, stderr, truncated };
  if (identity) {
    Object.defineProperty(output, "identity", {
      configurable: false,
      enumerable: false,
      value: identity,
      writable: false,
    });
  }
  return Object.freeze(output);
}

export function createVscodeProcessTaskOutput(): VscodeProcessTaskOutput {
  const emptyStream = Object.freeze({
    chunkCount: 0,
    codeUnits: 0,
    tail: null,
  });
  return outputProjection(emptyStream, emptyStream, false, Object.freeze({}));
}

export function vscodeProcessTaskOutputStreamTail(
  stream: VscodeProcessTaskOutputStream,
  maxCodeUnits = MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES,
): VscodeProcessTaskOutputTail {
  if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 0) {
    return Object.freeze({ omitted: stream.codeUnits > 0, text: "" });
  }
  if (maxCodeUnits === 0 || stream.tail === null) {
    return Object.freeze({ omitted: stream.codeUnits > 0, text: "" });
  }

  const chunks: string[] = [];
  let remaining = maxCodeUnits;
  let cursor: VscodeProcessTaskOutputChunk | null = stream.tail;
  while (cursor && remaining > 0) {
    if (cursor.text.length <= remaining) {
      chunks.push(cursor.text);
      remaining -= cursor.text.length;
    } else {
      let start = cursor.text.length - remaining;
      if (
        start > 0 &&
        isLowSurrogate(cursor.text.charCodeAt(start)) &&
        isHighSurrogate(cursor.text.charCodeAt(start - 1))
      ) {
        start += 1;
      }
      chunks.push(cursor.text.slice(start));
      remaining = 0;
    }
    cursor = cursor.previous;
  }
  chunks.reverse();
  const text = chunks.join("");
  return Object.freeze({ omitted: text.length < stream.codeUnits, text });
}

function appendOutputChunk(
  stream: VscodeProcessTaskOutputStream,
  text: string,
): VscodeProcessTaskOutputStream {
  if (text.length === 0) return stream;
  const tail = Object.freeze({ previous: stream.tail, text });
  return Object.freeze({
    chunkCount: stream.chunkCount + 1,
    codeUnits: stream.codeUnits + text.length,
    tail,
  });
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
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
