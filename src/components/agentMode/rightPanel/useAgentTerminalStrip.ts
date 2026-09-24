import { useCallback, useMemo, useRef, useState } from "react";
import type {
  TerminalTabsCommands,
  TerminalTabsExternalStrip,
  TerminalTabsSnapshot,
} from "../../TerminalTabsPanel";
import type {
  AgentTerminalSessionCommand,
  AgentTerminalStripState,
} from "./agentRightPanelTabEntries";

export interface AgentTerminalStrip {
  readonly state: AgentTerminalStripState | null;
  readonly externalStrip: TerminalTabsExternalStrip;
  command(command: AgentTerminalSessionCommand, closeSurface: () => void): void;
}

export function useAgentTerminalStrip(): AgentTerminalStrip {
  const [snapshot, setSnapshot] = useState<TerminalTabsSnapshot | null>(null);
  const snapshotRef = useRef<TerminalTabsSnapshot | null>(null);
  const commandsRef = useRef<TerminalTabsCommands | null>(null);
  const onSnapshot = useCallback((next: TerminalTabsSnapshot | null) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const externalStrip = useMemo<TerminalTabsExternalStrip>(
    () => ({ onSnapshot, commandsRef }),
    [onSnapshot],
  );
  const command = useCallback((request: AgentTerminalSessionCommand, closeSurface: () => void) => {
    const commands = commandsRef.current;
    if (commands === null) return;
    switch (request.kind) {
      case "activate":
        commands.activate(request.sessionId);
        return;
      case "create":
        commands.create();
        return;
      case "close":
        if ((snapshotRef.current?.tabs.length ?? 0) <= 1) {
          closeSurface();
          return;
        }
        commands.close(request.sessionId);
        return;
    }
  }, []);
  const state = useMemo<AgentTerminalStripState | null>(
    () =>
      snapshot === null ? null : { sessions: snapshot.tabs, activeSessionId: snapshot.activeTabId },
    [snapshot],
  );
  return { state, externalStrip, command };
}
