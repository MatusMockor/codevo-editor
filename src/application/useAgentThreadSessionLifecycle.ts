import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  AgentBackgroundTurnRecorder,
  type AgentBackgroundTurnPorts,
  type AgentBackgroundTurnRecording,
} from "./agentBackgroundTurnRecorder";
import { AGENT_TASKS_SOURCE, attempt, warning } from "./agentProjectAuthority";
import type {
  AgentSessionBackgroundInspection,
  AgentSessionEndResult,
  AgentSessionRestartVerdict,
  AgentTasksNotice,
} from "./agentThreadPorts";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";

export interface AgentThreadSessionLifecycleOptions {
  readonly gateway: AgentThreadSessionGateway | undefined;
  readonly readThread: (threadId: string) => AgentThread | undefined;
  readonly recordHaltRequest: (request: AgentTurnHaltRequest) => void;
  readonly ownsOwner: (owner: AgentThreadOwner) => boolean;
  readonly resumeSessionId: (thread: AgentThread) => string | null;
  readonly setNotice: (notice: AgentTasksNotice) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly backgroundTurns?: AgentBackgroundTurnPorts;
  readonly stateRevision?: unknown;
}

export interface AgentThreadSessionLifecycle {
  interrupt(threadId: string): Promise<boolean>;
  endSession(thread: AgentThread): Promise<AgentSessionEndResult>;
  inspectRestart(threadId: string, launch: AgentLaunchOptions): Promise<AgentSessionRestartVerdict>;
  inspectBackground(threadId: string): Promise<AgentSessionBackgroundInspection>;
}

type SessionEventSubscription<TEvent> = (
  gateway: AgentThreadSessionGateway,
  handler: (event: TEvent) => void,
) => Promise<() => void>;

interface SessionEventHandlers<TEvent> {
  readonly onEvent: (event: TEvent) => void;
  readonly onFailure: (error: unknown) => void;
}

interface ThreadAuthority {
  readonly threadId: string;
  readonly ownerId: string;
}

const subscribeSessionEnded: SessionEventSubscription<AgentSessionEndedEvent> = (
  gateway,
  handler,
) => gateway.subscribeAgentSessionEnded(handler);

const subscribeSessionBackgroundTurn: SessionEventSubscription<AgentSessionBackgroundTurnEvent> = (
  gateway,
  handler,
) => gateway.subscribeAgentSessionBackgroundTurn(handler);

export function useAgentThreadSessionLifecycle(
  options: AgentThreadSessionLifecycleOptions,
): AgentThreadSessionLifecycle {
  const optionsRef = useRef(options);
  const mountedRef = useRef(false);
  const [recorder] = useState(() => new AgentBackgroundTurnRecorder());
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recorder.clear(backgroundTurnRecording(optionsRef.current));
    };
  }, [recorder]);
  const { stateRevision } = options;
  useEffect(() => {
    const recording = backgroundTurnRecording(optionsRef.current);
    if (recording === null) return;
    recorder.flush(recording);
  }, [recorder, stateRevision]);

  const isCurrent = useCallback((authority: ThreadAuthority): boolean => {
    if (!mountedRef.current) return false;
    const thread = optionsRef.current.readThread(authority.threadId);
    if (thread === undefined) return false;
    return thread.owner.ownerId === authority.ownerId;
  }, []);

  useSessionEventSubscription(options.gateway, subscribeSessionEnded, {
    onEvent: (event) => announceSessionEnded(options, event),
    onFailure: (error) => options.reportError(AGENT_TASKS_SOURCE, error),
  });
  useSessionEventSubscription(options.gateway, subscribeSessionBackgroundTurn, {
    onEvent: (event) => recordSessionBackgroundTurn(options, recorder, event),
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

  return { interrupt, endSession, inspectRestart, inspectBackground };
}

function useSessionEventSubscription<TEvent>(
  gateway: AgentThreadSessionGateway | undefined,
  subscribe: SessionEventSubscription<TEvent>,
  handlers: SessionEventHandlers<TEvent>,
): void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    if (gateway === undefined) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribe(gateway, (event) => {
      if (disposed) return;
      handlersRef.current.onEvent(event);
    }).then(
      (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unsubscribe = stop;
      },
      (error: unknown) => {
        if (disposed) return;
        handlersRef.current.onFailure(error);
      },
    );
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [gateway, subscribe]);
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

function recordSessionBackgroundTurn(
  options: AgentThreadSessionLifecycleOptions,
  recorder: AgentBackgroundTurnRecorder,
  event: AgentSessionBackgroundTurnEvent,
): void {
  const recording = backgroundTurnRecording(options);
  if (recording === null) return;
  const thread = options.readThread(event.threadId);
  if (thread === undefined || !isLocalClaudeThread(thread)) return;
  if (thread.owner.ownerId !== event.workspaceId) return;
  recorder.receive(recording, thread, event);
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
