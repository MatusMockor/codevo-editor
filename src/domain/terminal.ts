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

export interface TerminalGateway {
  listProfiles(): Promise<TerminalProfile[]>;
  resize(sessionId: number, size: TerminalSize): Promise<void>;
  start(
    rootPath: string,
    size: TerminalSize,
    profileId?: string,
  ): Promise<TerminalRuntimeStatus>;
  stop(sessionId: number): Promise<TerminalRuntimeStatus>;
  stopRoot(rootPath: string): Promise<void>;
  stopAll(): Promise<void>;
  subscribeOutput(
    listener: (event: TerminalOutputEvent) => void,
  ): Promise<TerminalUnsubscribeFn>;
  writeInput(sessionId: number, data: string): Promise<void>;
}

export function terminalSessionId(
  status: TerminalRuntimeStatus,
): number | null {
  if (status.kind === "running") {
    return status.sessionId;
  }

  if (status.kind === "starting") {
    return status.sessionId;
  }

  return null;
}
