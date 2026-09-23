import { createAgentOutputAcknowledgement } from "./agentOutputAcknowledgement";
import type { CodexTransport } from "../domain/agentProviderSettings";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentAccountUsageObservation } from "../domain/agentAccountUsage";
import {
  isTerminalAgentTaskStatus,
  type AgentCliKind,
  type AgentTaskGateway,
  type AgentTaskOutputEvent,
  type AgentTaskStatusEvent,
} from "../domain/agentTask";
import { agentThreadAutoTitle } from "../domain/agentThreadAutoTitle";
import {
  agentTaskStatusActionAccepted,
  runningTurn,
  type AgentThread,
} from "../domain/agentThread";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  failure,
  isCurrentTaskLaunchAuthority,
  isCurrentThreadLaunchAuthority,
  warning,
  type AgentProjectAuthority,
  type AgentTaskLaunchAuthority,
} from "./agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentSteerOutcome,
  AgentSteerRequest,
  AgentTasksNotice,
  AgentThreadStartRequest,
  AgentThreadStartResult,
} from "./agentThreadPorts";
import type { AgentResumePlan } from "../domain/agentSessionIdentity";
import type { DeferredFollowUps } from "./agentDeferredFollowUps";
import type { AgentQueuedEditCommit, AgentQueuedEditSession } from "./agentQueuedFollowUpEdit";
import { useAgentTurnSteer } from "./useAgentTurnSteer";
import { compensateCreatedWorktree, createThreadWorktree } from "./agentThreadWorktreeProvisioning";
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
import {
  acceptAgentTurnOutput,
  agentSessionLost,
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
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  prepareTurnAttachments,
  retryAttachmentThreadId,
  type AttachmentThreadReservation,
  type ClaimedTurnAttachments,
  type AgentTurnAttachmentAuthority,
} from "./agentTurnAttachments";
import type { InPlacePreflight } from "./useAgentIsolationPreview";
import {
  createAgentTurnStartIntents,
  runAgentTurnStart,
  type AgentTurnStartContext,
} from "./agentTurnStartRunner";
import {
  agentDispatchClaimNotice,
  agentDraftDispatchKey,
  agentThreadDispatchKey,
  useAgentDispatchKeys,
} from "./agentDispatchKeys";
import {
  createAgentSessionContinuity,
  type AgentSessionContinuity,
} from "./agentSessionContinuity";
import {
  AGENT_RESUME_REJECTED_NOTICE,
  AGENT_SESSION_LOST_NOTICE,
  agentFreshSessionNotice,
  rememberAttachmentReservation,
} from "./agentTurnDispatchPolicy";

export {
  agentPromptByteLength,
  countRunningTurns,
  countRunningTurnsInRepository,
} from "./agentTurnAdmission";

