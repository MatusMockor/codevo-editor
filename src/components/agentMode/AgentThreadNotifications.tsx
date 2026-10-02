import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  AgentThreadNotificationCenter,
  AgentThreadNotificationToast,
} from "../../application/agentThreadNotificationCenter";
import {
  agentThreadNotificationView,
  agentThreadUnavailableView,
} from "../../application/agentThreadNotificationPresenter";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteractionIdentity } from "../../domain/agentPendingInteraction";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentThreadNotificationEvent } from "../../domain/agentNotification";
import { useAutoDismiss } from "../../ui/foundation/useAutoDismiss";
import { ToastNotification, type ToastNotificationAction } from "../ToastNotification";
import { useToastStackPortalTarget } from "../toastStackPortal";
import {
  agentThreadNotificationOwnerKey,
  useAgentThreadNotificationSubjects,
} from "./agentThreadNotificationSubjects";

export const MAX_VISIBLE_AGENT_THREAD_NOTIFICATIONS = 2;
export const AGENT_THREAD_NOTIFICATION_TOAST_MS = 8_000;

export interface AgentThreadNotificationsProps {
  readonly center: AgentThreadNotificationCenter;
  readonly views: ReadonlyArray<AgentThreadView>;
  readonly interactions: ReadonlyMap<string, AgentPendingInteractionIdentity | null>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly visibleThreadId: string | null;
  readonly toastsVisible?: boolean;
  onSelectThread(threadId: string): void;
}

export function AgentThreadNotifications({
  center,
  views,
  interactions,
  projects,
  visibleThreadId,
  toastsVisible = true,
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

  return <AgentThreadNotificationToasts center={center} onOpen={open} visible={toastsVisible} />;
}

function AgentThreadNotificationToasts({
  center,
  onOpen,
  visible,
}: {
  readonly center: AgentThreadNotificationCenter;
  readonly visible: boolean;
  onOpen(event: AgentThreadNotificationEvent): void;
}) {
  const toasts = useSyncExternalStore(center.subscribe, center.toasts);
  const target = useToastStackPortalTarget();
  if (!visible || toasts.length === 0) return null;
  const shown = toasts.slice(-MAX_VISIBLE_AGENT_THREAD_NOTIFICATIONS).reverse();
  const region = (
    <div
      aria-label="Agent thread notifications"
      className={
        shown.length > 1
          ? "toast-region toast-region--agent-threads toast-region--stacked"
          : "toast-region toast-region--agent-threads"
      }
      role="region"
    >
      {shown.map((toast, index) => (
        <AgentThreadNotificationCard
          behind={index > 0}
          key={`${index > 0 ? "behind" : "front"}:${toast.id}`}
          onDismiss={() => center.dismiss(toast.id)}
          onOpen={() => {
            const event = center.take(toast.id);
            if (event !== null) onOpen(event);
          }}
          toast={toast}
        />
      ))}
    </div>
  );
  return target === null ? region : createPortal(region, target);
}

function AgentThreadNotificationCard({
  behind,
  onDismiss,
  onOpen,
  toast,
}: {
  readonly behind: boolean;
  readonly toast: AgentThreadNotificationToast;
  onDismiss(): void;
  onOpen(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useAutoDismiss(AGENT_THREAD_NOTIFICATION_TOAST_MS, behind || hovered || focused, onDismiss);
  const active = toast.status === "active";
  const view = active
    ? agentThreadNotificationView(toast.event)
    : agentThreadUnavailableView(toast.event);
  const actions: ToastNotificationAction[] = active
    ? [{ id: "open", label: "Open", onClick: onOpen, tone: "primary" }]
    : [];
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };
  return (
    <div
      aria-hidden={behind || undefined}
      className={
        behind
          ? "toast-region__slot toast-region__slot--behind"
          : "toast-region__slot toast-region__slot--front"
      }
      inert={behind || undefined}
      onBlur={handleBlur}
      onFocus={() => setFocused(true)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <ToastNotification
        actions={actions}
        className="agent-thread-toast"
        description={view.description}
        meta={view.project === null ? undefined : [view.project]}
        onClose={onDismiss}
        template={view.tone}
        title={view.title}
      />
    </div>
  );
}

function sameItems(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}
