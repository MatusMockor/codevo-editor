import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import {
  AGENT_SERVER_RECONNECT_FAILED,
  AGENT_SERVER_RECONNECTING_GRACE_MS,
  agentServerBannerPresentation,
  type AgentServerBannerPresentation,
} from "./agentServerReachabilityPresentation";
import { useAgentLatestCallback } from "./useAgentThreadPresentationViews";

export interface AgentServerReachabilityBannerView {
  readonly presentation: AgentServerBannerPresentation;
  readonly busy: boolean;
  readonly failure: string | null;
  readonly onAction: (() => void) | null;
}

type ReconnectAttempt =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting"; readonly scope: string; readonly attempt: number }
  | {
      readonly kind: "failed";
      readonly scope: string;
      readonly attempt: number;
      readonly message: string;
    };

const NO_RECONNECT_ATTEMPT: ReconnectAttempt = { kind: "idle" };

export function useAgentServerReachabilityBanner(
  thread: AgentThreadView | null,
  retryServer: (() => Promise<void>) | undefined,
): AgentServerReachabilityBannerView | null {
  const execution = thread?.execution;
  const threadId = thread?.thread.threadId ?? null;
  const serverId = execution?.serverId ?? null;
  const reachability = execution?.reachability ?? REMOTE_RUNNER_REACHABLE;
  const reconnectingDetail = execution?.reachabilityDetail ?? null;
  const remote = useRemoteRunnerContext();
  const server =
    serverId === null ? undefined : remote?.servers.find((entry) => entry.id === serverId);
  const serverName = server?.name ?? null;
  const graceElapsed = useElapsedGrace(
    reachability.kind === "reconnecting" ? serverId : null,
    AGENT_SERVER_RECONNECTING_GRACE_MS,
  );
  const presentation = useMemo(
    () => agentServerBannerPresentation(reachability, serverName, reconnectingDetail),
    [reachability, serverName, reconnectingDetail],
  );
  const scope = JSON.stringify([
    threadId,
    serverId,
    reachability.kind,
    reachability.kind === "disconnected" ? reachability.reason : null,
  ]);
  const reconnecting = useReconnectAttempt(scope);
  const flight = useScopedFlight(scope);
  const retryAvailable = retryServer !== undefined;
  const retry = useAgentLatestCallback(() => retryServer?.() ?? Promise.resolve());
  const reconnect = useAgentLatestCallback(async () => {
    if (remote === null || server === undefined) return;
    const attempt = reconnecting.begin();
    const { id, name, host, username, port } = server;
    const connected = await remote.connect({ id, name, host, username, port });
    if (!attempt.current()) return;
    if (connected === null) {
      attempt.fail(AGENT_SERVER_RECONNECT_FAILED);
      return;
    }
    attempt.settle();
    await retry();
  });
  const run = flight.run;
  const onRetry = useCallback(() => run(scope, retry), [run, scope, retry]);
  const onReconnect = useCallback(() => run(scope, reconnect), [run, scope, reconnect]);
  const reconnectAvailable = remote !== null && server !== undefined;
  const failure = presentation?.action === "reconnect" ? reconnecting.failure : null;
  const onAction = bannerAction(presentation, {
    retry: retryAvailable ? onRetry : null,
    reconnect: reconnectAvailable ? onReconnect : null,
  });
  const visible = reachability.kind !== "reconnecting" || graceElapsed;
  const busy = flight.busy;
  return useMemo(() => {
    if (presentation === null || !visible) return null;
    return { presentation, busy, failure, onAction };
  }, [presentation, visible, busy, failure, onAction]);
}

function bannerAction(
  presentation: AgentServerBannerPresentation | null,
  actions: { readonly retry: (() => void) | null; readonly reconnect: (() => void) | null },
): (() => void) | null {
  if (presentation === null) return null;
  switch (presentation.action) {
    case "retry":
      return actions.retry;
    case "reconnect":
      return actions.reconnect;
    case "none":
      return null;
    default:
      return unsupportedAction(presentation.action);
  }
}

interface OwnedReconnectAttempt {
  current(): boolean;
  fail(message: string): void;
  settle(): void;
}

function useReconnectAttempt(scope: string): {
  readonly failure: string | null;
  begin(): OwnedReconnectAttempt;
} {
  const [state, setState] = useState<ReconnectAttempt>(NO_RECONNECT_ATTEMPT);
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
      setState(NO_RECONNECT_ATTEMPT);
    },
    [scope],
  );
  const begin = useCallback((): OwnedReconnectAttempt => {
    sequence.current += 1;
    const owned = { scope: latestScope.current, attempt: sequence.current };
    const current = (): boolean =>
      mounted.current && latestScope.current === owned.scope && sequence.current === owned.attempt;
    setState({ kind: "connecting", ...owned });
    return {
      current,
      fail: (message) => {
        if (current()) setState({ kind: "failed", ...owned, message });
      },
      settle: () => {
        if (current()) setState(NO_RECONNECT_ATTEMPT);
      },
    };
  }, []);
  const failure = state.kind === "failed" && state.scope === scope ? state.message : null;
  return { failure, begin };
}

function useElapsedGrace(key: string | null, milliseconds: number): boolean {
  const [elapsedKey, setElapsedKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setElapsedKey(key), milliseconds);
    return () => {
      clearTimeout(timer);
      setElapsedKey(null);
    };
  }, [key, milliseconds]);
  return key !== null && elapsedKey === key;
}

const NO_FLIGHTS: ReadonlyMap<string, number> = new Map();

function useScopedFlight(scope: string): {
  readonly busy: boolean;
  run(owner: string, work: () => Promise<void>): void;
} {
  const flights = useRef(new Map<string, number>());
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [inFlight, setInFlight] = useState(NO_FLIGHTS);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback((owner: string, work: () => Promise<void>) => {
    if (flights.current.has(owner)) return;
    sequence.current += 1;
    const token = sequence.current;
    flights.current.set(owner, token);
    setInFlight(new Map(flights.current));
    const settle = (): void => {
      if (flights.current.get(owner) !== token) return;
      flights.current.delete(owner);
      if (mounted.current) setInFlight(new Map(flights.current));
    };
    void work().then(settle, settle);
  }, []);
  return { busy: inFlight.has(scope), run };
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported server banner action: ${String(action)}.`);
}
