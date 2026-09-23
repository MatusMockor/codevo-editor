import type { CodexTransport } from "../domain/agentProviderSettings";
import type { AgentAttachment } from "../domain/agentAttachment";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import {
  isDefiniteAgentTaskStartRejection,
  type AgentCliKind,
  type AgentTaskIsolation,
  type AgentTaskStatus,
  type StartAgentTaskAttachment,
} from "../domain/agentTask";
import type { AgentTurn } from "../domain/agentThread";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  isCurrentTaskLaunchAuthority,
  isCurrentThreadLaunchAuthority,
  warning,
  type AgentTaskLaunchAuthority,
} from "./agentProjectAuthority";
import {
  compensateCreatedWorktree,
  isAgentDispatchTrustRejection,
  noteTrustRejection,
  type CreatedAgentWorktree,
} from "./agentThreadWorktreeProvisioning";
import { providerAdmissionIsCurrent } from "./agentTurnAdmission";
import type { ReadyAgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";
import type { AgentTurnOutputStream } from "./agentTurnOutputStream";
import type { AgentTurnDispatchDependencies } from "./useAgentTurnDispatch";
import type { AgentTasksNotice } from "./agentThreadPorts";

const UNCERTAIN_START_MESSAGE = "The agent start result was uncertain.";
export const AGENT_TASK_STOPPED_BEFORE_START_MESSAGE = "The agent was stopped before it started.";
const UNEXPECTED_TASK_ID_MESSAGE = "The agent returned an unexpected task id.";
const OUTPUT_NOT_ATTACHED_MESSAGE = "The agent started but its live output could not be attached.";

export type AgentTurnRegistration = "before-start" | "after-start";
export type AgentTurnAuthorityScope = "project" | "thread";

export interface AgentTurnStart {
  readonly authority: AgentTaskLaunchAuthority;
  readonly authorityScope: AgentTurnAuthorityScope;
  readonly isCurrent?: () => boolean;
  readonly projectRoot: string;
  readonly threadId: string;
  readonly repositoryRoot: string;
  readonly cwd: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AgentAttachment>;
  readonly attachmentReferences: ReadonlyArray<StartAgentTaskAttachment>;
  readonly turnId: string;
  readonly agentCliKind: AgentCliKind;
  readonly providerAuthority: ReadyAgentProviderAdmissionAuthority;
  readonly resumeSessionId: string | null;
  readonly launch: AgentLaunchOptions;
  readonly createdWorktree: CreatedAgentWorktree | null;
  readonly registration: AgentTurnRegistration;
  readonly register: (turn: AgentTurn) => void;
  readonly onDefiniteStartRejection?: () => void;
  readonly startedNotice?: AgentTasksNotice | null;
}

export interface AgentTurnStartContext {
  readonly dependenciesRef: { readonly current: AgentTurnDispatchDependencies };
  readonly mountedRef: { readonly current: boolean };
  readonly streams: Map<string, AgentTurnOutputStream>;
  readonly startIntents: AgentTurnStartIntents;
}

interface AgentTurnStartIntent {
  stopRequested: boolean;
}

export interface AgentTurnStartIntents {
  begin(turnId: string): AgentTurnStartIntent;
  requestStop(turnId: string): boolean;
  end(turnId: string, intent: AgentTurnStartIntent): void;
}

export function createAgentTurnStartIntents(): AgentTurnStartIntents {
  const intents = new Map<string, AgentTurnStartIntent>();
  return {
    begin: (turnId) => {
      const intent = { stopRequested: false };
      intents.set(turnId, intent);
      return intent;
    },
    requestStop: (turnId) => {
      const intent = intents.get(turnId);
      if (intent === undefined) return false;
      intent.stopRequested = true;
      return true;
    },
    end: (turnId, intent) => {
      if (intents.get(turnId) === intent) intents.delete(turnId);
    },
  };
}

export async function runAgentTurnStart(
  context: AgentTurnStartContext,
  start: AgentTurnStart,
): Promise<boolean> {
  const intent = context.startIntents.begin(start.turnId);
  try {
    return await runOwnedTurnStart(context, start, intent);
  } finally {
    context.startIntents.end(start.turnId, intent);
  }
}

async function runOwnedTurnStart(
  context: AgentTurnStartContext,
  start: AgentTurnStart,
  intent: AgentTurnStartIntent,
): Promise<boolean> {
  const { dependenciesRef, mountedRef } = context;
  const deps = dependenciesRef.current;
  const { authority, repositoryRoot, turnId } = start;
  const workspaceId = authority.workspaceId;
  const gateway = deps.agentTaskGateway;
  const now = deps.now ?? Date.now;
  const retainUncertain = (): void => {
    if (start.createdWorktree === null) return;
    deps.retainUncertainWorktree(start.createdWorktree.receipt.worktreePath);
  };
  let turnRegistered = false;
  const stillOwned = (): boolean =>
    !intent.stopRequested &&
    turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start) &&
    (!turnRegistered || registeredTurnAlive(context, start));
  const abandon = async (): Promise<false> => {
    await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
    retainUncertain();
    settleRegisteredTurn(context, start, { kind: "stopped" });
    return false;
  };
  const stopStartedTurn = async (acknowledged: boolean): Promise<false> => {
    const stopped = await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
    if (!stopped.ok) {
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
      retainUncertain();
      settleRegisteredTurn(context, start, { kind: "stopped" });
      return false;
    }
    if (acknowledged) return false;
    const attached = await attempt(() =>
      gateway.acknowledgeAgentTaskStart({ taskId: turnId, workspaceId }),
    );
    if (attached.ok) return false;
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, attached.error);
    settleRegisteredTurn(context, start, { kind: "stopped" });
    return false;
  };
  const release = (acknowledged: boolean): Promise<false> => {
    const stopHandedToBackend =
      intent.stopRequested &&
      turnRegistered &&
      turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start) &&
      registeredTurnAlive(context, start);
    return stopHandedToBackend ? stopStartedTurn(acknowledged) : abandon();
  };
  if (!turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start)) return false;
  const cliVersion = deps.currentCliVersion?.(start.agentCliKind) ?? null;
  const turn = pendingTurn(
    turnId,
    start.prompt,
    now(),
    start.launch,
    cliVersion,
    start.attachments,
    start.providerAuthority.codexTransport,
  );
  if (start.registration === "before-start") {
    start.register(turn);
    turnRegistered = true;
  }
  if (!stillOwned()) {
    settleRegisteredTurn(context, start, { kind: "stopped" });
    return false;
  }
  const started = await attempt(() =>
    gateway.startAgentTask({
      taskId: turnId,
      threadId: start.threadId,
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
      attachments: start.attachmentReferences,
    }),
  );
  if (!started.ok && intent.stopRequested) {
    if (startEndedWithoutTask(started.error)) {
      settleRegisteredTurn(context, start, { kind: "stopped" });
      return false;
    }
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, started.error);
    return abandon();
  }
  if (!started.ok) {
    await reportStartFailure(context, start, started.error, retainUncertain);
    if (isDefiniteAgentTaskStartRejection(started.error)) start.onDefiniteStartRejection?.();
    return false;
  }
  if (started.value.taskId !== turnId) {
    const stopped = await attempt(() => gateway.stopAgentTask({ taskId: turnId, workspaceId }));
    retainUncertain();
    settleRegisteredTurn(context, start, { kind: "failed", message: UNEXPECTED_TASK_ID_MESSAGE });
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
  if (!stillOwned()) return release(false);
  if (start.registration === "after-start") {
    start.register(turn);
    turnRegistered = true;
  }
  if (!stillOwned()) return release(false);
  const acknowledged = await attempt(() =>
    gateway.acknowledgeAgentTaskStart({ taskId: turnId, workspaceId }),
  );
  if (!stillOwned()) return release(acknowledged.ok);
  const startedNotice = start.startedNotice ?? null;
  if (!acknowledged.ok) {
    const currentDeps = dependenciesRef.current;
    currentDeps.reportError(AGENT_TASKS_SOURCE, acknowledged.error);
    currentDeps.setNotice(warning(joinNoticeMessages(OUTPUT_NOT_ATTACHED_MESSAGE, startedNotice)));
    return true;
  }
  dependenciesRef.current.setNotice(startedNotice);
  return true;
}

