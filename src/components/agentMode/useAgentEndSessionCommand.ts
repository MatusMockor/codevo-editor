import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionBackgroundInspection,
  AgentSessionEndResult,
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import { agentSessionTaskLabel } from "./conversation/agentSessionTaskControls";

const MAX_AGENT_SESSION_TASK_ROWS = 3;

export function claudeSessionEndedNotice(title: string): AgentTasksNotice {
  return { kind: "info", message: `Ended Claude's session for "${title}".`, action: null };
}

export function noClaudeSessionNotice(title: string): AgentTasksNotice {
  return {
    kind: "info",
    message: `"${title}" has no running Claude session, so there was nothing to end.`,
    action: null,
  };
}

export function claudeSessionEndFailedNotice(title: string): AgentTasksNotice {
  return { kind: "error", message: `Could not end Claude's session for "${title}".`, action: null };
}

export type AgentEndSessionBackground = Exclude<AgentSessionBackgroundInspection, "none">;

export interface AgentEndSessionLiveTasks {
  readonly labels: ReadonlyArray<string>;
  readonly hidden: number;
}

export interface AgentEndSessionConfirmationView {
  readonly threadId: string;
  readonly title: string;
  readonly background: AgentEndSessionBackground;
  readonly liveTasks?: AgentEndSessionLiveTasks;
  onConfirm(): void;
  onCancel(): void;
}

export type AgentEndSessionSurface = Pick<
  AgentThreadsSurface,
  "threads" | "endSession" | "inspectSessionBackground"
>;

export interface AgentEndSessionCommand {
  readonly confirmation: AgentEndSessionConfirmationView | null;
  request(threadId: string): void;
}

interface PendingEndSession {
  readonly threadId: string;
  readonly background: AgentEndSessionBackground;
}

export function useAgentEndSessionCommand(
  agents: AgentEndSessionSurface,
  reportNotice: (notice: AgentTasksNotice) => void,
): AgentEndSessionCommand {
  const { endSession, inspectSessionBackground, threads } = agents;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const threadsRef = useRef(threads);
  const [pending, setPending] = useState<PendingEndSession | null>(null);
  useLayoutEffect(() => {
    threadsRef.current = threads;
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const target = pending === null ? null : endSessionTarget(threads, pending.threadId);
  if (pending !== null && target === null) setPending(null);

  const end = useCallback(
    async (threadId: string, requestedTitle: string): Promise<void> => {
      if (endSession === undefined) return;
      const result = await endSession(threadId);
      if (!mountedRef.current) return;
      const title = threadTitle(threadsRef.current, threadId) ?? requestedTitle;
      reportNotice(endSessionNotice(result, title));
    },
    [endSession, reportNotice],
  );

  const request = useCallback(
    (threadId: string): void => {
      if (endSession === undefined) return;
      const requestedTitle = threadTitle(threadsRef.current, threadId);
      if (requestedTitle === null) return;
      requestRef.current += 1;
      const requestId = requestRef.current;
      setPending(null);
      const inspection =
        inspectSessionBackground?.(threadId) ??
        Promise.resolve<AgentSessionBackgroundInspection>("none");
      const settle = (background: AgentSessionBackgroundInspection): void => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        if (background === "none") {
          void end(threadId, threadTitle(threadsRef.current, threadId) ?? requestedTitle);
          return;
        }
        setPending({ threadId, background });
      };
      void inspection.then(settle, () => settle("unknown"));
    },
    [end, endSession, inspectSessionBackground],
  );

  const cancel = useCallback((): void => {
    requestRef.current += 1;
    setPending(null);
  }, []);

  const confirmation = useMemo((): AgentEndSessionConfirmationView | null => {
    if (pending === null || target === null) return null;
    const liveTasks = endSessionLiveTasks(target.sessionBackground);
    return {
      threadId: pending.threadId,
      title: target.thread.title,
      background: pending.background,
      ...(liveTasks === null ? {} : { liveTasks }),
      onConfirm: () => {
        cancel();
        void end(pending.threadId, target.thread.title);
      },
      onCancel: cancel,
    };
  }, [cancel, end, pending, target]);

  return { confirmation, request };
}

function endSessionTarget(
  threads: ReadonlyArray<AgentThreadView>,
  threadId: string,
): AgentThreadView | null {
  const view = threads.find((candidate) => candidate.thread.threadId === threadId);
  if (view === undefined) return null;
  if (view.lifecycle === "running" || view.thread.archived) return null;
  return view;
}

function endSessionLiveTasks(
  session: AgentSessionBackground | undefined,
): AgentEndSessionLiveTasks | null {
  if (session === undefined || session.tasks.length === 0) return null;
  const labels = session.tasks.slice(0, MAX_AGENT_SESSION_TASK_ROWS).map(agentSessionTaskLabel);
  return { labels, hidden: Math.max(session.total, session.tasks.length) - labels.length };
}

function threadTitle(threads: ReadonlyArray<AgentThreadView>, threadId: string): string | null {
  const view = threads.find((candidate) => candidate.thread.threadId === threadId);
  return view?.thread.title ?? null;
}

function endSessionNotice(result: AgentSessionEndResult, title: string): AgentTasksNotice {
  switch (result) {
    case "ended":
      return claudeSessionEndedNotice(title);
    case "none":
      return noClaudeSessionNotice(title);
    case "failed":
      return claudeSessionEndFailedNotice(title);
    default:
      return unsupportedEndSessionResult(result);
  }
}

function unsupportedEndSessionResult(result: never): never {
  throw new TypeError(`Unsupported end session result: ${String(result)}.`);
}
