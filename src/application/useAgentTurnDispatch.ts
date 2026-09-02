import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentAccountUsageObservation } from "../domain/agentAccountUsage";
import {
  isDefiniteAgentTaskStartRejection,
  isTerminalAgentTaskStatus,
  type AgentCliKind,
  type AgentTaskGateway,
  type AgentTaskIsolation,
  type AgentTaskOutputEvent,
  type AgentTaskStatus,
  type AgentTaskStatusEvent,
} from "../domain/agentTask";
import {
  agentTaskStatusActionAccepted,
  agentThreadTitle,
  runningTurn,
  type AgentThread,
  type AgentTurn,
} from "../domain/agentThread";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  isCurrentTaskLaunchAuthority,
  isCurrentThreadLaunchAuthority,
  warning,
  type AgentProjectAuthority,
  type AgentTaskLaunchAuthority,
} from "./agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentThreadStartRequest,
  AgentThreadStartResult,
} from "./agentThreadPorts";
import {
  compensateCreatedWorktree,
  createThreadWorktree,
  isAgentDispatchTrustRejection,
  noteTrustRejection,
  type CreatedAgentWorktree,
} from "./agentThreadWorktreeProvisioning";
import {
  admitFollowUp,
  admitStart,
  ensureLease,
  mintUnusedId,
  providerAdmissionIsCurrent,
  reportPreflight,
  usedTurnIds,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import type { ReadyAgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";
import {
  acceptAgentTurnOutput,
  createAgentTurnOutputStream,
  drainAgentAccountUsage,
  domainAgentOutputParser,
  drainAgentTurnOutput,
  finishAgentTurnOutput,
  resumeRejected,
  scheduleAgentOutputFrame,
  sessionChangeNotice,
  type AgentOutputParserPort,
  type AgentTurnOutputStream,
} from "./agentTurnOutputStream";
import type { InPlacePreflight } from "./useAgentIsolationPreview";

export {
  agentPromptByteLength,
  countRunningTurns,
  countRunningTurnsInRepository,
} from "./agentTurnAdmission";

export interface AgentTurnDispatchDependencies extends AgentTurnAdmissionDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly preflightInPlace: (
    repositoryRoot: string,
    authority: AgentProjectAuthority,
    unsafeInPlaceConfirmationKey: string | null,
  ) => Promise<InPlacePreflight>;
  readonly retainUncertainWorktree: (worktreePath: string) => void;
  readonly onWorktreeCreated?: (repositoryRoot: string, worktreePath: string) => void;
  readonly currentCliVersion?: (provider: AgentCliKind) => string | null;
  readonly onWorktreeDispatchFailed?: () => void;
  readonly onTurnTerminal?: (event: AgentTaskStatusEvent) => void;
  readonly onAccountUsageObserved?: (observation: AgentAccountUsageObservation) => void;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly outputParser?: AgentOutputParserPort;
}

export interface AgentTurnDispatchSurface {
  readonly dispatching: boolean;
  pendingTurnCount(provider: AgentCliKind): number;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(request: AgentFollowUpRequest): Promise<boolean>;
  stop(threadId: string): Promise<void>;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
}

const RESUME_REJECTED_NOTICE =
  "The agent CLI rejected the resume request. Update the CLI or start a new thread.";
const UNCERTAIN_START_MESSAGE = "The agent start result was uncertain.";
const UNEXPECTED_TASK_ID_MESSAGE = "The agent returned an unexpected task id.";

type TurnRegistration = "before-start" | "after-start";
type TurnAuthorityScope = "project" | "thread";

interface TurnStart {
  readonly authority: AgentTaskLaunchAuthority;
  readonly authorityScope: TurnAuthorityScope;
  readonly projectRoot: string;
  readonly threadId: string;
  readonly repositoryRoot: string;
  readonly cwd: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly prompt: string;
  readonly turnId: string;
  readonly agentCliKind: AgentCliKind;
  readonly providerAuthority: ReadyAgentProviderAdmissionAuthority;
  readonly resumeSessionId: string | null;
  readonly launch: AgentLaunchOptions;
  readonly createdWorktree: CreatedAgentWorktree | null;
  readonly registration: TurnRegistration;
  readonly register: (turn: AgentTurn) => void;
}

export function useAgentTurnDispatch(
  dependencies: AgentTurnDispatchDependencies,
): AgentTurnDispatchSurface {
  const agentTaskGateway = dependencies.agentTaskGateway;
  const [dispatching, setDispatching] = useState(false);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const dispatchingRef = useRef(false);
  const inFlightThreadsRef = useRef<Set<string>>(new Set());
  const preparingThreadsRef = useRef<Set<string>>(new Set());
  const streamsRef = useRef<Map<string, AgentTurnOutputStream>>(new Map());
  const frameRef = useRef<(() => void) | null>(null);
  const outputSubscriptionRef = useRef({ epoch: 0, ready: false });
  const sessionWarnedThreadsRef = useRef<Set<string>>(new Set());
  const pendingTurnCountsRef = useRef<Record<AgentCliKind, number>>({ claudeCode: 0, codex: 0 });

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const parser = useCallback(
    (): AgentOutputParserPort => dependenciesRef.current.outputParser ?? domainAgentOutputParser,
    [],
  );

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

  const flushStreams = useCallback((): void => {
    frameRef.current?.();
    frameRef.current = null;
    if (!mountedRef.current) return;
    const deps = dependenciesRef.current;
    for (const stream of streamsRef.current.values()) {
      const action = drainAgentTurnOutput(stream, stream.lastSequence);
      if (action === null) continue;
      noteSessionChange(deps, stream.threadId, action.sessionId, sessionWarnedThreadsRef.current);
      deps.store.dispatchAction(action);
    }
  }, []);

  const scheduleFlush = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = scheduleAgentOutputFrame(flushStreams);
  }, [flushStreams]);

  const handleOutputEvent = useCallback(
    (event: AgentTaskOutputEvent): void => {
      const stream = streamsRef.current.get(event.taskId);
      if (stream === undefined) return;
      if (!acceptAgentTurnOutput(parser(), stream, event)) return;
      const deps = dependenciesRef.current;
      for (const observation of drainAgentAccountUsage(stream)) {
        deps.onAccountUsageObserved?.(observation);
      }
      scheduleFlush();
    },
    [parser, scheduleFlush],
  );

  const handleStatusEvent = useCallback(
    (event: AgentTaskStatusEvent): void => {
      const deps = dependenciesRef.current;
      const stream = streamsRef.current.get(event.taskId);
      if (stream === undefined) return;
      if (!statusEventMatchesStream(stream, event)) return;
      const now = deps.now ?? Date.now;
      const action = {
        kind: "taskStatusEvent",
        threadId: stream.threadId,
        event,
        nowEpochMs: now(),
      } as const;
      if (!agentTaskStatusActionAccepted(deps.store.currentState(), action)) return;
      const terminal = isTerminalAgentTaskStatus(event.status);
      if (terminal) {
        flushStreams();
        const outputSubscription = outputSubscriptionRef.current;
        const finished = finishAgentTurnOutput(
          parser(),
          stream,
          event.status.kind !== "failed" &&
            outputSubscription.ready &&
            stream.outputSubscriptionEpoch === outputSubscription.epoch,
        );
        for (const observation of drainAgentAccountUsage(stream)) {
          deps.onAccountUsageObserved?.(observation);
        }
        if (finished !== null) {
          noteSessionChange(
            deps,
            stream.threadId,
            finished.sessionId,
            sessionWarnedThreadsRef.current,
          );
          deps.store.dispatchAction(finished);
        }
        streamsRef.current.delete(event.taskId);
        if (resumeRejected(stream, event)) deps.setNotice(warning(RESUME_REJECTED_NOTICE));
      }
      deps.store.dispatchAction(action);
      if (terminal) deps.onTurnTerminal?.(event);
    },
    [flushStreams, parser],
  );

  useEffect(() => {
    let disposed = false;
    const streams = streamsRef.current;
    const unsubscribers: Array<() => void> = [];
    const outputSubscriptionEpoch = outputSubscriptionRef.current.epoch + 1;
    outputSubscriptionRef.current = { epoch: outputSubscriptionEpoch, ready: false };
    markOutputStreamsIncomplete(streams);
    const report = dependenciesRef.current.reportError;
    const retain = (unsubscribe: () => void): void => {
      if (disposed) {
        unsubscribe();
        return;
      }
      unsubscribers.push(unsubscribe);
    };
    agentTaskGateway
      .subscribeAgentTaskStatus(handleStatusEvent)
      .then(retain)
      .catch((error: unknown) => report(AGENT_TASKS_SOURCE, error));
    agentTaskGateway
      .subscribeAgentTaskOutput(handleOutputEvent)
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        if (outputSubscriptionRef.current.epoch !== outputSubscriptionEpoch) {
          unsubscribe();
          return;
        }
        outputSubscriptionRef.current = { epoch: outputSubscriptionEpoch, ready: true };
        unsubscribers.push(unsubscribe);
      })
      .catch((error: unknown) => {
        if (!disposed && outputSubscriptionRef.current.epoch === outputSubscriptionEpoch) {
          outputSubscriptionRef.current = { epoch: outputSubscriptionEpoch, ready: false };
          markOutputStreamsIncomplete(streams);
        }
        report(AGENT_TASKS_SOURCE, error);
      });
    return () => {
      disposed = true;
      if (outputSubscriptionRef.current.epoch === outputSubscriptionEpoch) {
        outputSubscriptionRef.current = { epoch: outputSubscriptionEpoch + 1, ready: false };
        markOutputStreamsIncomplete(streams);
      }
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      frameRef.current?.();
      frameRef.current = null;
    };
  }, [agentTaskGateway, handleOutputEvent, handleStatusEvent]);

  const registerStream = useCallback(
    (thread: AgentThread, turnId: string, resumed: boolean): void => {
      const outputSubscription = outputSubscriptionRef.current;
      streamsRef.current.set(
        turnId,
        createAgentTurnOutputStream(parser(), {
          threadId: thread.threadId,
          turnId,
          ownerId: thread.owner.ownerId,
          repositoryRoot: thread.owner.repositoryRoot,
          isolation: thread.target.isolation,
          worktreePath: thread.target.worktreePath,
          kind: thread.provider.kind,
          resumed,
          outputSubscriptionEpoch: outputSubscription.ready ? outputSubscription.epoch : null,
        }),
      );
    },
    [parser],
  );

  const registeredTurnAlive = useCallback((start: TurnStart): boolean => {
    const thread = dependenciesRef.current.store.currentState().threads.get(start.threadId);
    if (thread === undefined || thread.archived) return false;
    return thread.turns.some((turn) => turn.turnId === start.turnId);
  }, []);

  const settleRegisteredTurn = useCallback((start: TurnStart, status: AgentTaskStatus): void => {
    streamsRef.current.delete(start.turnId);
    const deps = dependenciesRef.current;
    const thread = deps.store.currentState().threads.get(start.threadId);
    const turn = thread?.turns.find((candidate) => candidate.turnId === start.turnId);
    if (turn === undefined) return;
    const now = deps.now ?? Date.now;
    deps.store.dispatchAction({
      kind: "taskStatusEvent",
      threadId: start.threadId,
      event: {
        taskId: start.turnId,
        workspaceId: start.authority.workspaceId,
        repositoryRoot: start.repositoryRoot,
        isolation: start.isolation,
        worktreePath: start.worktreePath,
        sequence: turn.lastStatusSequence + 1,
        status,
      },
      nowEpochMs: now(),
    });
  }, []);

  const reportStartFailure = useCallback(
    async (start: TurnStart, error: unknown, retainUncertain: () => void): Promise<void> => {
      const { authority } = start;
      const trustRejected = isAgentDispatchTrustRejection(error);
      const definite = trustRejected || isDefiniteAgentTaskStartRejection(error);
      settleRegisteredTurn(start, {
        kind: "failed",
        message: definite ? errorMessageOf(error) : UNCERTAIN_START_MESSAGE,
      });
      if (!definite) retainUncertain();
      if (definite && start.createdWorktree !== null) {
        await compensateCreatedWorktree(
          dependenciesRef,
          mountedRef,
          authority,
          start.createdWorktree,
        );
      }
      if (!turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start)) return;
      const currentDeps = dependenciesRef.current;
      if (trustRejected) {
        noteTrustRejection(currentDeps, authority, error);
        return;
      }
      currentDeps.reportError(AGENT_TASKS_SOURCE, error);
      currentDeps.setNotice(failure(startFailureNotice(start, error, definite)));
    },
    [settleRegisteredTurn],
  );

  const runTurnStart = useCallback(
    async (start: TurnStart): Promise<boolean> => {
      const deps = dependenciesRef.current;
      const { authority, repositoryRoot, turnId } = start;
      const workspaceId = authority.workspaceId;
      const gateway = deps.agentTaskGateway;
      const now = deps.now ?? Date.now;
      const retainUncertain = (): void => {
        if (start.createdWorktree === null) return;
        deps.retainUncertainWorktree(start.createdWorktree.receipt.worktreePath);
      };
      const stillOwned = (): boolean =>
        turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start) &&
        (!turnRegistered || registeredTurnAlive(start));
      let turnRegistered = false;
      if (!turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start)) return false;
      const cliVersion = deps.currentCliVersion?.(start.agentCliKind) ?? null;
      const turn = pendingTurn(turnId, start.prompt, now(), start.launch, cliVersion);
      if (start.registration === "before-start") {
        start.register(turn);
        turnRegistered = true;
      }
      if (!stillOwned()) {
        settleRegisteredTurn(start, { kind: "stopped" });
        return false;
      }
      const started = await attempt(() =>
        gateway.startAgentTask({
          taskId: turnId,
          workspaceId,
          projectRoot: start.projectRoot,
          repositoryRoot,
          cwd: start.cwd,
          isolation: start.isolation,
          prompt: start.prompt,
          agentCliKind: start.agentCliKind,
          providerGeneration: start.providerAuthority.providerGeneration,
          resumeSessionId: start.resumeSessionId,
          launch: start.launch,
        }),
      );
      if (!started.ok) {
        await reportStartFailure(start, started.error, retainUncertain);
        return false;
      }
      if (started.value.taskId !== turnId) {
        const stopped = await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
        retainUncertain();
        settleRegisteredTurn(start, { kind: "failed", message: UNEXPECTED_TASK_ID_MESSAGE });
        if (turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start)) {
          const currentDeps = dependenciesRef.current;
          if (!stopped.ok) currentDeps.reportError(AGENT_TASKS_SOURCE, stopped.error);
          currentDeps.setNotice(
            failure(
              stopped.ok
                ? "The agent returned an unexpected task id. Stop was requested, but terminal cleanup is unconfirmed, so the agent or its worktree may remain."
                : "The agent returned an unexpected task id. Cleanup could not be confirmed, so the agent or its worktree may remain.",
            ),
          );
        }
        return false;
      }
      if (!stillOwned()) {
        await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
        retainUncertain();
        settleRegisteredTurn(start, { kind: "stopped" });
        return false;
      }
      if (start.registration === "after-start") {
        start.register(turn);
        turnRegistered = true;
      }
      if (!stillOwned()) {
        await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
        retainUncertain();
        settleRegisteredTurn(start, { kind: "stopped" });
        return false;
      }
      const acknowledged = await attempt(() =>
        gateway.acknowledgeAgentTaskStart({ taskId: turnId, workspaceId }),
      );
      if (!stillOwned()) {
        await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
        retainUncertain();
        settleRegisteredTurn(start, { kind: "stopped" });
        return false;
      }
      if (!acknowledged.ok) {
        const currentDeps = dependenciesRef.current;
        currentDeps.reportError(AGENT_TASKS_SOURCE, acknowledged.error);
        currentDeps.setNotice(
          warning("The agent started but its live output could not be attached."),
        );
        return true;
      }
      dependenciesRef.current.setNotice(null);
      return true;
    },
    [registeredTurnAlive, reportStartFailure, settleRegisteredTurn],
  );

  const startThread = useCallback(
    async (request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null> => {
      const deps = dependenciesRef.current;
      const admitted = admitStart(deps, request);
      if (admitted === null) return null;
      const { authority, project, prompt, agentCliKind, providerAuthority, launch } = admitted;
      const repositoryRoot = request.repositoryRoot;
      if (dispatchingRef.current) {
        deps.setNotice(warning("A dispatch is already in progress."));
        return null;
      }
      const usedIds = new Set([
        ...deps.store.state.threads.keys(),
        ...usedTurnIds(deps.store.state),
      ]);
      const threadId = mintUnusedId(deps, usedIds);
      const turnId = threadId === null ? null : mintUnusedId(deps, usedIds.add(threadId));
      if (threadId === null || turnId === null) {
        deps.setNotice(warning("A thread id could not be minted. Try again."));
        return null;
      }
      dispatchingRef.current = true;
      beginPendingTurn(agentCliKind);
      setDispatching(true);
      try {
        const leased = await ensureLease(
          deps,
          dependenciesRef,
          mountedRef,
          project,
          authority,
          repositoryRoot,
          () => providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority),
        );
        if (!leased) return null;
        if (!providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)) return null;
        if (request.isolation === "in-place") {
          const preflight = await deps.preflightInPlace(
            repositoryRoot,
            authority,
            request.unsafeInPlaceConfirmationKey,
          );
          if (!providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)) return null;
          if (!reportPreflight(deps, preflight)) return null;
        }
        const createdWorktree =
          request.isolation === "worktree"
            ? await createThreadWorktree(
                dependenciesRef,
                mountedRef,
                authority,
                repositoryRoot,
                threadId,
              )
            : null;
        if (request.isolation === "worktree" && createdWorktree === null) {
          if (
            mountedRef.current &&
            providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
          ) {
            deps.onWorktreeDispatchFailed?.();
          }
          return null;
        }
        if (
          !isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot) ||
          !providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
        ) {
          if (createdWorktree !== null) {
            await compensateCreatedWorktree(
              dependenciesRef,
              mountedRef,
              authority,
              createdWorktree,
            );
          }
          return null;
        }
        const worktreePath = createdWorktree?.receipt.worktreePath ?? null;
        if (!providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)) {
          if (createdWorktree !== null) {
            await compensateCreatedWorktree(
              dependenciesRef,
              mountedRef,
              authority,
              createdWorktree,
            );
          }
          return null;
        }
        if (worktreePath !== null) {
          dependenciesRef.current.onWorktreeCreated?.(repositoryRoot, worktreePath);
        }
        if (!providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)) {
          if (createdWorktree !== null) {
            await compensateCreatedWorktree(
              dependenciesRef,
              mountedRef,
              authority,
              createdWorktree,
            );
          }
          return null;
        }
        const now = deps.now ?? Date.now;
        const started = await runTurnStart({
          authority,
          authorityScope: "project",
          projectRoot: admitted.project.rootPath,
          threadId,
          repositoryRoot,
          cwd: worktreePath ?? repositoryRoot,
          isolation: request.isolation,
          worktreePath,
          prompt,
          turnId,
          agentCliKind,
          providerAuthority,
          resumeSessionId: null,
          launch,
          createdWorktree,
          registration: "after-start",
          register: (turn) => {
            const createdAt = now();
            const thread: AgentThread = {
              threadId,
              owner: { rootKey: authority.rootKey, ownerId: authority.workspaceId, repositoryRoot },
              target: { isolation: request.isolation, worktreePath },
              provider: { kind: agentCliKind, sessionId: null },
              title: agentThreadTitle(prompt),
              pinned: false,
              archived: false,
              createdAtEpochMs: createdAt,
              updatedAtEpochMs: createdAt,
              turns: [turn],
              turnsTruncated: false,
              integration: null,
              viewedAtEpochMs: createdAt,
              externalOrigin: null,
            };
            registerStream(thread, turn.turnId, false);
            dependenciesRef.current.store.dispatchAction({ kind: "threadCreated", thread });
          },
        });
        if (
          !started &&
          request.isolation === "worktree" &&
          mountedRef.current &&
          isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot) &&
          providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
        ) {
          deps.onWorktreeDispatchFailed?.();
        }
        return started ? { threadId } : null;
      } finally {
        endPendingTurn(agentCliKind);
        dispatchingRef.current = false;
        if (mountedRef.current) setDispatching(false);
      }
    },
    [beginPendingTurn, endPendingTurn, registerStream, runTurnStart],
  );

  const sendFollowUp = useCallback(
    async (request: AgentFollowUpRequest): Promise<boolean> => {
      let deps = dependenciesRef.current;
      const candidate = deps.store.state.threads.get(request.threadId);
      if (
        candidate !== undefined &&
        !candidate.archived &&
        runningTurn(candidate) === null &&
        deps.launchIdentityForProject(candidate.owner.rootKey) === null &&
        deps.ensureProjectLaunchIdentity !== undefined
      ) {
        if (preparingThreadsRef.current.has(candidate.threadId)) {
          deps.setNotice(warning("This thread is already preparing to continue."));
          return false;
        }
        preparingThreadsRef.current.add(candidate.threadId);
        try {
          await deps.ensureProjectLaunchIdentity(candidate.owner.rootKey);
        } finally {
          preparingThreadsRef.current.delete(candidate.threadId);
        }
        deps = dependenciesRef.current;
      }
      const admitted = admitFollowUp(deps, request, inFlightThreadsRef.current);
      if (admitted === null) return false;
      const {
        thread,
        previousOwnerId,
        authority,
        projectRoot,
        prompt,
        providerAuthority,
        sessionId,
        launch,
      } = admitted;
      const repositoryRoot = thread.owner.repositoryRoot;
      if (previousOwnerId !== thread.owner.ownerId) {
        deps.store.dispatchAction({
          kind: "ownerRebound",
          threadId: thread.threadId,
          previousOwnerId,
          owner: thread.owner,
        });
      }
      const reboundThread = deps.store.currentState().threads.get(thread.threadId);
      if (reboundThread?.owner.ownerId !== thread.owner.ownerId) return false;
      const turnId = mintUnusedId(deps, new Set(usedTurnIds(deps.store.state)));
      if (turnId === null) {
        deps.setNotice(warning("A turn id could not be minted. Try again."));
        return false;
      }
      inFlightThreadsRef.current.add(reboundThread.threadId);
      beginPendingTurn(reboundThread.provider.kind);
      setDispatching(true);
      try {
        return await runTurnStart({
          authority,
          authorityScope: "thread",
          projectRoot,
          threadId: reboundThread.threadId,
          repositoryRoot,
          cwd: reboundThread.target.worktreePath ?? repositoryRoot,
          isolation: reboundThread.target.isolation,
          worktreePath: reboundThread.target.worktreePath,
          prompt,
          turnId,
          agentCliKind: reboundThread.provider.kind,
          providerAuthority,
          resumeSessionId: sessionId,
          launch,
          createdWorktree: null,
          registration: "before-start",
          register: (turn) => {
            registerStream(reboundThread, turn.turnId, true);
            dependenciesRef.current.store.dispatchAction({
              kind: "turnStarted",
              threadId: reboundThread.threadId,
              turn,
            });
          },
        });
      } finally {
        endPendingTurn(reboundThread.provider.kind);
        inFlightThreadsRef.current.delete(reboundThread.threadId);
        if (mountedRef.current) setDispatching(inFlightThreadsRef.current.size > 0);
      }
    },
    [beginPendingTurn, endPendingTurn, registerStream, runTurnStart],
  );

  const stop = useCallback(async (threadId: string): Promise<void> => {
    const deps = dependenciesRef.current;
    const thread = deps.store.state.threads.get(threadId);
    if (thread === undefined) return;
    const turn = runningTurn(thread);
    if (turn === null) return;
    const stopped = await attempt(() =>
      deps.agentTaskGateway.stopAgentTask({
        taskId: turn.turnId,
        workspaceId: thread.owner.ownerId,
      }),
    );
    if (stopped.ok) return;
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
    if (!mountedRef.current) return;
    dependenciesRef.current.setNotice(failure("The agent could not be stopped."));
  }, []);

  const hasLiveTasksForOwner = useCallback((ownerId: string): boolean => {
    for (const thread of dependenciesRef.current.store.state.threads.values()) {
      if (thread.owner.ownerId !== ownerId) continue;
      if (runningTurn(thread) !== null) return true;
    }
    return false;
  }, []);

  const stopProjectTasks = useCallback(
    async (ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void> => {
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
    [],
  );

  return {
    dispatching,
    pendingTurnCount,
    startThread,
    sendFollowUp,
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

function statusEventMatchesStream(
  stream: AgentTurnOutputStream,
  event: AgentTaskStatusEvent,
): boolean {
  if (event.workspaceId !== stream.ownerId) return false;
  if (event.repositoryRoot !== stream.repositoryRoot) return false;
  if (event.isolation !== stream.isolation) return false;
  return event.worktreePath === stream.worktreePath;
}

function markOutputStreamsIncomplete(streams: ReadonlyMap<string, AgentTurnOutputStream>): void {
  for (const stream of streams.values()) stream.rawStreamComplete = false;
}

function turnStartAuthorityIsCurrent(
  dependenciesRef: { readonly current: AgentTurnDispatchDependencies },
  mountedRef: { readonly current: boolean },
  start: TurnStart,
): boolean {
  const current =
    start.authorityScope === "thread"
      ? isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, start.authority)
      : isCurrentTaskLaunchAuthority(
          dependenciesRef,
          mountedRef,
          start.authority,
          start.repositoryRoot,
        );
  if (!current) {
    return false;
  }
  return providerAdmissionIsCurrent(dependenciesRef.current, start.providerAuthority);
}

function noteSessionChange(
  deps: AgentTurnDispatchDependencies,
  threadId: string,
  sessionId: string | null,
  warned: Set<string>,
): void {
  const notice = sessionChangeNotice(deps.store.state, threadId, sessionId);
  if (notice === null || warned.has(threadId)) return;
  warned.add(threadId);
  deps.setNotice(notice);
}

function pendingTurn(
  turnId: string,
  prompt: string,
  startedAtEpochMs: number,
  launch: AgentLaunchOptions,
  cliVersion: string | null,
): AgentTurn {
  return {
    turnId,
    prompt,
    status: { kind: "pending" },
    startedAtEpochMs,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    streamMetrics: null,
    launch,
    cliVersion,
  };
}

function startFailureNotice(start: TurnStart, error: unknown, definite: boolean): string {
  if (definite) {
    const message = errorMessageOf(error);
    return message === "" ? "The agent could not be started." : message;
  }
  if (start.createdWorktree === null) {
    return "The agent start result was uncertain, so a task may still be running.";
  }
  return "The agent start result was uncertain, so a task or its worktree may remain orphaned.";
}
