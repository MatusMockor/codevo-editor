import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { runningTurn, type AgentThread, type AgentThreadOwner } from "../domain/agentThread";
import {
  agentSessionEndedNotice,
  type AgentSessionBackgroundTurnEvent,
  type AgentSessionEndedEvent,
  type AgentSessionInspection,
  type AgentTaskInterruptOutcome,
  type AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import type { AgentTurnHaltRequest } from "../domain/agentTurnHaltRequest";
import { latestPromptedAgentLaunch } from "../domain/agentTurnOrigin";
import {
  recordAgentBackgroundTurn,
  reportUnrecordedAgentBackgroundTurn,
  type AgentBackgroundTurnPorts,
  type AgentBackgroundTurnRecording,
} from "./agentBackgroundTurnRecorder";
import type { AgentEvictedThreadPort, AgentThreadRecovery } from "./agentEvictedThreadRecovery";
import { AGENT_TASKS_SOURCE, attempt, warning } from "./agentProjectAuthority";
import type {
  AgentSessionBackgroundInspection,
  AgentSessionEndResult,
  AgentSessionRestartVerdict,
  AgentSessionTaskStopResult,
  AgentTasksNotice,
} from "./agentThreadPorts";
import { AgentThreadRecoveryQueue } from "./agentThreadRecoveryQueue";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";
import {
  useAgentSessionEventSubscription,
  type AgentSessionEventSubscription,
} from "./useAgentSessionEventSubscription";

export interface AgentThreadSessionLifecycleOptions {
  readonly gateway: AgentThreadSessionGateway | undefined;
  readonly readThread: (threadId: string) => AgentThread | undefined;
  readonly recordHaltRequest: (request: AgentTurnHaltRequest) => void;
  readonly ownsOwner: (owner: AgentThreadOwner) => boolean;
  readonly resumeSessionId: (thread: AgentThread) => string | null;
  readonly setNotice: (notice: AgentTasksNotice) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly backgroundTurns?: AgentBackgroundTurnPorts;
  readonly evictedThreads?: AgentEvictedThreadPort;
}

export interface AgentThreadSessionLifecycle {
  interrupt(threadId: string): Promise<boolean>;
  endSession(thread: AgentThread): Promise<AgentSessionEndResult>;
  inspectRestart(threadId: string, launch: AgentLaunchOptions): Promise<AgentSessionRestartVerdict>;
  inspectBackground(threadId: string): Promise<AgentSessionBackgroundInspection>;
  stopBackgroundTask(threadId: string, taskId: string): Promise<AgentSessionTaskStopResult>;
}

interface ThreadAuthority {
  readonly threadId: string;
  readonly ownerId: string;
}

interface BackgroundTurnReceiver {
  readonly options: () => AgentThreadSessionLifecycleOptions;
  readonly mounted: () => boolean;
  readonly recoveries: AgentThreadRecoveryQueue;
}

const subscribeSessionEnded: AgentSessionEventSubscription<AgentSessionEndedEvent> = (
  gateway,
  handler,
) => gateway.subscribeAgentSessionEnded(handler);

const subscribeSessionBackgroundTurn: AgentSessionEventSubscription<
  AgentSessionBackgroundTurnEvent
> = (gateway, handler) => gateway.subscribeAgentSessionBackgroundTurn(handler);

export function useAgentThreadSessionLifecycle(
  options: AgentThreadSessionLifecycleOptions,
): AgentThreadSessionLifecycle {
  const optionsRef = useRef(options);
  const mountedRef = useRef(false);
  const receiverRef = useRef<BackgroundTurnReceiver | null>(null);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isCurrent = useCallback((authority: ThreadAuthority): boolean => {
    if (!mountedRef.current) return false;
    const thread = optionsRef.current.readThread(authority.threadId);
    if (thread === undefined) return false;
    return thread.owner.ownerId === authority.ownerId;
  }, []);

  useAgentSessionEventSubscription(options.gateway, subscribeSessionEnded, {
    onEvent: (event) => announceSessionEnded(options, event),
    onFailure: (error) => options.reportError(AGENT_TASKS_SOURCE, error),
  });
  useAgentSessionEventSubscription(options.gateway, subscribeSessionBackgroundTurn, {
    onEvent: (event) => {
      receiverRef.current ??= {
        options: () => optionsRef.current,
        mounted: () => mountedRef.current,
        recoveries: new AgentThreadRecoveryQueue((error) =>
          optionsRef.current.reportError(AGENT_TASKS_SOURCE, error),
        ),
      };
      receiveSessionBackgroundTurn(receiverRef.current, event);
    },
    onFailure: (error) => options.reportError(AGENT_TASKS_SOURCE, error),
  });

  const interrupt = useCallback(
    async (threadId: string): Promise<boolean> => {
      const { gateway, readThread } = optionsRef.current;
      const thread = readThread(threadId);
      if (gateway === undefined || thread === undefined) return false;
      if (!isLocalClaudeThread(thread)) return false;
      const turn = runningTurn(thread);
      if (turn === null) return false;
      const authority = { threadId, ownerId: thread.owner.ownerId };
      optionsRef.current.recordHaltRequest({ ...authority, turnId: turn.turnId });
      const outcome = await attempt(() =>
        gateway.interruptAgentTask({
          taskId: turn.turnId,
          workspaceId: authority.ownerId,
          threadId,
        }),
      );
      if (!isCurrent(authority)) return false;
      if (!isRunningTurn(optionsRef.current.readThread(threadId), turn.turnId)) return false;
      if (!outcome.ok) {
        optionsRef.current.reportError(AGENT_TASKS_SOURCE, outcome.error);
        return false;
      }
      return interruptAccepted(outcome.value);
    },
    [isCurrent],
  );

  const endSession = useCallback(async (thread: AgentThread): Promise<AgentSessionEndResult> => {
    const { gateway } = optionsRef.current;
    if (gateway === undefined || !isLocalClaudeThread(thread)) return "none";
    const ended = await attempt(() =>
      gateway.endAgentThreadSession({
        workspaceId: thread.owner.ownerId,
        threadId: thread.threadId,
      }),
    );
    if (ended.ok) return ended.value ? "ended" : "none";
    if (!mountedRef.current || !optionsRef.current.ownsOwner(thread.owner)) return "failed";
    optionsRef.current.reportError(AGENT_TASKS_SOURCE, ended.error);
    return "failed";
  }, []);

  const inspectRestart = useCallback(
    async (threadId: string, launch: AgentLaunchOptions): Promise<AgentSessionRestartVerdict> => {
      const { gateway, readThread, resumeSessionId } = optionsRef.current;
      const thread = readThread(threadId);
      if (gateway === undefined || thread === undefined) return "proceed";
      if (!isLocalClaudeThread(thread)) return "proceed";
      const authority = { threadId, ownerId: thread.owner.ownerId };
      const inspection = await attempt(() =>
        gateway.inspectAgentThreadSession({
          workspaceId: authority.ownerId,
          threadId,
          resumeSessionId: resumeSessionId(thread),
          launch,
        }),
      );
      if (!isCurrent(authority)) return "proceed";
      if (!inspection.ok) {
        optionsRef.current.reportError(AGENT_TASKS_SOURCE, inspection.error);
        return "proceed";
      }
      return restartVerdict(inspection.value);
    },
    [isCurrent],
  );

  const inspectBackground = useCallback(
    async (threadId: string): Promise<AgentSessionBackgroundInspection> => {
      const { gateway, readThread, resumeSessionId } = optionsRef.current;
      const thread = readThread(threadId);
      if (gateway === undefined || thread === undefined) return "none";
      if (!isLocalClaudeThread(thread)) return "none";
      const launch = latestPromptedAgentLaunch(thread.turns);
      if (launch === null) return "none";
      const authority = { threadId, ownerId: thread.owner.ownerId };
      const inspection = await attempt(() =>
        gateway.inspectAgentThreadSession({
          workspaceId: authority.ownerId,
          threadId,
          resumeSessionId: resumeSessionId(thread),
          launch,
        }),
      );
      if (!isCurrent(authority) || !inspection.ok) return "unknown";
      return backgroundInspection(inspection.value);
    },
    [isCurrent],
  );

  const stopBackgroundTask = useCallback(
    async (threadId: string, taskId: string): Promise<AgentSessionTaskStopResult> => {
      const { gateway, readThread } = optionsRef.current;
      const thread = readThread(threadId);
      if (gateway === undefined || thread === undefined) return { kind: "noSession" };
      if (!isLocalClaudeThread(thread)) return { kind: "noSession" };
      const authority = { threadId, ownerId: thread.owner.ownerId };
      const outcome = await attempt(() =>
        gateway.stopAgentBackgroundTask({ workspaceId: authority.ownerId, threadId, taskId }),
      );
      if (!isCurrent(authority) || !optionsRef.current.ownsOwner(thread.owner)) {
        return { kind: "stale" };
      }
      if (!outcome.ok) {
        optionsRef.current.reportError(AGENT_TASKS_SOURCE, outcome.error);
        return { kind: "unavailable" };
      }
      return outcome.value;
    },
    [isCurrent],
  );

  return { interrupt, endSession, inspectRestart, inspectBackground, stopBackgroundTask };
}

function announceSessionEnded(
  options: AgentThreadSessionLifecycleOptions,
  event: AgentSessionEndedEvent,
): void {
  const thread = options.readThread(event.threadId);
  if (thread === undefined || !isLocalClaudeThread(thread)) return;
  if (thread.owner.ownerId !== event.workspaceId) return;
  const message = agentSessionEndedNotice(event);
  if (message === null) return;
  options.setNotice(warning(message));
}

function receiveSessionBackgroundTurn(
  receiver: BackgroundTurnReceiver,
  event: AgentSessionBackgroundTurnEvent,
): void {
  const options = receiver.options();
  if (backgroundTurnRecording(options) === null) return;
  if (isRemoteAgentIdentity(event.threadId)) return;
  const thread = options.readThread(event.threadId);
  if (thread !== undefined && !receiver.recoveries.isRecovering(thread.owner.rootKey)) {
    recordLoadedBackgroundTurn(options, thread, event);
    return;
  }
  const rootKey = options.evictedThreads?.rootKeyOf(event.workspaceId) ?? null;
  if (rootKey === null) return;
  const queued = receiver.recoveries.enqueue(rootKey, () =>
    recordRecoveredBackgroundTurn(receiver, event),
  );
  if (queued) return;
  reportUnrecordedAgentBackgroundTurn(options.setNotice, null, event);
}

async function recordRecoveredBackgroundTurn(
  receiver: BackgroundTurnReceiver,
  event: AgentSessionBackgroundTurnEvent,
): Promise<void> {
  if (!receiver.mounted()) return;
  const loaded = receiver.options().readThread(event.threadId);
  if (loaded !== undefined) {
    recordLoadedBackgroundTurn(receiver.options(), loaded, event);
    return;
  }
  const evicted = receiver.options().evictedThreads;
  if (evicted === undefined) return;
  const recovery = await evicted.recover(event.threadId, event.workspaceId);
  if (!receiver.mounted() || recovery.kind === "foreign") return;
  const options = receiver.options();
  const reopened = options.readThread(event.threadId);
  if (reopened !== undefined) {
    recordLoadedBackgroundTurn(options, reopened, event);
    return;
  }
  reportUnrecordedAgentBackgroundTurn(options.setNotice, recoveredTitle(recovery), event);
}

function recordLoadedBackgroundTurn(
  options: AgentThreadSessionLifecycleOptions,
  thread: AgentThread,
  event: AgentSessionBackgroundTurnEvent,
): void {
  const recording = backgroundTurnRecording(options);
  if (recording === null || !isLocalClaudeThread(thread)) return;
  if (thread.owner.ownerId !== event.workspaceId) return;
  recordAgentBackgroundTurn(recording, thread, event);
}

function recoveredTitle(recovery: AgentThreadRecovery): string | null {
  switch (recovery.kind) {
    case "notRestored":
      return recovery.title;
    case "restored":
    case "foreign":
      return null;
    default:
      return unsupportedRecovery(recovery);
  }
}

function unsupportedRecovery(recovery: never): never {
  throw new TypeError(`Unsupported agent thread recovery: ${String(recovery)}.`);
}

function backgroundTurnRecording(
  options: AgentThreadSessionLifecycleOptions,
): AgentBackgroundTurnRecording | null {
  const ports = options.backgroundTurns;
  if (ports === undefined) return null;
  return { ports, readThread: options.readThread, setNotice: options.setNotice };
}

function isRunningTurn(thread: AgentThread | undefined, turnId: string): boolean {
  if (thread === undefined) return false;
  return runningTurn(thread)?.turnId === turnId;
}

function isLocalClaudeThread(thread: AgentThread): boolean {
  return thread.provider.kind === "claudeCode" && !isRemoteAgentIdentity(thread.threadId);
}

function interruptAccepted(outcome: AgentTaskInterruptOutcome): boolean {
  switch (outcome.kind) {
    case "interrupting":
      return true;
    case "stopping":
    case "unsupported":
    case "unavailable":
      return false;
    default:
      return unsupportedInterruptOutcome(outcome.kind);
  }
}

function restartVerdict(inspection: AgentSessionInspection): AgentSessionRestartVerdict {
  if (inspection.kind !== "restart") return "proceed";
  if (!inspection.backgroundTasks) return "proceed";
  return "confirm";
}

function backgroundInspection(
  inspection: AgentSessionInspection,
): AgentSessionBackgroundInspection {
  if (inspection.kind === "none") return "none";
  return inspection.backgroundTasks ? "live" : "none";
}

function unsupportedInterruptOutcome(kind: never): never {
  throw new TypeError(`Unsupported agent interrupt outcome: ${String(kind)}.`);
}
