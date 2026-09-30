import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionTaskStopResult,
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import { useLatest } from "../../ui/foundation/useLatest";
import { agentSessionTaskLabel } from "./conversation/agentSessionTaskControls";
import {
  agentSessionTaskStopReport,
  agentSessionTaskStopTimedOutReport,
  type AgentSessionTaskStopReport,
} from "./agentSessionTaskStopNotices";

export const AGENT_SESSION_TASK_STOP_TIMEOUT_MS = 15_000;
const MAX_PENDING_TASK_STOPS = 64;

export type AgentSessionTaskStopSurface = Pick<
  AgentThreadsSurface,
  "threads" | "stopSessionBackgroundTask"
>;

export interface AgentSessionTaskStop {
  readonly id: number;
  readonly ownerId: string;
  readonly threadId: string;
  readonly taskId: string;
  readonly label: string;
}

export interface AgentSessionEndSuggestion {
  readonly ownerId: string;
  readonly threadId: string;
}

export interface AgentSessionTaskStops {
  readonly pending: ReadonlyArray<AgentSessionTaskStop>;
  readonly endSessionSuggestion: AgentSessionEndSuggestion | null;
  readonly available: boolean;
  stopTask(threadId: string, taskId: string): void;
  stopAllTasks(threadId: string): void;
}

type ReportNotice = (notice: AgentTasksNotice) => void;

export function useAgentSessionTaskStops(
  agents: AgentSessionTaskStopSurface,
  reportNotice: ReportNotice,
): AgentSessionTaskStops {
  const { stopSessionBackgroundTask, threads } = agents;
  const [entries, setEntries] = useState<ReadonlyArray<AgentSessionTaskStop>>([]);
  const pending = useMemo(
    () => entries.filter((entry) => isLiveTaskStop(threads, entry)),
    [entries, threads],
  );
  if (pending.length !== entries.length) setEntries(pending);
  const [endSessionSuggestion, setEndSessionSuggestion] =
    useState<AgentSessionEndSuggestion | null>(null);
  const pendingRef = useRef<ReadonlyArray<AgentSessionTaskStop>>(pending);
  const threadsRef = useLatest(threads);
  const stopRef = useLatest(stopSessionBackgroundTask);
  const reportRef = useLatest(reportNotice);
  const nextIdRef = useRef(0);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useLayoutEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const commit = useCallback((next: ReadonlyArray<AgentSessionTaskStop>): void => {
    pendingRef.current = next;
    setEntries(next);
  }, []);

  const release = useCallback(
    (entry: AgentSessionTaskStop): boolean => {
      const timer = timersRef.current.get(entry.id);
      if (timer !== undefined) clearTimeout(timer);
      timersRef.current.delete(entry.id);
      if (!mountedRef.current) return false;
      const live = pendingRef.current;
      if (!live.some((candidate) => candidate.id === entry.id)) return false;
      commit(live.filter((candidate) => candidate.id !== entry.id));
      return isLiveTaskStop(threadsRef.current, entry);
    },
    [commit, threadsRef],
  );

  const publish = useCallback(
    (entry: AgentSessionTaskStop, report: AgentSessionTaskStopReport, notify: ReportNotice) => {
      if (report.suggestEndSession) {
        setEndSessionSuggestion({ ownerId: entry.ownerId, threadId: entry.threadId });
      }
      notify(report.notice);
    },
    [],
  );

  const settle = useCallback(
    (entry: AgentSessionTaskStop, result: AgentSessionTaskStopResult, notify: ReportNotice) => {
      if (result.kind === "stopping") return;
      if (!release(entry)) return;
      const report = agentSessionTaskStopReport(result, entry.label);
      if (report === null) return;
      publish(entry, report, notify);
    },
    [publish, release],
  );

  const stopTask = useCallback(
    (threadId: string, taskId: string): void => {
      const stop = stopRef.current;
      if (stop === undefined) return;
      const target = sessionTask(threadsRef.current, threadId, taskId);
      if (target === null) return;
      const live = pendingRef.current;
      if (live.some((entry) => sameTask(entry, target.ownerId, threadId, taskId))) return;
      if (live.length >= MAX_PENDING_TASK_STOPS) return;
      nextIdRef.current += 1;
      const entry: AgentSessionTaskStop = { id: nextIdRef.current, threadId, taskId, ...target };
      const notify = reportRef.current;
      commit([...live, entry]);
      timersRef.current.set(
        entry.id,
        setTimeout(() => {
          if (!release(entry)) return;
          publish(entry, agentSessionTaskStopTimedOutReport(entry.label), notify);
        }, AGENT_SESSION_TASK_STOP_TIMEOUT_MS),
      );
      void stop(threadId, taskId).then(
        (result) => settle(entry, result, notify),
        () => settle(entry, { kind: "unavailable" }, notify),
      );
    },
    [commit, publish, release, reportRef, settle, stopRef, threadsRef],
  );

  const stopAllTasks = useCallback(
    (threadId: string): void => {
      const view = threadsRef.current.find((candidate) => candidate.thread.threadId === threadId);
      const tasks = view?.sessionBackground?.tasks ?? [];
      for (const task of tasks) stopTask(threadId, task.taskId);
    },
    [stopTask, threadsRef],
  );

  return useMemo(
    () => ({
      pending,
      endSessionSuggestion,
      available: stopSessionBackgroundTask !== undefined,
      stopTask,
      stopAllTasks,
    }),
    [endSessionSuggestion, pending, stopAllTasks, stopSessionBackgroundTask, stopTask],
  );
}

