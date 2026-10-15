import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export const MAX_PENDING_AGENT_TERMINAL_REQUESTS = 32;

export interface AgentTerminalOwner {
  readonly rootPath: string;
}

interface OwnedPanelVisibility {
  readonly owner: AgentTerminalOwner | null;
  readonly visible: boolean;
}

const CLOSED_PANEL: OwnedPanelVisibility = Object.freeze({ owner: null, visible: false });

interface PendingTerminalSessionRequest {
  readonly consume: (sessionId: number | null) => void;
  readonly owner: AgentTerminalOwner;
}

export interface AgentTerminalPanelOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly owner: AgentTerminalOwner | null;
}

export function useAgentTerminalPanel({
  currentWorkspaceRootRef,
  owner,
}: AgentTerminalPanelOptions) {
  const [visibility, setVisibility] = useState<OwnedPanelVisibility>(CLOSED_PANEL);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const bottomPanelVisible = owner !== null && visibility.owner === owner && visibility.visible;
  const setBottomPanelVisible = useCallback((next: SetStateAction<boolean>) => {
    const current = ownerRef.current;
    setVisibility((state) => {
      if (current === null) return state.visible ? CLOSED_PANEL : state;
      const previous = state.owner === current && state.visible;
      const visible = typeof next === "function" ? next(previous) : next;
      return state.owner === current && state.visible === visible
        ? state
        : { owner: current, visible };
    });
  }, []);
  const activeSessionRef = useRef<{
    readonly owner: AgentTerminalOwner;
    readonly sessionId: number;
  } | null>(null);
  const pendingRef = useRef<PendingTerminalSessionRequest[]>([]);

  const showTerminalPanel = useCallback(() => setBottomPanelVisible(true), [setBottomPanelVisible]);
  const hideBottomPanel = useCallback(() => setBottomPanelVisible(false), [setBottomPanelVisible]);
  const toggleBottomPanel = useCallback(
    () => setBottomPanelVisible((visible) => !visible),
    [setBottomPanelVisible],
  );

  const ownerIsCurrent = useCallback(
    (candidate: AgentTerminalOwner) =>
      ownerRef.current === candidate &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, candidate.rootPath),
    [currentWorkspaceRootRef],
  );

  const registerActiveTerminalSession = useCallback(
    (sessionId: number | null) => {
      const registrationOwner = owner;
      if (!registrationOwner || !ownerIsCurrent(registrationOwner)) return;
      const pending = takeOwnerRequests(pendingRef.current, registrationOwner);
      if (sessionId === null) {
        if (activeSessionRef.current?.owner === registrationOwner) activeSessionRef.current = null;
        for (const request of pending) request.consume(null);
        return;
      }
      activeSessionRef.current = { owner: registrationOwner, sessionId };
      for (const request of pending) request.consume(sessionId);
    },
    [owner, ownerIsCurrent],
  );

  const requestActiveTerminalSession = useCallback(
    (consumer: (sessionId: number | null) => void) => {
      const requestedOwner = ownerRef.current;
      if (!requestedOwner || !ownerIsCurrent(requestedOwner)) {
        consumer(null);
        return;
      }
      showTerminalPanel();
      const active = activeSessionRef.current;
      if (active && active.owner === requestedOwner) {
        consumer(active.sessionId);
        return;
      }
      if (pendingRef.current.length >= MAX_PENDING_AGENT_TERMINAL_REQUESTS) {
        consumer(null);
        return;
      }
      pendingRef.current.push({ consume: consumer, owner: requestedOwner });
    },
    [ownerIsCurrent, showTerminalPanel],
  );

  useEffect(() => {
    const effectOwner = owner;
    const pendingRequests = pendingRef.current;
    if (activeSessionRef.current && activeSessionRef.current.owner !== effectOwner) {
      activeSessionRef.current = null;
    }
    return () => {
      if (!effectOwner) return;
      if (activeSessionRef.current?.owner === effectOwner) activeSessionRef.current = null;
      const stale = takeOwnerRequests(pendingRequests, effectOwner);
      if (stale.length === 0) return;
      queueMicrotask(() => {
        for (const request of stale) request.consume(null);
      });
    };
  }, [owner]);

  return {
    bottomPanelVisible,
    hideBottomPanel,
    registerActiveTerminalSession,
    requestActiveTerminalSession,
    setBottomPanelVisible,
    showTerminalPanel,
    toggleBottomPanel,
  };
}

function takeOwnerRequests(
  requests: PendingTerminalSessionRequest[],
  owner: AgentTerminalOwner,
): PendingTerminalSessionRequest[] {
  const taken = requests.filter((request) => request.owner === owner);
  if (taken.length === 0) return taken;
  const kept = requests.filter((request) => request.owner !== owner);
  requests.splice(0, requests.length, ...kept);
  return taken;
}
