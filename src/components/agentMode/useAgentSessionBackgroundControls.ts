import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import { useLatest } from "../../ui/foundation/useLatest";
import {
  agentSessionTaskControls,
  type AgentSessionEndOffer,
  type AgentSessionTaskControls,
} from "./conversation/agentSessionTaskControls";
import type { AgentComposerSessionStopPort } from "./useAgentComposerStop";
import {
  agentSessionEndSuggested,
  agentSessionPendingTaskIds,
  agentSessionTasksStoppable,
  useAgentSessionTaskStops,
  type AgentSessionTaskStops,
} from "./useAgentSessionTaskStops";

export type AgentSessionBackgroundControlsSurface = Pick<
  AgentThreadsSurface,
  "threads" | "stopSessionBackgroundTask" | "endSession"
>;

export interface AgentSessionBackgroundControls {
  readonly controls: AgentSessionTaskControls | null;
  readonly sessionStop: AgentComposerSessionStopPort | undefined;
  onStopTask(threadId: string, taskId: string): void;
  onEndSession(): void;
}

export function useAgentSessionBackgroundControls(
  agents: AgentSessionBackgroundControlsSurface,
  view: AgentThreadView | null,
  reportNotice: (notice: AgentTasksNotice) => void,
  requestEndSession: RefObject<(threadId: string) => void>,
): AgentSessionBackgroundControls {
  const stops = useAgentSessionTaskStops(agents, reportNotice);
  const endSessionAvailable = agents.endSession !== undefined;
  const previousControls = useRef<AgentSessionTaskControls | null>(null);
  const controls = useMemo(
    () => sessionTaskControlsFor(stops, view, endSessionAvailable, previousControls.current),
    [endSessionAvailable, stops, view],
  );
  useLayoutEffect(() => {
    previousControls.current = controls;
  }, [controls]);
  const viewRef = useLatest(view);
  const { available, stopAllTasks, stopTask } = stops;
  const onStopTask = useCallback(
    (threadId: string, taskId: string): void => {
      if (viewRef.current?.thread.threadId !== threadId) return;
      stopTask(threadId, taskId);
    },
    [stopTask, viewRef],
  );
  const onEndSession = useCallback((): void => {
    const current = viewRef.current;
    if (current === null) return;
    requestEndSession.current(current.thread.threadId);
  }, [requestEndSession, viewRef]);
  const sessionStop = useMemo((): AgentComposerSessionStopPort | undefined => {
    if (!available) return undefined;
    if (!endSessionAvailable) return { stopTasks: stopAllTasks };
    return {
      stopTasks: stopAllTasks,
      endSession: (threadId: string) => requestEndSession.current(threadId),
    };
  }, [available, endSessionAvailable, requestEndSession, stopAllTasks]);
  return useMemo(
    () => ({ controls, sessionStop, onStopTask, onEndSession }),
    [controls, onEndSession, onStopTask, sessionStop],
  );
}

function sessionTaskControlsFor(
  stops: AgentSessionTaskStops,
  view: AgentThreadView | null,
  endSessionAvailable: boolean,
  previous: AgentSessionTaskControls | null,
): AgentSessionTaskControls | null {
  if (view === null || !stops.available || !agentSessionTasksStoppable(view)) return null;
  return agentSessionTaskControls(
    view.sessionBackground ?? null,
    agentSessionPendingTaskIds(stops.pending, view),
    endSessionOffer(stops, view, endSessionAvailable),
    previous,
  );
}

function endSessionOffer(
  stops: AgentSessionTaskStops,
  view: AgentThreadView,
  endSessionAvailable: boolean,
): AgentSessionEndOffer {
  if (!endSessionAvailable || view.lifecycle === "running" || view.thread.archived) {
    return "hidden";
  }
  if (agentSessionEndSuggested(stops.endSessionSuggestion, view)) return "suggested";
  return "offered";
}