function joinNoticeMessages(message: string, notice: AgentTasksNotice | null): string {
  if (notice === null) return message;
  return `${message} ${notice.message}`;
}

function startEndedWithoutTask(error: unknown): boolean {
  if (isDefiniteAgentTaskStartRejection(error)) return true;
  return errorMessageOf(error) === AGENT_TASK_STOPPED_BEFORE_START_MESSAGE;
}

function registeredTurnAlive(context: AgentTurnStartContext, start: AgentTurnStart): boolean {
  const thread = context.dependenciesRef.current.store.currentState().threads.get(start.threadId);
  if (thread === undefined || thread.archived) return false;
  return thread.turns.some((turn) => turn.turnId === start.turnId);
}

function settleRegisteredTurn(
  context: AgentTurnStartContext,
  start: AgentTurnStart,
  status: AgentTaskStatus,
): void {
  context.streams.delete(start.turnId);
  const deps = context.dependenciesRef.current;
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
}

async function reportStartFailure(
  context: AgentTurnStartContext,
  start: AgentTurnStart,
  error: unknown,
  retainUncertain: () => void,
): Promise<void> {
  const { dependenciesRef, mountedRef } = context;
  const { authority } = start;
  const trustRejected = isAgentDispatchTrustRejection(error);
  const definite = trustRejected || isDefiniteAgentTaskStartRejection(error);
  settleRegisteredTurn(context, start, {
    kind: "failed",
    message: definite ? errorMessageOf(error) : UNCERTAIN_START_MESSAGE,
  });
  if (!definite) retainUncertain();
  if (definite && start.createdWorktree !== null) {
    await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, start.createdWorktree);
  }
  if (!turnStartAuthorityIsCurrent(dependenciesRef, mountedRef, start)) return;
  const currentDeps = dependenciesRef.current;
  if (trustRejected) {
    noteTrustRejection(currentDeps, authority, error);
    return;
  }
  currentDeps.reportError(AGENT_TASKS_SOURCE, error);
  currentDeps.setNotice(failure(startFailureNotice(start, error, definite)));
}

