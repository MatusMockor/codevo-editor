import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RemoteThreadSelection } from "../../../domain/remoteThreadSelection";
import type { RemoteRunnerContextValue } from "../../remoteRunner/remoteRunnerContext";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";

export const REMOTE_THREAD_WAITING_REASON = "Waiting for the server conversation to load.";
export const REMOTE_THREAD_CONNECT_FAILED = "Could not connect. Check the server in Settings.";

export interface AgentRemoteThreadBannerView {
  readonly message: string;
  readonly connecting: boolean;
  readonly failure: string | null;
  readonly onConnect: (() => void) | null;
  readonly onNewThread: () => void;
}

export interface AgentModeRemoteThreadRecoveryOptions {
  readonly selection: RemoteThreadSelection;
  readonly selectedThreadId: string | null;
  readonly remoteContext: RemoteRunnerContextValue | null;
  startNewThread(): void;
}

type ConnectAttempt =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting"; readonly scope: string; readonly sequence: number }
  | { readonly kind: "failed"; readonly scope: string; readonly sequence: number };

const IDLE: ConnectAttempt = { kind: "idle" };

export function remoteThreadComposerBlockedReason(selection: RemoteThreadSelection): string | null {
  switch (selection.kind) {
    case "resolving":
    case "missing":
      return REMOTE_THREAD_WAITING_REASON;
    case "none":
    case "disconnected":
    case "unavailable":
      return null;
    default:
      return unsupportedSelection(selection);
  }
}

export function useAgentModeRemoteThreadRecovery({
  selection,
  selectedThreadId,
  remoteContext,
  startNewThread,
}: AgentModeRemoteThreadRecoveryOptions): AgentRemoteThreadBannerView | null {
  const missingThreadId = selection.kind === "missing" ? selectedThreadId : null;
  useLayoutEffect(() => {
    if (missingThreadId === null) return;
    startNewThread();
  }, [missingThreadId, startNewThread]);
  const scope =
    selection.kind === "disconnected"
      ? JSON.stringify([selectedThreadId, selection.serverId])
      : null;
  const attempt = useScopedConnectAttempt(scope);
  const connect = useAgentLatestCallback(async () => {
    if (selection.kind !== "disconnected" || remoteContext === null) return;
    const server = remoteContext.servers.find((entry) => entry.id === selection.serverId);
    if (server === undefined) return;
    const owned = attempt.begin();
    if (owned === null) return;
    const { id, name, host, username, port } = server;
    const connected = await remoteContext.connect({ id, name, host, username, port });
    owned.settle(connected !== null);
  });
  const onConnect = useCallback(() => void connect(), [connect]);
  const busy = attempt.connecting || remoteContext?.status === "busy";
  const failure = attempt.failed ? (remoteContext?.error ?? REMOTE_THREAD_CONNECT_FAILED) : null;
  return useMemo(() => {
    switch (selection.kind) {
      case "none":
      case "resolving":
      case "missing":
        return null;
      case "disconnected":
        return {
          message: `${selection.serverName} is disconnected. This thread lives on the server.`,
          connecting: busy,
          failure,
          onConnect: remoteContext === null ? null : onConnect,
          onNewThread: startNewThread,
        };
      case "unavailable":
        return {
          message:
            selection.serverName === null
              ? "This thread lives on a server that is not available."
              : `Could not load this thread from ${selection.serverName}.`,
          connecting: false,
          failure: null,
          onConnect: null,
          onNewThread: startNewThread,
        };
      default:
        return unsupportedSelection(selection);
    }
  }, [busy, failure, onConnect, remoteContext, selection, startNewThread]);
}

interface OwnedConnectAttempt {
  settle(connected: boolean): void;
}

function useScopedConnectAttempt(scope: string | null): {
  readonly connecting: boolean;
  readonly failed: boolean;
  begin(): OwnedConnectAttempt | null;
} {
  const [state, setState] = useState<ConnectAttempt>(IDLE);
  const latestScope = useRef(scope);
  const sequence = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    latestScope.current = scope;
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      sequence.current += 1;
      setState(IDLE);
    },
    [scope],
  );
  const begin = useCallback((): OwnedConnectAttempt | null => {
    const ownedScope = latestScope.current;
    if (ownedScope === null) return null;
    sequence.current += 1;
    const owned = { scope: ownedScope, sequence: sequence.current };
    const current = (): boolean =>
      mounted.current && latestScope.current === owned.scope && sequence.current === owned.sequence;
    setState({ kind: "connecting", ...owned });
    return {
      settle: (connected) => {
        if (!current()) return;
        setState(connected ? IDLE : { kind: "failed", ...owned });
      },
    };
  }, []);
  const owned = state.kind !== "idle" && state.scope === scope;
  return {
    connecting: owned && state.kind === "connecting",
    failed: owned && state.kind === "failed",
    begin,
  };
}

function unsupportedSelection(selection: never): never {
  throw new TypeError(`Unsupported remote thread selection: ${JSON.stringify(selection)}.`);
}
