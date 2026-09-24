import { useEffect, useState } from "react";
import type { TerminalGateway } from "../domain/terminal";

export interface TerminalTabsSnapshotTab {
  readonly id: string;
  readonly title: string;
  readonly live: boolean;
  readonly closable: boolean;
}

export interface TerminalTabsSnapshot {
  readonly tabs: ReadonlyArray<TerminalTabsSnapshotTab>;
  readonly activeTabId: string | null;
  readonly canCreate: boolean;
  readonly split: boolean;
}

export interface TerminalTabsCommands {
  activate(id: string): void;
  close(id: string): void;
  create(): void;
  toggleSplit(): void;
  stopActive(): void;
  restartActive(): void;
}

export interface TerminalTabsExternalStrip {
  onSnapshot(snapshot: TerminalTabsSnapshot | null): void;
  readonly commandsRef: { current: TerminalTabsCommands | null };
}

export const MAX_TRACKED_EXITED_SESSIONS = 64;

export function boundedSessionSet(
  current: ReadonlySet<number>,
  sessionId: number,
): ReadonlySet<number> {
  if (current.has(sessionId)) return current;
  const next = [...current, sessionId];
  return new Set(next.slice(Math.max(0, next.length - MAX_TRACKED_EXITED_SESSIONS)));
}

export interface TerminalExitedSessions {
  readonly exited: ReadonlySet<number>;
  markExited(sessionId: number): void;
}

export function useTerminalExitedSessions(gateway: TerminalGateway): TerminalExitedSessions {
  const [exited, setExited] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    const subscribe = gateway.subscribeStatus;
    if (subscribe === undefined) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribe
      .call(gateway, (status) => {
        if (status.kind !== "exited" && status.kind !== "crashed" && status.kind !== "stopped")
          return;
        setExited((current) => boundedSessionSet(current, status.sessionId));
      })
      .then(
        (dispose) => {
          if (disposed) {
            dispose();
            return;
          }
          unsubscribe = dispose;
        },
        () => undefined,
      );
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [gateway]);
  return {
    exited,
    markExited: (sessionId) => setExited((current) => boundedSessionSet(current, sessionId)),
  };
}