function turnStartAuthorityIsCurrent(
  dependenciesRef: { readonly current: AgentTurnDispatchDependencies },
  mountedRef: { readonly current: boolean },
  start: AgentTurnStart,
): boolean {
  if (start.isCurrent?.() === false) return false;
  const current =
    start.authorityScope === "thread"
      ? isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, start.authority)
      : isCurrentTaskLaunchAuthority(
          dependenciesRef,
          mountedRef,
          start.authority,
          start.repositoryRoot,
        );
  if (!current) return false;
  return providerAdmissionIsCurrent(dependenciesRef.current, start.providerAuthority);
}

function pendingTurn(
  turnId: string,
  prompt: string,
  startedAtEpochMs: number,
  launch: AgentLaunchOptions,
  cliVersion: string | null,
  attachments: ReadonlyArray<AgentAttachment>,
  codexTransport?: CodexTransport,
): AgentTurn {
  if (attachments.length === 0) {
    return turnRecord(turnId, prompt, startedAtEpochMs, launch, cliVersion, codexTransport);
  }
  return {
    ...turnRecord(turnId, prompt, startedAtEpochMs, launch, cliVersion, codexTransport),
    attachments,
  };
}

function turnRecord(
  turnId: string,
  prompt: string,
  startedAtEpochMs: number,
  launch: AgentLaunchOptions,
  cliVersion: string | null,
  codexTransport?: CodexTransport,
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
    ...(launch.provider === "codex" ? { codexTransport: codexTransport ?? "exec" } : {}),
  };
}

function startFailureNotice(start: AgentTurnStart, error: unknown, definite: boolean): string {
  if (definite) {
    const message = errorMessageOf(error);
    return message === "" ? "The agent could not be started." : message;
  }
  if (start.createdWorktree === null) {
    return "The agent start result was uncertain, so a task may still be running.";
  }
  return "The agent start result was uncertain, so a task or its worktree may remain orphaned.";
}
