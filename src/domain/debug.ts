export interface Breakpoint {
  id: string;
  filePath: string;
  lineNumber: number;
  condition?: string;
  enabled: boolean;
  verified?: boolean;
}

export interface StackFrame {
  frameId: number;
  name: string;
  filePath: string | null;
  lineNumber: number;
  column: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export type DebugStopReason =
  "breakpoint" | "step" | "pause" | "entry" | "exception";

export type StepKind = "continue" | "stepOver" | "stepInto" | "stepOut";

export type DebuggerState =
  | { kind: "inactive" }
  | { kind: "starting"; sessionId: number }
  | { kind: "running"; sessionId: number }
  | {
      kind: "stopped";
      sessionId: number;
      reason: DebugStopReason;
      frames: StackFrame[];
      topFrame: StackFrame | null;
    }
  | { kind: "terminated"; sessionId: number; exitCode: number | null };

export type DebugLaunchTarget =
  | { kind: "node-script"; scriptPath: string }
  | { kind: "js-test-file"; runner: "vitest" | "jest"; filePath: string }
  | { kind: "php-script"; scriptPath: string }
  | { kind: "php-test-file"; filePath: string }
  | { kind: "php-listen"; port?: number };

export type DebugEventPayload =
  | { kind: "started"; sessionId: number }
  | { kind: "stopped"; reason: DebugStopReason; frames: StackFrame[] }
  | { kind: "resumed" }
  | { kind: "output"; stream: "stdout" | "stderr"; text: string }
  | { kind: "terminated"; exitCode: number | null }
  | {
      kind: "breakpointsVerified";
      filePath: string;
      breakpoints: Breakpoint[];
    };

export interface DebugEvent {
  rootPath: string;
  sessionId: number;
  seq: number;
  payload: DebugEventPayload;
}

export type DebugRuntimeStatus =
  | { kind: "ok"; sessionId: number }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export interface DebugGateway {
  start(
    rootPath: string,
    launch: DebugLaunchTarget,
    breakpoints: readonly Breakpoint[],
  ): Promise<DebugRuntimeStatus>;
  stop(sessionId: number): Promise<void>;
  setBreakpoints(
    sessionId: number,
    filePath: string,
    breakpoints: readonly Breakpoint[],
  ): Promise<Breakpoint[]>;
  step(sessionId: number, kind: StepKind): Promise<void>;
  pause(sessionId: number): Promise<void>;
  stackTrace(sessionId: number): Promise<StackFrame[]>;
  scopes(sessionId: number, frameId: number): Promise<DebugScope[]>;
  variables(
    sessionId: number,
    variablesReference: number,
  ): Promise<DebugVariable[]>;
  evaluate(
    rootPath: string,
    sessionId: number,
    frameId: number,
    expression: string,
  ): Promise<DebugVariable | null>;
  subscribe(handler: (event: DebugEvent) => void): () => void;
}

export function debuggerSessionId(state: DebuggerState): number | null {
  if (state.kind === "inactive") {
    return null;
  }

  return state.sessionId;
}
