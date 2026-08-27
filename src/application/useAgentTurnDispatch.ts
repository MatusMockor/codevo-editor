import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
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
  reportPreflight,
  usedTurnIds,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import {
  acceptAgentTurnOutput,
  createAgentTurnOutputStream,
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
  readonly currentCliVersion?: () => string | null;
  readonly probeCliVersion?: (
    agentCliPath: string,
    agentCliKind: AgentCliKind,
  ) => Promise<string | null>;
  readonly onWorktreeDispatchFailed?: () => void;
  readonly onTurnTerminal?: (event: AgentTaskStatusEvent) => void;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly outputParser?: AgentOutputParserPort;
}

export interface AgentTurnDispatchSurface {
  readonly dispatching: boolean;
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

interface TurnStart {
  readonly authority: AgentTaskLaunchAuthority;
  readonly projectRoot: string;
  readonly threadId: string;
  readonly repositoryRoot: string;
  readonly cwd: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly prompt: string;
  readonly turnId: string;
  readonly agentCliPath: string;
  readonly agentCliKind: AgentCliKind;
  readonly resumeSessionId: string | null;
  readonly launch: AgentLaunchOptions;
  readonly createdWorktree: CreatedAgentWorktree | null;
  readonly registration: TurnRegistration;
  readonly register: (turn: AgentTurn) => void;
}

export function useAgentTurnDispatch(
  dependencies: AgentTurnDispatchDependencies,
): AgentTurnDispatchSurface {
  const [dispatching, setDispatching] = useState(false);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const dispatchingRef = useRef(false);
  const inFlightThreadsRef = useRef<Set<string>>(new Set());
  const streamsRef = useRef<Map<string, AgentTurnOutputStream>>(new Map());
  const frameRef = useRef<(() => void) | null>(null);
  const sessionWarnedThreadsRef = useRef<Set<string>>(new Set());

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
        const finished = finishAgentTurnOutput(parser(), stream);
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
    const unsubscribers: Array<() => void> = [];
    const gateway = dependenciesRef.current.agentTaskGateway;
    const report = dependenciesRef.current.reportError;
    const retain = (unsubscribe: () => void): void => {
      if (disposed) {
        unsubscribe();
        return;
      }
      unsubscribers.push(unsubscribe);
    };
    gateway
      .subscribeAgentTaskStatus(handleStatusEvent)
      .then(retain)
      .catch((error: unknown) => report(AGENT_TASKS_SOURCE, error));
    gateway
      .subscribeAgentTaskOutput(handleOutputEvent)
      .then(retain)
      .catch((error: unknown) => report(AGENT_TASKS_SOURCE, error));
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      frameRef.current?.();
      frameRef.current = null;
    };
  }, [handleOutputEvent, handleStatusEvent]);

  const registerStream = useCallback(
    (thread: AgentThread, turnId: string, resumed: boolean): void => {
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
        }),
      );
    },
    [parser],
  );

  const registeredTurnAlive = useCallback((start: TurnStart): boolean => {
    if (start.registration === "after-start") return true;
    const thread = dependenciesRef.current.store.currentState().threads.get(start.threadId);
    if (thread === undefined || thread.archived) return false;
    return thread.turns.some((turn) => turn.turnId === start.turnId);
  }, []);

  const settleRegisteredTurn = useCallback((start: TurnStart, status: AgentTaskStatus): void => {
    streamsRef.current.delete(start.turnId);
    if (start.registration === "after-start") return;
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
      const { authority, repositoryRoot } = start;
      const trustRejected = isAgentDispatchTrustRejection(error);
      const definite = trustRejected || isDefiniteAgentTaskStartRejection(error);
      if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        settleRegisteredTurn(start, {
          kind: "failed",
          message: definite ? errorMessageOf(error) : UNCERTAIN_START_MESSAGE,
        });
      }
      if (!definite) retainUncertain();
      if (definite && start.createdWorktree !== null) {
        await compensateCreatedWorktree(
          dependenciesRef,
          mountedRef,
          authority,
          start.createdWorktree,
        );
      }
      if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
        return;
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
        isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot) &&
        registeredTurnAlive(start);
      const cliVersion = deps.currentCliVersion?.() ?? null;
      refreshCliVersion(deps, start);
      const turn = pendingTurn(turnId, start.prompt, now(), start.launch, cliVersion);
      if (start.registration === "before-start") start.register(turn);
      const started = await attempt(() =>
        gateway.startAgentTask({
          taskId: turnId,
          workspaceId,
          projectRoot: start.projectRoot,
          repositoryRoot,
          cwd: start.cwd,
          isolation: start.isolation,
          prompt: start.prompt,
          agentCliPath: start.agentCliPath,
          agentCliKind: start.agentCliKind,
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
        if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
          settleRegisteredTurn(start, { kind: "failed", message: UNEXPECTED_TASK_ID_MESSAGE });
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
        if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
          settleRegisteredTurn(start, { kind: "stopped" });
        }
        return false;
      }
      if (start.registration === "after-start") start.register(turn);
      const acknowledged = await attempt(() =>
        gateway.acknowledgeAgentTaskStart({ taskId: turnId, workspaceId }),
      );
      if (!stillOwned()) {
        await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
        retainUncertain();
        if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
          settleRegisteredTurn(start, { kind: "stopped" });
        }
        return false;
      }
      if (!acknowledged.ok) {
        deps.reportError(AGENT_TASKS_SOURCE, acknowledged.error);
        deps.setNotice(warning("The agent started but its live output could not be attached."));
        return true;
      }
      deps.setNotice(null);
      return true;
    },
    [registeredTurnAlive, reportStartFailure, settleRegisteredTurn],
  );

  const startThread = useCallback(
    async (request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null> => {
      const deps = dependenciesRef.current;
      const admitted = admitStart(deps, request);
      if (admitted === null) return null;
      const { authority, project, prompt, agentCliPath, agentCliKind, launch } = admitted;
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
      setDispatching(true);
      try {
        const leased = await ensureLease(
          deps,
          dependenciesRef,
          mountedRef,
          project,
          authority,
          repositoryRoot,
        );
        if (!leased) return null;
        if (request.isolation === "in-place") {
          const preflight = await deps.preflightInPlace(
            repositoryRoot,
            authority,
            request.unsafeInPlaceConfirmationKey,
          );
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
          if (mountedRef.current) deps.onWorktreeDispatchFailed?.();
          return null;
        }
        if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
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
        if (worktreePath !== null) {
          dependenciesRef.current.onWorktreeCreated?.(repositoryRoot, worktreePath);
        }
        const now = deps.now ?? Date.now;
        const started = await runTurnStart({
          authority,
          projectRoot: admitted.project.rootPath,
          threadId,
          repositoryRoot,
          cwd: worktreePath ?? repositoryRoot,
          isolation: request.isolation,
          worktreePath,
          prompt,
          turnId,
          agentCliPath,
          agentCliKind,
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
            };
            registerStream(thread, turn.turnId, false);
            dependenciesRef.current.store.dispatchAction({ kind: "threadCreated", thread });
          },
        });
        if (!started && request.isolation === "worktree" && mountedRef.current) {
          deps.onWorktreeDispatchFailed?.();
        }
        return started ? { threadId } : null;
      } finally {
        dispatchingRef.current = false;
        if (mountedRef.current) setDispatching(false);
      }
    },
    [registerStream, runTurnStart],
  );

  const sendFollowUp = useCallback(
    async (request: AgentFollowUpRequest): Promise<boolean> => {
      const deps = dependenciesRef.current;
      const admitted = admitFollowUp(deps, request, inFlightThreadsRef.current);
      if (admitted === null) return false;
      const { thread, authority, projectRoot, prompt, agentCliPath, sessionId, launch } = admitted;
      const repositoryRoot = thread.owner.repositoryRoot;
      const turnId = mintUnusedId(deps, new Set(usedTurnIds(deps.store.state)));
      if (turnId === null) {
        deps.setNotice(warning("A turn id could not be minted. Try again."));
        return false;
      }
      inFlightThreadsRef.current.add(thread.threadId);
      setDispatching(true);
      try {
        return await runTurnStart({
          authority,
          projectRoot,
          threadId: thread.threadId,
          repositoryRoot,
          cwd: thread.target.worktreePath ?? repositoryRoot,
          isolation: thread.target.isolation,
          worktreePath: thread.target.worktreePath,
          prompt,
          turnId,
          agentCliPath,
          agentCliKind: thread.provider.kind,
          resumeSessionId: sessionId,
          launch,
          createdWorktree: null,
          registration: "before-start",
          register: (turn) => {
            registerStream(thread, turn.turnId, true);
            dependenciesRef.current.store.dispatchAction({
              kind: "turnStarted",
              threadId: thread.threadId,
              turn,
            });
          },
        });
      } finally {
        inFlightThreadsRef.current.delete(thread.threadId);
        if (mountedRef.current) setDispatching(inFlightThreadsRef.current.size > 0);
      }
    },
    [registerStream, runTurnStart],
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

  return { dispatching, startThread, sendFollowUp, stop, hasLiveTasksForOwner, stopProjectTasks };
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

function refreshCliVersion(deps: AgentTurnDispatchDependencies, start: TurnStart): void {
  const probe = deps.probeCliVersion;
  if (probe === undefined) return;
  void attempt(() => probe(start.agentCliPath, start.agentCliKind));
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
