import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  NO_AGENT_SESSION_BACKGROUNDS,
  agentSessionBackgroundKey,
  agentSessionBackgroundOf,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
  expireAgentSessionBackgroundReplies,
  forgetAgentSessionBackground,
  nextAgentSessionReplyExpiry,
  recoverAgentSessionBackgrounds,
  type AgentSessionBackgrounds,
} from "../domain/agentSessionBackground";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
  AgentThreadSessionRequest,
} from "../domain/agentThreadSession";
import {
  useAgentSessionEventSubscription,
  type AgentSessionEventSubscription,
} from "./useAgentSessionEventSubscription";

export const AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS = 5_000;
export const MAX_AGENT_SESSION_EVENTS_DURING_RECOVERY = 256;

const subscribeLevels: AgentSessionEventSubscription<AgentSessionBackgroundTasksEvent> = (
  gateway,
  handler,
) => gateway.subscribeAgentSessionBackgroundTasks(handler);

const subscribeEnded: AgentSessionEventSubscription<AgentSessionEndedEvent> = (gateway, handler) =>
  gateway.subscribeAgentSessionEnded(handler);

export type AgentSessionMissingReport = () => void;

export interface AgentSessionBackgroundsState {
  readonly backgrounds: AgentSessionBackgrounds;
  readonly recovered: boolean;
  readonly watchSession: (session: AgentThreadSessionRequest) => AgentSessionMissingReport;
}

type BackgroundsTransition = (current: AgentSessionBackgrounds) => AgentSessionBackgrounds;
type SupersededSessions = Set<string> | "overflowed" | null;

export function useAgentSessionBackgrounds(
  gateway: AgentThreadSessionGateway | undefined,
  now: () => number,
  reportFailure: (error: unknown) => void,
): AgentSessionBackgroundsState {
  const [backgrounds, setBackgrounds] = useState(NO_AGENT_SESSION_BACKGROUNDS);
  const [recoveredFrom, setRecoveredFrom] = useState<AgentThreadSessionGateway | null>(null);
  const [levelsHeardFrom, setLevelsHeardFrom] = useState<AgentThreadSessionGateway | null>(null);
  const [endsHeardFrom, setEndsHeardFrom] = useState<AgentThreadSessionGateway | null>(null);
  const latest = useRef(NO_AGENT_SESSION_BACKGROUNDS);
  const superseded = useRef<SupersededSessions>(null);
  const nowRef = useRef(now);
  const reportFailureRef = useRef(reportFailure);
  useLayoutEffect(() => {
    nowRef.current = now;
    reportFailureRef.current = reportFailure;
  });
  const transition = useCallback((next: BackgroundsTransition) => {
    latest.current = next(latest.current);
    setBackgrounds(latest.current);
  }, []);
  const supersede = useCallback((session: AgentThreadSessionRequest) => {
    const sessions = superseded.current;
    if (sessions === null || sessions === "overflowed") return;
    if (sessions.size >= MAX_AGENT_SESSION_EVENTS_DURING_RECOVERY) {
      superseded.current = "overflowed";
      return;
    }
    sessions.add(agentSessionBackgroundKey(session));
  }, []);
  useAgentSessionEventSubscription(gateway, subscribeLevels, {
    onEvent: (event) => {
      supersede(event);
      transition((current) => applyAgentSessionBackgroundLevel(current, event, nowRef.current()));
    },
    onFailure: reportFailure,
    onSettled: () => setLevelsHeardFrom(() => gateway ?? null),
  });
  useAgentSessionEventSubscription(gateway, subscribeEnded, {
    onEvent: (event) => {
      supersede(event);
      transition((current) => endAgentSessionBackground(current, event));
    },
    onFailure: reportFailure,
    onSettled: () => setEndsHeardFrom(() => gateway ?? null),
  });
  const recovered = gateway === undefined || recoveredFrom === gateway;
  const listening = levelsHeardFrom === gateway && endsHeardFrom === gateway;
  useEffect(() => {
    if (gateway === undefined) return;
    return () => transition(() => NO_AGENT_SESSION_BACKGROUNDS);
  }, [gateway, transition]);
  useEffect(() => {
    if (gateway === undefined || recovered) return;
    const deadline = setTimeout(
      () => setRecoveredFrom(() => gateway),
      AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS,
    );
    return () => clearTimeout(deadline);
  }, [gateway, recovered]);
  useEffect(() => {
    if (gateway === undefined || !listening) return;
    let disposed = false;
    superseded.current = new Set();
    const recover = (levels: ReadonlyArray<AgentSessionBackgroundTasksEvent>): void => {
      if (disposed) return;
      const sessions = superseded.current;
      superseded.current = null;
      if (sessions instanceof Set) {
        transition((current) =>
          recoverAgentSessionBackgrounds(current, levels, sessions, nowRef.current()),
        );
      }
      setRecoveredFrom(() => gateway);
    };
    const fail = (error: unknown): void => {
      if (disposed) return;
      superseded.current = null;
      reportFailureRef.current(error);
      setRecoveredFrom(() => gateway);
    };
    void Promise.resolve()
      .then(() => gateway.listAgentSessionBackgrounds())
      .then(recover, fail);
    return () => {
      disposed = true;
      superseded.current = null;
    };
  }, [gateway, listening, transition]);
  const replyExpiry = nextAgentSessionReplyExpiry(backgrounds);
  useEffect(() => {
    if (replyExpiry === null) return;
    const timer = setTimeout(
      () =>
        transition((current) =>
          expireAgentSessionBackgroundReplies(current, Math.max(nowRef.current(), replyExpiry)),
        ),
      Math.max(0, replyExpiry - nowRef.current()),
    );
    return () => clearTimeout(timer);
  }, [replyExpiry, transition]);
  const watchSession = useCallback(
    (session: AgentThreadSessionRequest): AgentSessionMissingReport => {
      const observed = agentSessionBackgroundOf(
        latest.current,
        session.workspaceId,
        session.threadId,
      );
      return () =>
        transition((current) => forgetAgentSessionBackground(current, session, observed));
    },
    [transition],
  );
  return useMemo(
    () => ({ backgrounds, recovered, watchSession }),
    [backgrounds, recovered, watchSession],
  );
}