export function agentSessionPendingTaskIds(
  pending: ReadonlyArray<AgentSessionTaskStop>,
  view: AgentThreadView,
): ReadonlySet<string> {
  const ownerId = view.thread.owner.ownerId;
  const threadId = view.thread.threadId;
  return new Set(
    pending
      .filter((entry) => entry.ownerId === ownerId && entry.threadId === threadId)
      .map((entry) => entry.taskId),
  );
}

export function agentSessionEndSuggested(
  suggestion: AgentSessionEndSuggestion | null,
  view: AgentThreadView,
): boolean {
  if (suggestion === null || !agentSessionTasksStoppable(view)) return false;
  return (
    suggestion.ownerId === view.thread.owner.ownerId && suggestion.threadId === view.thread.threadId
  );
}

export function agentSessionTasksStoppable(view: AgentThreadView | null): boolean {
  if (view === null || view.execution?.kind === "remote") return false;
  if (view.thread.provider.kind !== "claudeCode") return false;
  return (view.sessionBackground?.tasks.length ?? 0) > 0;
}

function sessionTask(
  threads: ReadonlyArray<AgentThreadView>,
  threadId: string,
  taskId: string,
): { readonly ownerId: string; readonly label: string } | null {
  const view = threads.find((candidate) => candidate.thread.threadId === threadId);
  if (view === undefined || !agentSessionTasksStoppable(view)) return null;
  const task = view.sessionBackground?.tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) return null;
  return { ownerId: view.thread.owner.ownerId, label: agentSessionTaskLabel(task) };
}

function isLiveTaskStop(
  threads: ReadonlyArray<AgentThreadView>,
  entry: AgentSessionTaskStop,
): boolean {
  const view = threads.find((candidate) => candidate.thread.threadId === entry.threadId);
  if (view === undefined || view.thread.owner.ownerId !== entry.ownerId) return false;
  return view.sessionBackground?.tasks.some((task) => task.taskId === entry.taskId) === true;
}

function sameTask(
  entry: AgentSessionTaskStop,
  ownerId: string,
  threadId: string,
  taskId: string,
): boolean {
  return entry.ownerId === ownerId && entry.threadId === threadId && entry.taskId === taskId;
}
