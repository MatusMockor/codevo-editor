import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentCliKind } from "../domain/agentTask";
import { runningTurn, type AgentThread } from "../domain/agentThread";
import type { AgentTurnHaltTrigger } from "../domain/agentTurnHaltRecord";
import { AGENT_TASKS_SOURCE, attempt, failure } from "./agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentThreadStartRequest,
  AgentThreadStartResult,
} from "./agentThreadPorts";
import { resumePlanSessionId } from "../domain/agentSessionIdentity";
import { FollowUpRestartRefusals } from "./agentSessionRestartConsent";
import { useAgentFollowUpRestart } from "./useAgentFollowUpRestart";
import { useAgentTurnSteer } from "./useAgentTurnSteer";
import { mintUnusedId, usedTurnIds } from "./agentTurnAdmission";
import type { AttachmentThreadReservation, ClaimedTurnAttachments } from "./agentTurnAttachments";
import {
  createAgentTurnStartIntents,
  runAgentTurnStart,
  type AgentTurnStartContext,
} from "./agentTurnStartRunner";
import { useAgentDispatchKeys } from "./agentDispatchKeys";
import {
  createAgentSessionContinuity,
  type AgentSessionContinuity,
} from "./agentSessionContinuity";
import type {
  AgentTurnDispatchContext,
  AgentTurnDispatchDependencies,
  AgentTurnDispatchSurface,
} from "./agentThreads/agentTurnDispatchContract";
import { startAgentThread } from "./agentThreads/agentThreadStartFlow";
import { sendAgentFollowUp } from "./agentThreads/agentFollowUpFlow";
import { createAgentTurnOutputPipeline } from "./agentThreads/agentTurnOutputPipeline";
export type {
  AgentTurnDispatchDependencies,
  AgentTurnDispatchSurface,
} from "./agentThreads/agentTurnDispatchContract";
export {
  agentPromptByteLength,
  countRunningTurns,
  countRunningTurnsInRepository,
} from "./agentTurnAdmission";

