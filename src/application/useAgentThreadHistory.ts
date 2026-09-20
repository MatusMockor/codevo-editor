import type { AgentHistoryActivitySource } from "./useAgentHistoryActivity";
import type { AgentTurnLogIntegration } from "./useAgentTurnLogging";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread, AgentThreadsState, AgentTurn } from "../domain/agentThread";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";

export interface AgentThreadHistoryPageView {
  readonly threadId: string;
  readonly turns: ReadonlyArray<AgentTurn>;
  readonly hasEarlier: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}
export interface AgentThreadHistorySurface {
  readonly page: AgentThreadHistoryPageView | null;
  activitySource?(threadId: string, turnId: string): AgentHistoryActivitySource | null;
  older(threadId: string): Promise<void>;
  newer?(threadId: string): Promise<void>;
  latest(): void;
}
interface Dependencies {
  readonly turnLog?: Pick<AgentTurnLogIntegration, "readPage">;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly gateway: AgentThreadStoreGateway;
  currentState(): AgentThreadsState;
  reportError(source: string, error: unknown): void;
}
interface OwnedPage {
  readonly cursors: ReadonlyArray<string | null>;
  readonly identity: string;
  readonly view: AgentThreadHistoryPageView;
}

/** Historical display pages never replace the latest execution state. */
export function useAgentThreadHistory(dependencies: Dependencies): AgentThreadHistorySurface {
  const deps = useRef(dependencies);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const current = useRef<OwnedPage | null>(null);
  const [state, setState] = useState<OwnedPage | null>(null);
  useLayoutEffect(() => {
    deps.current = dependencies;
    const page = current.current;
    if (page !== null && identityFor(dependencies, page.view.threadId) !== page.identity) {
      epoch.current += 1;
      current.current = null;
      setState(null);
    }
  }, [dependencies]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);
  const latest = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setState(null);
  }, []);
  const navigate = useCallback(
    async (threadId: string, direction: "older" | "newer"): Promise<void> => {
      const dependencies = deps.current;
      const thread = dependencies.currentState().threads.get(threadId);
      const identity = identityFor(dependencies, threadId);
      const read = dependencies.gateway.readAgentHistoryTurns;
      if (!mounted.current || !thread || identity === null || !read) return;
      const ownedPrevious = current.current?.identity === identity ? current.current : null;
      const previous = ownedPrevious?.view ?? null;
      if (previous?.loading || (direction === "older" && previous?.hasEarlier === false)) return;
      const previousCursors = ownedPrevious?.cursors ?? [];
      if (direction === "newer" && previousCursors.length < 2) {
        latest();
        return;
      }
      const cursor =
        direction === "older"
          ? (previous?.turns[0]?.turnId ?? thread.turns[0]?.turnId ?? null)
          : previousCursors[previousCursors.length - 2];
      const nextCursors =
        direction === "older"
          ? [...previousCursors, cursor].slice(-64)
          : previousCursors.slice(0, -1);
      const ticket = ++epoch.current;
      const publish = (view: AgentThreadHistoryPageView, cursors = previousCursors) => {
        const owned = { identity, view, cursors };
        current.current = owned;
        setState(owned);
      };
      const initial = {
        threadId,
        turns: previous?.turns ?? [],
        hasEarlier: true,
        loading: true,
        error: null,
      };
      publish(initial);
      const owns = () =>
        mounted.current &&
        epoch.current === ticket &&
        identityFor(deps.current, threadId) === identity;
      try {
        const page = await read.call(dependencies.gateway, {
          rootKey: thread.owner.rootKey,
          ownerId: agentRootOwnerId(thread.owner.rootKey),
          threadId,
          beforeTurnId: cursor,
        });
        if (!owns()) return;
        if (page.turns.some((turn) => turn.turnId === cursor))
          throw new TypeError("History page did not advance.");
        publish(
          {
            threadId,
            turns: page.turns,
            hasEarlier: page.hasEarlier,
            loading: false,
            error: null,
          },
          nextCursors,
        );
      } catch (error) {
        if (!owns()) return;
        deps.current.reportError("Conversation history", error);
        publish({ ...initial, loading: false, error: "Could not load earlier turns. Try again." });
      }
    },
    [latest],
  );
  const older = useCallback((threadId: string) => navigate(threadId, "older"), [navigate]);
  const newer = useCallback((threadId: string) => navigate(threadId, "newer"), [navigate]);
  const page =
    state !== null && identityFor(dependencies, state.view.threadId) === state.identity
      ? state.view
      : null;
  const activitySource = (threadId: string, turnId: string): AgentHistoryActivitySource | null => {
    const thread = dependencies.currentState().threads.get(threadId);
    if (!thread || !dependencies.turnLog) return null;
    const project = dependencies.projects.find(
      (candidate) =>
        candidate.rootKey === thread.owner.rootKey && candidate.ownerId === thread.owner.ownerId,
    );
    if (
      !project ||
      (!thread.turns.some((turn) => turn.turnId === turnId) &&
        !page?.turns.some((turn) => turn.turnId === turnId))
    )
      return null;
    return {
      scope: {
        rootKey: thread.owner.rootKey,
        ownerId: agentRootOwnerId(thread.owner.rootKey),
        threadId,
        turnId,
      },
      generation: project.generation,
      leaseToken: project.leaseToken,
      readPage: dependencies.turnLog.readPage,
    };
  };
  return { page, older, newer, latest, activitySource };
}
function identityFor(deps: Dependencies, threadId: string): string | null {
  const thread = deps.currentState().threads.get(threadId);
  if (!thread) return null;
  const project = deps.projects.find(
    (candidate) =>
      candidate.rootKey === thread.owner.rootKey && candidate.ownerId === thread.owner.ownerId,
  );
  if (!project) return null;
  return JSON.stringify([
    threadId,
    project.rootKey,
    project.ownerId,
    project.generation,
    project.leaseToken,
  ]);
}
