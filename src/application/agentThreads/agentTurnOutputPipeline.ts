import type { CodexTransport } from "../../domain/agentProviderSettings";
import {
  isTerminalAgentTaskStatus,
  type AgentTaskGateway,
  type AgentTaskOutputEvent,
  type AgentTaskStatusEvent,
} from "../../domain/agentTask";
import { agentTaskStatusActionAccepted, type AgentThread } from "../../domain/agentThread";
import { createAgentOutputAcknowledgement } from "../agentOutputAcknowledgement";
import { AGENT_TASKS_SOURCE, warning } from "../agentProjectAuthority";
import type { AgentSessionContinuity } from "../agentSessionContinuity";
import {
  acceptAgentTurnOutput,
  createAgentTurnOutputStream,
  domainAgentOutputParser,
  drainAgentAccountUsage,
  drainAgentTurnOutput,
  finishAgentTurnOutput,
  scheduleAgentOutputFrame,
  type AgentOutputParserPort,
  type AgentTurnOutputStream,
} from "../agentTurnOutputStream";
import { noteResumeFailure, noteSessionReport } from "../agentTurnSessionReports";
import type { AgentTurnDispatchDependencies } from "./agentTurnDispatchContract";

export interface AgentTurnOutputPipelineContext {
  readonly dependenciesRef: { readonly current: AgentTurnDispatchDependencies };
  readonly mountedRef: { readonly current: boolean };
  readonly sessionContinuity: AgentSessionContinuity;
  onTurnSettled(threadId: string): void;
}

export interface AgentTurnOutputPipeline {
  readonly streams: Map<string, AgentTurnOutputStream>;
  flushStreams(): void;
  registerStream(
    thread: AgentThread,
    turnId: string,
    resumeSessionId: string | null,
    codexTransport?: CodexTransport,
  ): void;
  subscribe(gateway: AgentTaskGateway): () => void;
}

type OutputAcknowledgement = ReturnType<typeof createAgentOutputAcknowledgement>;

export function createAgentTurnOutputPipeline(
  context: AgentTurnOutputPipelineContext,
): AgentTurnOutputPipeline {
  const { dependenciesRef, mountedRef, sessionContinuity } = context;
  const streams = new Map<string, AgentTurnOutputStream>();
  const sessionWarnedThreads = new Set<string>();
  let frame: (() => void) | null = null;
  let outputSubscription = { epoch: 0, ready: false };
  let outputAcks = new WeakMap<AgentTurnOutputStream, OutputAcknowledgement>();

  const parser = (): AgentOutputParserPort =>
    dependenciesRef.current.outputParser ?? domainAgentOutputParser;

  const cancelFrame = (): void => {
    frame?.();
    frame = null;
  };

  const flushStreams = (): void => {
    cancelFrame();
    if (!mountedRef.current) return;
    const deps = dependenciesRef.current;
    for (const stream of streams.values()) {
      const action = drainAgentTurnOutput(stream, stream.lastSequence);
      if (action === null) continue;
      deps.store.dispatchAction(action);
      noteSessionReport(deps, sessionContinuity, stream, action.sessionId, sessionWarnedThreads);
    }
  };

  const scheduleFlush = (): void => {
    if (frame !== null) return;
    frame = scheduleAgentOutputFrame(flushStreams);
  };

  const acknowledgementFor = (
    stream: AgentTurnOutputStream,
    taskId: string,
    gateway: AgentTaskGateway,
    acknowledgeOutput: NonNullable<AgentTaskGateway["acknowledgeAgentTaskOutput"]>,
  ): OutputAcknowledgement => {
    const existing = outputAcks.get(stream);
    if (existing !== undefined) return existing;
    const outputEpoch = outputSubscription.epoch;
    const acknowledge = acknowledgeOutput.bind(gateway);
    const isCurrent = (): boolean =>
      mountedRef.current &&
      outputSubscription.epoch === outputEpoch &&
      streams.get(taskId) === stream &&
      dependenciesRef.current.agentTaskGateway === gateway;
    const ack = createAgentOutputAcknowledgement({
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
    outputAcks.set(stream, ack);
    return ack;
  };

  const handleOutputEvent = (event: AgentTaskOutputEvent): void => {
    const stream = streams.get(event.taskId);
    if (stream === undefined) return;
    if (!acceptAgentTurnOutput(parser(), stream, event)) return;
    const gateway = dependenciesRef.current.agentTaskGateway;
    if (gateway.acknowledgeAgentTaskOutput !== undefined) {
      acknowledgementFor(
        stream,
        event.taskId,
        gateway,
        gateway.acknowledgeAgentTaskOutput,
      ).consumed(event.sequence);
    }
    const deps = dependenciesRef.current;
    for (const observation of drainAgentAccountUsage(stream)) {
      deps.onAccountUsageObserved?.(observation);
    }
    // The runtime owns stdin lifetime, including live background work after a result.
    scheduleFlush();
  };

  const handleStatusEvent = (event: AgentTaskStatusEvent): void => {
    const deps = dependenciesRef.current;
    const stream = streams.get(event.taskId);
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
          sessionContinuity,
          stream,
          finished.sessionId,
          sessionWarnedThreads,
        );
      }
      streams.delete(event.taskId);
      noteResumeFailure(deps, sessionContinuity, stream, event);
    }
    deps.store.dispatchAction(action);
    if (!terminal) return;
    deps.onTurnTerminal?.(event);
    context.onTurnSettled(stream.threadId);
  };

  const subscribe = (gateway: AgentTaskGateway): (() => void) => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const outputSubscriptionEpoch = outputSubscription.epoch + 1;
    outputSubscription = { epoch: outputSubscriptionEpoch, ready: false };
    markOutputStreamsIncomplete(streams);
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
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        if (outputSubscription.epoch !== outputSubscriptionEpoch) {
          unsubscribe();
          return;
        }
        outputSubscription = { epoch: outputSubscriptionEpoch, ready: true };
        unsubscribers.push(unsubscribe);
      })
      .catch((error: unknown) => {
        if (!disposed && outputSubscription.epoch === outputSubscriptionEpoch) {
          outputSubscription = { epoch: outputSubscriptionEpoch, ready: false };
          markOutputStreamsIncomplete(streams);
        }
        report(AGENT_TASKS_SOURCE, error);
      });
    return () => {
      disposed = true;
      if (outputSubscription.epoch === outputSubscriptionEpoch) {
        outputSubscription = { epoch: outputSubscriptionEpoch + 1, ready: false };
        outputAcks = new WeakMap();
        markOutputStreamsIncomplete(streams);
      }
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      cancelFrame();
    };
  };

  return {
    streams,
    flushStreams,
    registerStream(thread, turnId, resumeSessionId, codexTransport) {
      streams.set(
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
    subscribe,
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
