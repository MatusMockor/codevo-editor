import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import {
  useAgentStopController,
  type AgentStopConfirmation,
} from "../../application/useAgentStopController";
import { runningTurn } from "../../domain/agentThread";
import type { AgentTurnHaltSource } from "../../domain/agentTurnHaltRecord";
import type { AgentStopConfirmationView } from "./AgentStopConfirmationBanner";
import { agentSessionTasksStoppable } from "./useAgentSessionTaskStops";

export type AgentComposerStopSurface = Pick<AgentThreadsSurface, "interrupt" | "stop">;

export interface AgentComposerSessionStopPort {
  stopTasks(threadId: string): void;
  endSession?(threadId: string): void;
}

export interface AgentComposerStopControls {
  readonly running: boolean;
  readonly sessionTasksStoppable: boolean;
  readonly stopConfirmation: AgentStopConfirmationView | null;
  onStop(source: AgentTurnHaltSource): void;
  onStopNow(source: AgentTurnHaltSource): void;
}

interface IdleSessionTarget {
  readonly threadId: string;
  readonly ownerId: string;
  readonly liveTaskCount: number;
  readonly endable: boolean;
}

export function useAgentComposerStop(
  selectedThread: AgentThreadView | null,
  agents: AgentComposerStopSurface,
  sessionStop?: AgentComposerSessionStopPort,
): AgentComposerStopControls {
  const runningThreadId =
    selectedThread?.lifecycle === "running" ? selectedThread.thread.threadId : null;
  const runningTurnId =
    runningThreadId === null || selectedThread === null
      ? null
      : (runningTurn(selectedThread.thread)?.turnId ?? null);
  const idle = idleSessionTarget(selectedThread, sessionStop);
  const idleThreadId = idle?.threadId ?? null;
  const idleOwnerId = idle?.ownerId ?? null;
  const idleTaskCount = idle?.liveTaskCount ?? 0;
  const idleEndable = idle?.endable === true;
  const runningThreadIdRef = useRef(runningThreadId);
  runningThreadIdRef.current = runningThreadId;
  const idleRef = useRef(idle);
  idleRef.current = idle;
  const selectedThreadRef = useRef(selectedThread);
  selectedThreadRef.current = selectedThread;
  const sessionStopRef = useRef(sessionStop);
  sessionStopRef.current = sessionStop;
  const { cancelStop, confirmation, requestStop, stopNow } = useAgentStopController({
    readRunningTurn: (threadId) => {
      const view = selectedThreadRef.current;
      if (view === null || view.thread.threadId !== threadId) return null;
      return runningTurn(view.thread);
    },
    readSessionBackgroundTaskCount: (threadId) => {
      const target = idleRef.current;
      if (target === null || target.threadId !== threadId) return 0;
      return target.liveTaskCount;
    },
    stopSessionBackground: (threadId) => sessionStopRef.current?.stopTasks(threadId),
    hardStop: agents.stop,
    interrupt: agents.interrupt,
  });
  useEffect(() => {
    if (runningThreadId === null) return;
    return cancelStop;
  }, [cancelStop, runningThreadId, runningTurnId]);
  useEffect(() => {
    if (idleThreadId === null) return;
    return cancelStop;
  }, [cancelStop, idleOwnerId, idleThreadId]);
  const onStop = useCallback(
    (source: AgentTurnHaltSource): void => {
      const threadId = runningThreadIdRef.current ?? idleRef.current?.threadId ?? null;
      if (threadId === null) return;
      requestStop(threadId, source);
    },
    [requestStop],
  );
  const onStopNow = useCallback(
    (source: AgentTurnHaltSource): void => {
      const threadId = runningThreadIdRef.current;
      if (threadId === null) return;
      stopNow(threadId, source);
    },
    [stopNow],
  );
  const sessionActions = useMemo(
    () => ({
      stopTasks: (threadId: string): void => {
        cancelStop();
        sessionStopRef.current?.stopTasks(threadId);
      },
      endSession: (threadId: string): void => {
        cancelStop();
        sessionStopRef.current?.endSession?.(threadId);
      },
    }),
    [cancelStop],
  );
  const stopConfirmation = useMemo(
    () =>
      stopConfirmationView(confirmation, {
        runningThreadId,
        runningTurnId,
        idle:
          idleThreadId === null
            ? null
            : { threadId: idleThreadId, liveTaskCount: idleTaskCount, endable: idleEndable },
        onCancel: cancelStop,
        session: sessionActions,
      }),
    [
      cancelStop,
      confirmation,
      idleEndable,
      idleTaskCount,
      idleThreadId,
      runningThreadId,
      runningTurnId,
      sessionActions,
    ],
  );
  return {
    running: runningThreadId !== null,
    sessionTasksStoppable: idleThreadId !== null,
    stopConfirmation,
    onStop,
    onStopNow,
  };
}

interface StopConfirmationScope {
  readonly runningThreadId: string | null;
  readonly runningTurnId: string | null;
  readonly idle: Omit<IdleSessionTarget, "ownerId"> | null;
  readonly onCancel: () => void;
  readonly session: Required<AgentComposerSessionStopPort>;
}

function stopConfirmationView(
  confirmation: AgentStopConfirmation | null,
  scope: StopConfirmationScope,
): AgentStopConfirmationView | null {
  if (confirmation === null) return null;
  const { onCancel } = scope;
  if (confirmation.kind === "confirmSessionBackground") {
    const { idle } = scope;
    const threadId = confirmation.threadId;
    if (idle === null || threadId !== idle.threadId) return null;
    const view: AgentStopConfirmationView = {
      kind: "confirmSessionBackground",
      liveTaskCount: idle.liveTaskCount,
      onCancel,
      onStopTasks: () => scope.session.stopTasks(threadId),
    };
    if (!idle.endable) return view;
    return { ...view, onEndSession: () => scope.session.endSession(threadId) };
  }
  if (
    confirmation.threadId !== scope.runningThreadId ||
    confirmation.turnId !== scope.runningTurnId
  ) {
    return null;
  }
  if (confirmation.kind === "interrupting") return { kind: "interrupting", onCancel };
  return { kind: "confirmBackground", liveTaskCount: confirmation.liveTaskCount, onCancel };
}

function idleSessionTarget(
  view: AgentThreadView | null,
  sessionStop: AgentComposerSessionStopPort | undefined,
): IdleSessionTarget | null {
  if (view === null || sessionStop === undefined) return null;
  if (view.lifecycle === "running" || !agentSessionTasksStoppable(view)) return null;
  const session = view.sessionBackground;
  return {
    threadId: view.thread.threadId,
    ownerId: view.thread.owner.ownerId,
    liveTaskCount: Math.max(session?.total ?? 0, session?.tasks.length ?? 0),
    endable: sessionStop.endSession !== undefined && !view.thread.archived,
  };
}