export interface AgentTurnDispatchDependencies extends AgentTurnAdmissionDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly hasPendingThreadInput?: (threadId: string) => Promise<boolean>;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
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
  readonly dispatchingKeys: ReadonlySet<string>;
  pendingTurnCount(provider: AgentCliKind): number;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(request: AgentFollowUpRequest): Promise<boolean>;
  readonly deferredFollowUps: DeferredFollowUps;
  steer(request: AgentSteerRequest): Promise<AgentSteerOutcome>;
  removeDeferredFollowUp(threadId: string, id: string): void;
  beginDeferredFollowUpEdit(threadId: string, id: string): AgentQueuedEditSession | null;
  cancelDeferredFollowUpEdit(session: AgentQueuedEditSession): void;
  commitDeferredFollowUpEdit(
    session: AgentQueuedEditSession,
    commit: AgentQueuedEditCommit,
  ): Promise<boolean>;
  sendDeferredFollowUpNow(threadId: string, id: string): Promise<void>;
  resumeDeferredFollowUps(threadId: string): Promise<void>;
  clearDeferredForOwner(ownerId: string): void;
  stop(threadId: string): Promise<void>;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
}

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
  const streamsRef = useRef<Map<string, AgentTurnOutputStream>>(new Map());
  const mintedIdsRef = useRef(new Set<string>());
  const sessionContinuityRef = useRef<AgentSessionContinuity>(createAgentSessionContinuity());
  const startContextRef = useRef<AgentTurnStartContext>({
    dependenciesRef,
    mountedRef,
    streams: streamsRef.current,
    startIntents: createAgentTurnStartIntents(),
  });
  const frameRef = useRef<(() => void) | null>(null);
  const outputSubscriptionRef = useRef({ epoch: 0, ready: false });
  const sessionWarnedThreadsRef = useRef<Set<string>>(new Set());
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
      deps.store.dispatchAction(action);
      noteSessionReport(
        deps,
        sessionContinuityRef.current,
        stream,
        action.sessionId,
        sessionWarnedThreadsRef.current,
      );
    }
  }, []);

  const scheduleFlush = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = scheduleAgentOutputFrame(flushStreams);
  }, [flushStreams]);

  const {
    deferredFollowUps,
    steer,
    removeDeferredFollowUp,
    beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow,
    resumeDeferredFollowUps,
    onTurnSettled,
    onThreadStopped,
    clearDeferredForOwner,
  } = useAgentTurnSteer({
    state: dependencies.store.state,
    dependenciesRef,
    mountedRef,
    sendFollowUpRef,
    flushStreams,
  });

  const outputAcksRef = useRef(
    new WeakMap<AgentTurnOutputStream, ReturnType<typeof createAgentOutputAcknowledgement>>(),
  );

  const handleOutputEvent = useCallback(
    (event: AgentTaskOutputEvent): void => {
      const stream = streamsRef.current.get(event.taskId);
      if (stream === undefined) return;
      if (!acceptAgentTurnOutput(parser(), stream, event)) return;
      const gateway = dependenciesRef.current.agentTaskGateway;
      if (gateway.acknowledgeAgentTaskOutput !== undefined) {
        let ack = outputAcksRef.current.get(stream);
        if (ack === undefined) {
          const taskId = event.taskId;
          const outputEpoch = outputSubscriptionRef.current.epoch;
          const acknowledge = gateway.acknowledgeAgentTaskOutput.bind(gateway);
          const isCurrent = (): boolean =>
            mountedRef.current &&
            outputSubscriptionRef.current.epoch === outputEpoch &&
            streamsRef.current.get(taskId) === stream &&
            dependenciesRef.current.agentTaskGateway === gateway;
          ack = createAgentOutputAcknowledgement({
            taskId,
            workspaceId: stream.ownerId,
            isCurrent,
            acknowledge,
            onFailure: (error) => {
              dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
              if (isCurrent())
                dependenciesRef.current.setNotice(
                  warning("Live output delivery was interrupted. Stop this turn and retry."),
                );
            },
          });
          outputAcksRef.current.set(stream, ack);
        }
        ack.consumed(event.sequence);
      }
      const deps = dependenciesRef.current;
      for (const observation of drainAgentAccountUsage(stream)) {
        deps.onAccountUsageObserved?.(observation);
      }
      // The runtime owns stdin lifetime, including live background work after a result.
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
          deps.store.dispatchAction(finished);
          noteSessionReport(
            deps,
            sessionContinuityRef.current,
            stream,
            finished.sessionId,
            sessionWarnedThreadsRef.current,
          );
        }
        streamsRef.current.delete(event.taskId);
        noteResumeFailure(deps, sessionContinuityRef.current, stream, event);
      }
      deps.store.dispatchAction(action);
      if (!terminal) return;
      deps.onTurnTerminal?.(event);
      onTurnSettled(stream.threadId);
    },
    [flushStreams, onTurnSettled, parser],
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
        outputAcksRef.current = new WeakMap();
        markOutputStreamsIncomplete(streams);
      }
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      frameRef.current?.();
      frameRef.current = null;
    };
  }, [agentTaskGateway, handleOutputEvent, handleStatusEvent]);

  const registerStream = useCallback(
    (
      thread: AgentThread,
      turnId: string,
      resumeSessionId: string | null,
      codexTransport?: CodexTransport,
    ): void => {
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
          codexTransport,
          resumed: resumeSessionId !== null,
          resumedSessionId: resumeSessionId,
          outputSubscriptionEpoch: outputSubscription.ready ? outputSubscription.epoch : null,
        }),
      );
    },
    [parser],
  );

  const runTurnStart = useCallback(
    (start: Parameters<typeof runAgentTurnStart>[1]): Promise<boolean> =>
      runAgentTurnStart(startContextRef.current, start),
    [],
  );

  const startThread = useCallback(
    async (request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null> => {
      const deps = dependenciesRef.current;
      const admitted = admitStart(deps, request);
      if (admitted === null) return null;
      const { authority, project, prompt, agentCliKind, providerAuthority, launch } = admitted;
      const repositoryRoot = request.repositoryRoot;
      const dispatchKey = agentDraftDispatchKey(request.projectRootKey);
      const usedIds = new Set([
        ...deps.store.state.threads.keys(),
        ...usedTurnIds(deps.store.state),
        ...mintedIdsRef.current,
      ]);
      const threadId =
        retryAttachmentThreadId(
          attachmentThreadsRef.current.get(dispatchKey) ?? null,
          authority,
          usedIds,
        ) ?? mintUnusedId(deps, usedIds);
      const turnId = threadId === null ? null : mintUnusedId(deps, usedIds.add(threadId));
      if (threadId === null || turnId === null) {
        deps.setNotice(warning("A thread id could not be minted. Try again."));
        return null;
      }
      const claim = claimDispatch(dispatchKey);
      if (claim !== "claimed") {
        deps.setNotice(warning(agentDispatchClaimNotice(claim)));
        return null;
      }
      mintedIdsRef.current.add(threadId).add(turnId);
      beginPendingTurn(agentCliKind);
      let releaseSlot: (() => void) | undefined;
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
        const admission = await deps.store.reserveThreadSlot?.(threadId, {
          rootKey: authority.rootKey,
          ownerId: authority.workspaceId,
          repositoryRoot,
        });
        if (admission === null) {
          if (
            isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)
          ) {
            dependenciesRef.current.setNotice(
              warning(
                "A conversation could not be saved to make room. Retry after saving finishes.",
              ),
            );
          }
          return null;
        }
        releaseSlot = admission;
        if (
          !isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot) ||
          !providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
        )
          return null;
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
        const reservation = { authority, threadId };
        if (request.attachments?.some((attachment) => attachment.kind === "staged")) {
          rememberAttachmentReservation(attachmentThreadsRef.current, dispatchKey, reservation);
        }
        const prepared = await prepareTurnAttachments(
          dependenciesRef.current,
          request,
          turnAttachmentAuthority(authority),
          threadId,
          prompt,
        );
        if (
          prepared === null ||
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
        const now = deps.now ?? Date.now;
        attachmentThreadsRef.current.delete(dispatchKey);
        const started = await runTurnStart({
          authority,
          authorityScope: "project",
          projectRoot: admitted.project.rootPath,
          threadId,
          repositoryRoot,
          cwd: worktreePath ?? repositoryRoot,
          isolation: request.isolation,
          worktreePath,
          prompt: prepared.prompt,
          attachments: prepared.attachments,
          attachmentReferences: prepared.references,
          turnId,
          agentCliKind,
          providerAuthority,
          resumeSessionId: null,
          launch,
          createdWorktree,
          registration: "after-start",
          startedNotice: prepared.notice,
          onDefiniteStartRejection: () => {
            if (
              isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)
            ) {
              rememberAttachmentReservation(attachmentThreadsRef.current, dispatchKey, reservation);
            }
          },
          register: (turn) => {
            const createdAt = now();
            const thread: AgentThread = {
              threadId,
              owner: { rootKey: authority.rootKey, ownerId: authority.workspaceId, repositoryRoot },
              target: { isolation: request.isolation, worktreePath },
              provider: { kind: agentCliKind, sessionId: null },
              title: agentThreadAutoTitle(prompt === "" ? prepared.prompt : prompt),
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
            registerStream(thread, turn.turnId, null, turn.codexTransport);
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
        releaseSlot?.();
        endPendingTurn(agentCliKind);
        mintedIdsRef.current.delete(threadId);
        mintedIdsRef.current.delete(turnId);
        releaseDispatch(dispatchKey);
      }
    },
    [
      beginPendingTurn,
      claimDispatch,
      endPendingTurn,
      registerStream,
      releaseDispatch,
      runTurnStart,
    ],
  );

  const sendFollowUp = useCallback(
    async (
      request: AgentFollowUpRequest,
      isCurrent: () => boolean = () => true,
      claimed?: ClaimedTurnAttachments,
    ): Promise<boolean> => {
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
      if (!isCurrent()) return false;
      const admitted = admitFollowUp(
        deps,
        request,
        inFlightThreadsRef.current,
        sessionContinuityRef.current.resumePlan,
      );
      if (admitted === null) return false;
      const {
        thread,
        previousOwnerId,
        authority,
        projectRoot,
        prompt,
        providerAuthority,
        resumePlan,
        launch,
      } = admitted;
      const resumeSessionId = resumePlan.kind === "resume" ? resumePlan.sessionId : null;
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
      const turnId = mintUnusedId(
        deps,
        new Set([...usedTurnIds(deps.store.state), ...mintedIdsRef.current]),
      );
      if (turnId === null) {
        deps.setNotice(warning("A turn id could not be minted. Try again."));
        return false;
      }
      const dispatchKey = agentThreadDispatchKey(reboundThread.threadId);
      const claim = claimDispatch(dispatchKey);
      if (claim !== "claimed") {
        deps.setNotice(warning(agentDispatchClaimNotice(claim)));
        return false;
      }
      mintedIdsRef.current.add(turnId);
      inFlightThreadsRef.current.add(reboundThread.threadId);
      beginPendingTurn(reboundThread.provider.kind);
      try {
        const flushed = await deps.store.flushThread?.(reboundThread.threadId);
        if (
          flushed === false ||
          !isCurrent() ||
          !isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) ||
          !providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
        )
          return false;
        const prepared =
          claimed ??
          (await prepareTurnAttachments(
            {
              ...dependenciesRef.current,
              setNotice: (notice) => {
                if (
                  isCurrent() &&
                  isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)
                )
                  dependenciesRef.current.setNotice(notice);
              },
            },
            request,
            turnAttachmentAuthority(authority),
            reboundThread.threadId,
            prompt,
          ));
        if (
          prepared === null ||
          !isCurrent() ||
          !isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) ||
          !providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
        ) {
          return false;
        }
        const followedUp = await runTurnStart({
          isCurrent,
          startedNotice: followUpStartedNotice(resumePlan, prepared.notice),
          authority,
          authorityScope: "thread",
          projectRoot,
          threadId: reboundThread.threadId,
          repositoryRoot,
          cwd: reboundThread.target.worktreePath ?? repositoryRoot,
          isolation: reboundThread.target.isolation,
          worktreePath: reboundThread.target.worktreePath,
          prompt: prepared.prompt,
          attachments: prepared.attachments,
          attachmentReferences: prepared.references,
          turnId,
          agentCliKind: reboundThread.provider.kind,
          providerAuthority,
          resumeSessionId,
          launch,
          createdWorktree: null,
          registration: "before-start",
          register: (turn) => {
            registerStream(reboundThread, turn.turnId, resumeSessionId, turn.codexTransport);
            dependenciesRef.current.store.dispatchAction({
              kind: "turnStarted",
              threadId: reboundThread.threadId,
              turn,
            });
          },
        });
        return followedUp;
      } finally {
        endPendingTurn(reboundThread.provider.kind);
        mintedIdsRef.current.delete(turnId);
        inFlightThreadsRef.current.delete(reboundThread.threadId);
        releaseDispatch(dispatchKey);
      }
    },
    [
      beginPendingTurn,
      claimDispatch,
      endPendingTurn,
      registerStream,
      releaseDispatch,
      runTurnStart,
    ],
  );

  useLayoutEffect(() => {
    sendFollowUpRef.current = sendFollowUp;
  }, [sendFollowUp]);

  const stop = useCallback(
    async (threadId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      onThreadStopped(threadId);
      const thread = deps.store.currentState().threads.get(threadId);
      if (thread === undefined) return;
      const turn = runningTurn(thread);
      if (turn === null) return;
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
    sendFollowUp,
    deferredFollowUps,
    steer,
    removeDeferredFollowUp,
    beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow,
    resumeDeferredFollowUps,
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

function turnAttachmentAuthority(
  authority: AgentTaskLaunchAuthority,
): AgentTurnAttachmentAuthority {
  return {
    rootKey: authority.rootKey,
    ownerId: authority.ownerId,
    generation: authority.generation,
    workspaceId: authority.workspaceId,
  };
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

function noteSessionReport(
  deps: AgentTurnDispatchDependencies,
  continuity: AgentSessionContinuity,
  stream: AgentTurnOutputStream,
  sessionId: string | null,
  warned: Set<string>,
): void {
  if (sessionId === null) return;
  const state = deps.store.currentState();
  const thread = ownedStreamThread(state.threads.get(stream.threadId), stream);
  if (thread === null) return;
  const change = continuity.noteReport(thread, {
    provider: thread.provider.kind,
    resumedSessionId: stream.resumedSessionId,
    reportedSessionId: sessionId,
  });
  if (change.kind !== "keep") return;
  const notice = sessionChangeNotice(state, stream.threadId, sessionId);
  if (notice === null || warned.has(stream.threadId)) return;
  warned.add(stream.threadId);
  deps.setNotice(notice);
}

function noteResumeFailure(
  deps: AgentTurnDispatchDependencies,
  continuity: AgentSessionContinuity,
  stream: AgentTurnOutputStream,
  event: AgentTaskStatusEvent,
): void {
  if (agentSessionLost(stream, event) && stream.resumedSessionId !== null) {
    const thread = ownedStreamThread(
      deps.store.currentState().threads.get(stream.threadId),
      stream,
    );
    if (thread === null) return;
    continuity.noteLoss(thread, stream.resumedSessionId);
    deps.store.dispatchAction({
      kind: "providerSessionInvalidated",
      threadId: thread.threadId,
      owner: thread.owner,
      sessionId: stream.resumedSessionId,
    });
    deps.setNotice(warning(AGENT_SESSION_LOST_NOTICE));
    return;
  }
  if (resumeRejected(stream, event)) deps.setNotice(warning(AGENT_RESUME_REJECTED_NOTICE));
}

function followUpStartedNotice(
  resumePlan: AgentResumePlan,
  attachmentNotice: AgentTasksNotice | null,
): AgentTasksNotice | null {
  if (resumePlan.kind !== "fresh") return attachmentNotice;
  const fresh = agentFreshSessionNotice(resumePlan.reason);
  if (attachmentNotice === null) return warning(fresh);
  return warning(`${fresh} ${attachmentNotice.message}`);
}

function ownedStreamThread(
  thread: AgentThread | undefined,
  stream: AgentTurnOutputStream,
): AgentThread | null {
  if (thread === undefined || thread.owner.ownerId !== stream.ownerId) return null;
  if (thread.owner.repositoryRoot !== stream.repositoryRoot) return null;
  return thread.turns.some((turn) => turn.turnId === stream.turnId) ? thread : null;
}
