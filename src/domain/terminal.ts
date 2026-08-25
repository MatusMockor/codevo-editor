import { AGENT_TASK_ID_PATTERN } from "./agentTask";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type TerminalRuntimeStatus =
  | { kind: "starting"; sessionId: number }
  | {
      cols: number;
      cwd: string;
      kind: "running";
      rows: number;
      sessionId: number;
    }
  | { kind: "stopped"; sessionId: number }
  | { exitCode: number | null; kind: "exited"; sessionId: number }
  | { kind: "crashed"; message: string; sessionId: number };

export interface TerminalOutputEvent {
  data: string;
  sessionId: number;
}

export interface TerminalProfile {
  command: string | null;
  id: string;
  label: string;
}

export type TerminalUnsubscribeFn = () => void;

export type TerminalLaunchTarget =
  | { readonly kind: "workspaceRoot" }
  | { readonly kind: "agentWorktree"; readonly threadId: string };

export const TERMINAL_LAUNCH_TARGET_KINDS = ["workspaceRoot", "agentWorktree"] as const;

export const DEFAULT_TERMINAL_LAUNCH_TARGET: TerminalLaunchTarget = { kind: "workspaceRoot" };

export function terminalLaunchTargetForThread(threadId: string): TerminalLaunchTarget {
  return { kind: "agentWorktree", threadId };
}

export function serializeTerminalLaunchTarget(
  target: TerminalLaunchTarget,
): Record<string, unknown> {
  if (target === null || typeof target !== "object") {
    invalidTerminalLaunchTarget("target", "an object");
  }
  if (target.kind === "workspaceRoot") {
    exactTerminalTargetKeys(target, ["kind"]);
    return { kind: target.kind };
  }
  if (target.kind === "agentWorktree") {
    exactTerminalTargetKeys(target, ["kind", "threadId"]);
    return { kind: target.kind, threadId: terminalTargetThreadId(target.threadId) };
  }
  return invalidTerminalLaunchTarget(
    "target.kind",
    `one of ${TERMINAL_LAUNCH_TARGET_KINDS.join(", ")}`,
  );
}

function terminalTargetThreadId(value: unknown): string {
  if (typeof value !== "string" || !AGENT_TASK_ID_PATTERN.test(value)) {
    invalidTerminalLaunchTarget("target.threadId", "a safe agent thread id");
  }
  return value;
}

function exactTerminalTargetKeys(
  target: TerminalLaunchTarget,
  expected: ReadonlyArray<string>,
): void {
  const actual = Object.keys(target);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalidTerminalLaunchTarget("target", `exactly the fields ${expected.join(", ")}`);
  }
}

function invalidTerminalLaunchTarget(path: string, expectation: string): never {
  throw new TypeError(`Invalid terminal launch target at ${path}: expected ${expectation}.`);
}

export interface TerminalGateway {
  acknowledgeStart(sessionId: number): Promise<void>;
  listProfiles(): Promise<TerminalProfile[]>;
  resize(sessionId: number, size: TerminalSize): Promise<void>;
  start(
    rootPath: string,
    size: TerminalSize,
    profileId?: string,
    shellIntegrationEnabled?: boolean,
    target?: TerminalLaunchTarget,
  ): Promise<TerminalRuntimeStatus>;
  stop(sessionId: number): Promise<TerminalRuntimeStatus>;
  stopRoot(rootPath: string): Promise<void>;
  stopAll(): Promise<void>;
  subscribeOutput(listener: (event: TerminalOutputEvent) => void): Promise<TerminalUnsubscribeFn>;
  subscribeStatus?(
    listener: (status: TerminalRuntimeStatus) => void,
  ): Promise<TerminalUnsubscribeFn>;
  writeInput(sessionId: number, data: string): Promise<void>;
}

export function isTerminalRuntimeTerminal(status: TerminalRuntimeStatus): boolean {
  return status.kind === "stopped" || status.kind === "exited" || status.kind === "crashed";
}

export function terminalSessionId(status: TerminalRuntimeStatus): number | null {
  if (status.kind === "running") {
    return status.sessionId;
  }

  if (status.kind === "starting") {
    return status.sessionId;
  }

  return null;
}
