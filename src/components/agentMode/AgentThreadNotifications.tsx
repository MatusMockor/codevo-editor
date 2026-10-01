import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AgentThreadNotificationCenter } from "../../application/agentThreadNotificationCenter";
import {
  agentThreadNotificationCopy,
  agentThreadUnavailableCopy,
} from "../../application/agentThreadNotificationPresenter";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteractionIdentity } from "../../domain/agentPendingInteraction";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentThreadNotificationEvent } from "../../domain/agentNotification";
import { Toast, ToastViewport } from "../../ui/foundation/Toast";
import { useWorkbenchFramePortalTarget } from "../workbenchFramePortal";
import {
  agentThreadNotificationOwnerKey,
  useAgentThreadNotificationSubjects,
} from "./agentThreadNotificationSubjects";

export const MAX_VISIBLE_AGENT_THREAD_NOTIFICATIONS = 3;
export const AGENT_THREAD_NOTIFICATION_TOAST_MS = 8_000;

export interface AgentThreadNotificationsProps {
  readonly center: AgentThreadNotificationCenter;
  readonly views: ReadonlyArray<AgentThreadView>;
  readonly interactions: ReadonlyMap<string, AgentPendingInteractionIdentity | null>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly visibleThreadId: string | null;
  onSelectThread(threadId: string): void;
}

export function AgentThreadNotifications({
  center,
  views,
  interactions,
  projects,
  visibleThreadId,
  onSelectThread,
}: AgentThreadNotificationsProps) {
  const subjects = useAgentThreadNotificationSubjects(views, interactions, projects);
  const observed = useRef<{
    readonly subjects: ReadonlyArray<unknown>;
    readonly visibleThreadId: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    const previous = observed.current;
    if (
      previous !== null &&
      previous.visibleThreadId === visibleThreadId &&
      sameItems(previous.subjects, subjects)
    ) {
      return;
    }
    observed.current = { subjects, visibleThreadId };
    center.observe(subjects, visibleThreadId);
  }, [center, subjects, visibleThreadId]);

  const latest = useRef({ views, projects });
  latest.current = { views, projects };
  const open = useCallback(
    (event: AgentThreadNotificationEvent) => {
      const view = latest.current.views.find(
        (candidate) => candidate.thread.threadId === event.threadId,
      );
      if (
        view === undefined ||
        view.thread.archived ||
        agentThreadNotificationOwnerKey(view, latest.current.projects) !== event.ownerKey
      ) {
        center.reportUnavailable(event);
        return;
      }
      onSelectThread(event.threadId);
    },
    [center, onSelectThread],
  );

  return <AgentThreadNotificationToasts center={center} onOpen={open} />;
}

function AgentThreadNotificationToasts({
  center,
  onOpen,
}: {
  readonly center: AgentThreadNotificationCenter;
  onOpen(event: AgentThreadNotificationEvent): void;
}) {
  const toasts = useSyncExternalStore(center.subscribe, center.toasts);
  const target = useWorkbenchFramePortalTarget();
  if (toasts.length === 0) return null;
  const visible = toasts.slice(-MAX_VISIBLE_AGENT_THREAD_NOTIFICATIONS);
  return createPortal(
    <ToastViewport>
      {visible.map((toast) => {
        const active = toast.status === "active";
        const copy = active
          ? agentThreadNotificationCopy(toast.event)
          : agentThreadUnavailableCopy(toast.event);
        return (
          <Toast
            action={
              active
                ? {
                    label: "Open",
                    onSelect: () => {
                      const event = center.take(toast.id);
                      if (event !== null) onOpen(event);
                    },
                  }
                : undefined
            }
            durationMs={AGENT_THREAD_NOTIFICATION_TOAST_MS}
            key={toast.id}
            message={copy.message}
            onDismiss={() => center.dismiss(toast.id)}
            tone={copy.tone}
          />
        );
      })}
    </ToastViewport>,
    target,
  );
}

function sameItems(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}
