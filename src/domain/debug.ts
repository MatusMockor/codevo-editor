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
  | "breakpoint"
  | "step"
  | "pause"
  | "entry"
  | "exception";

export type StepKind = "continue" | "stepOver" | "stepInto" | "stepOut";

export type DebuggerState =
  | { kind: "inactive" }
  | { kind: "starting"; sessionId: string }
  | { kind: "running"; sessionId: string }
  | {
      kind: "stopped";
      sessionId: string;
      reason: DebugStopReason;
      frames: StackFrame[];
      topFrame: StackFrame | null;
    }
  | { kind: "terminated"; sessionId: string; exitCode: number | null };

export type DebugLaunchTarget =
  | { kind: "node-script"; scriptPath: string }
  | { kind: "js-test-file"; runner: "vitest" | "jest"; filePath: string };

export type DebugEventPayload =
  | { kind: "started"; sessionId: string }
  | { kind: "stopped"; reason: DebugStopReason; frames: StackFrame[] }
  | { kind: "resumed" }
  | { kind: "output"; stream: "stdout" | "stderr"; text: string }
  | { kind: "terminated"; exitCode: number | null }
  | { kind: "breakpointsVerified"; filePath: string; breakpoints: Breakpoint[] };

export interface DebugEvent {
  rootPath: string;
  sessionId: string;
  seq: number;
  payload: DebugEventPayload;
}

export type DebugRuntimeStatus =
  | { kind: "ok"; sessionId: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export interface DebugGateway {
  start(
    rootPath: string,
    launch: DebugLaunchTarget,
    breakpoints: readonly Breakpoint[],
  ): Promise<DebugRuntimeStatus>;
  stop(sessionId: string): Promise<void>;
  setBreakpoints(
    sessionId: string,
    filePath: string,
    breakpoints: readonly Breakpoint[],
  ): Promise<Breakpoint[]>;
  step(sessionId: string, kind: StepKind): Promise<void>;
  pause(sessionId: string): Promise<void>;
  stackTrace(sessionId: string): Promise<StackFrame[]>;
  scopes(sessionId: string, frameId: number): Promise<DebugScope[]>;
  variables(
    sessionId: string,
    variablesReference: number,
  ): Promise<DebugVariable[]>;
  evaluate(
    sessionId: string,
    frameId: number,
    expression: string,
  ): Promise<DebugVariable | null>;
  subscribe(handler: (event: DebugEvent) => void): () => void;
}

export function debuggerSessionId(state: DebuggerState): string | null {
  if (state.kind === "inactive") {
    return null;
  }

  return state.sessionId;
}