export function useAgentTurnDispatch(
  dependencies: AgentTurnDispatchDependencies,
): AgentTurnDispatchSurface {
  const agentTaskGateway = dependencies.agentTaskGateway;
  const dispatchKeys = useAgentDispatchKeys();
  const { claim: claimDispatch, release: releaseDispatch } = dispatchKeys;
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const attachmentThreadsRef = useRef(new Map<string, AttachmentThreadReservation>());
  const inFlightThreadsRef = useRef<Set<string>>(new Set());
  const preparingThreadsRef = useRef<Set<string>>(new Set());
  const mintedIdsRef = useRef(new Set<string>());
  const [restartRefusals] = useState(() => new FollowUpRestartRefusals());
  const sessionContinuityRef = useRef<AgentSessionContinuity>(createAgentSessionContinuity());
  const onTurnSettledRef = useRef<(threadId: string) => void>(() => undefined);
  const [output] = useState(() =>
    createAgentTurnOutputPipeline({
      dependenciesRef,
      mountedRef,
      sessionContinuity: sessionContinuityRef.current,
      onTurnSettled: (threadId) => onTurnSettledRef.current(threadId),
    }),
  );
  const startContextRef = useRef<AgentTurnStartContext>({
    dependenciesRef,
    mountedRef,
    streams: output.streams,
    startIntents: createAgentTurnStartIntents(),
  });
  const pendingTurnCountsRef = useRef<Record<AgentCliKind, number>>({ claudeCode: 0, codex: 0 });
  const sendFollowUpRef = useRef<
    | ((
        request: AgentFollowUpRequest,
        isCurrent?: () => boolean,
        prepared?: ClaimedTurnAttachments,
      ) => Promise<boolean>)
    | null
  >(null);
  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  const resumeSessionIdFor = useCallback(
    (thread: AgentThread): string | null =>
      resumePlanSessionId(sessionContinuityRef.current.resumePlan(thread)),
    [],
  );

  const mintUnreservedTurnId = useCallback((): string | null => {
    const deps = dependenciesRef.current;
    const state = deps.store.currentState();
    return mintUnusedId(
      deps,
      new Set([...state.threads.keys(), ...usedTurnIds(state), ...mintedIdsRef.current]),
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pendingTurnCount = useCallback(
    (provider: AgentCliKind): number => pendingTurnCountsRef.current[provider],
    [],
  );

  const beginPendingTurn = useCallback((provider: AgentCliKind): void => {
    adjustPendingTurnCount(pendingTurnCountsRef.current, provider, 1);
  }, []);

  const endPendingTurn = useCallback((provider: AgentCliKind): void => {
    adjustPendingTurnCount(pendingTurnCountsRef.current, provider, -1);
  }, []);

  const {
    deferredFollowUps,
    steer,
    removeDeferredFollowUp,
    beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow,
    resumeDeferredFollowUps,
    restartDeferredFollowUp,
    onTurnSettled,
    onThreadStopped,
    clearDeferredForOwner,
  } = useAgentTurnSteer({
    state: dependencies.store.state,
    dependenciesRef,
    mountedRef,
    sendFollowUpRef,
    needsRestart: restartRefusals.refused,
    flushStreams: output.flushStreams,
  });
  onTurnSettledRef.current = onTurnSettled;

  useEffect(() => output.subscribe(agentTaskGateway), [agentTaskGateway, output]);

  const runTurnStart = useCallback(
    (start: Parameters<typeof runAgentTurnStart>[1]): Promise<boolean> =>
      runAgentTurnStart(startContextRef.current, start),
    [],
  );

  const dispatchContext = useMemo<AgentTurnDispatchContext>(
    () => ({
      dependenciesRef,
      mountedRef,
      attachmentThreads: attachmentThreadsRef.current,
      inFlightThreads: inFlightThreadsRef.current,
      preparingThreads: preparingThreadsRef.current,
      mintedIds: mintedIdsRef.current,
      sessionContinuity: sessionContinuityRef.current,
      restartRefusals,
      claimDispatch,
      releaseDispatch,
      beginPendingTurn,
      endPendingTurn,
      registerStream: output.registerStream,
      runTurnStart,
    }),
    [
      beginPendingTurn,
      claimDispatch,
      endPendingTurn,
      output,
      releaseDispatch,
      restartRefusals,
      runTurnStart,
    ],
  );

  const startThread = useCallback(
    (request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null> =>
      startAgentThread(dispatchContext, request),
    [dispatchContext],
  );

  const sendFollowUp = useCallback(
    (
      request: AgentFollowUpRequest,
      isCurrent?: () => boolean,
      claimed?: ClaimedTurnAttachments,
    ): Promise<boolean> => sendAgentFollowUp(dispatchContext, request, isCurrent, claimed),
    [dispatchContext],
  );

  useLayoutEffect(() => {
    sendFollowUpRef.current = sendFollowUp;
  }, [sendFollowUp]);

  const followUpRestart = useAgentFollowUpRestart({
    dependenciesRef,
    refusals: restartRefusals,
    sendFollowUp,
    restartDeferredFollowUp,
  });

  const stop = useCallback(
    async (threadId: string, trigger: AgentTurnHaltTrigger): Promise<void> => {
      const deps = dependenciesRef.current;
      onThreadStopped(threadId);
      const thread = deps.store.currentState().threads.get(threadId);
      if (thread === undefined) return;
      const turn = runningTurn(thread);
      if (turn === null) return;
      deps.store.dispatchAction({
        kind: "turnHaltRequested",
        threadId,
        ownerId: thread.owner.ownerId,
        turnId: turn.turnId,
        trigger,
        mode: "hardStop",
        requestedAtEpochMs: (deps.now ?? Date.now)(),
      });
      const stopRecorded = startContextRef.current.startIntents.requestStop(turn.turnId);
      const stopped = await attempt(() =>
        deps.agentTaskGateway.stopAgentTask({
          taskId: turn.turnId,
          workspaceId: thread.owner.ownerId,
        }),
      );
      if (stopped.ok) return;
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
      if (stopRecorded || !mountedRef.current) return;
      dependenciesRef.current.setNotice(failure("The agent could not be stopped."));
    },
    [onThreadStopped],
  );

  const hasLiveTasksForOwner = useCallback((ownerId: string): boolean => {
    for (const thread of dependenciesRef.current.store.state.threads.values()) {
      if (thread.owner.ownerId !== ownerId) continue;
      if (runningTurn(thread) !== null) return true;
    }
    return false;
  }, []);

  const stopProjectTasks = useCallback(
    async (ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void> => {
      clearDeferredForOwner(ownerId);
      const roots = new Set(repositoryRoots);
      for (const thread of dependenciesRef.current.store.state.threads.values()) {
        if (thread.owner.ownerId !== ownerId) continue;
        if (runningTurn(thread) === null) continue;
        roots.add(thread.owner.repositoryRoot);
      }
      let incomplete = false;
      for (const repositoryRoot of roots) {
        const stopped = await attempt(() =>
          dependenciesRef.current.agentTaskGateway.stopAgentTasksForRoot({
            workspaceId: ownerId,
            repositoryRoot,
          }),
        );
        if (stopped.ok) continue;
        incomplete = true;
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
      }
      if (incomplete) throw new Error("Agent project task drain failed.");
    },
    [clearDeferredForOwner],
  );

  return {
    dispatching: dispatchKeys.keys.size > 0,
    dispatchingKeys: dispatchKeys.keys,
    pendingTurnCount,
    startThread,
    sendFollowUp: followUpRestart.sendFollowUp,
    followUpNeedsSessionRestart: restartRefusals.refused,
    resumeSessionIdFor,
    mintUnreservedTurnId,
    deferredFollowUps,
    steer,
    removeDeferredFollowUp,
    beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow,
    resumeDeferredFollowUps,
    restartDeferredFollowUp: followUpRestart.restartDeferredFollowUp,
    clearDeferredForOwner,
    stop,
    hasLiveTasksForOwner,
    stopProjectTasks,
  };
}

function adjustPendingTurnCount(
  counts: Record<AgentCliKind, number>,
  provider: AgentCliKind,
  delta: 1 | -1,
): void {
  switch (provider) {
    case "claudeCode":
      counts.claudeCode = adjustedPendingTurnCount(counts.claudeCode, delta);
      return;
    case "codex":
      counts.codex = adjustedPendingTurnCount(counts.codex, delta);
      return;
    default:
      unsupportedPendingTurnProvider(provider);
  }
}

function adjustedPendingTurnCount(current: number, delta: 1 | -1): number {
  const next = current + delta;
  if (next >= 0) return next;
  throw new Error("Pending provider turn count underflow.");
}

function unsupportedPendingTurnProvider(provider: never): never {
  throw new TypeError(`Unsupported pending turn provider: ${String(provider)}.`);
}
