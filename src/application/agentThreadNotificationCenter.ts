import {
  agentThreadNotificationStillCurrent,
  detectAgentThreadNotifications,
  type AgentThreadNotificationBaseline,
  type AgentThreadNotificationEvent,
  type AgentThreadNotificationSubject,
} from "../domain/agentNotification";
import { agentThreadSystemNotification } from "./agentThreadNotificationPresenter";

export interface AgentAppFocusPort {
  isFocused(): boolean;
  subscribe(listener: (focused: boolean) => void): () => void;
}

export interface AgentSystemNotification {
  readonly title: string;
  readonly body: string;
}

export type AgentSystemNotificationOutcome = "delivered" | "unavailable";

export interface AgentSystemAttentionPort {
  notify(notification: AgentSystemNotification): Promise<AgentSystemNotificationOutcome>;
  setBadgeCount(count: number): Promise<void>;
  recheckPermission(): void;
}

export type AgentThreadNotificationToastStatus = "active" | "unavailable";

export interface AgentThreadNotificationToast {
  readonly id: string;
  readonly status: AgentThreadNotificationToastStatus;
  readonly event: AgentThreadNotificationEvent;
}

export interface AgentThreadNotificationPresentation {
  readonly toastsVisible: boolean;
  readonly threadViewVisible: boolean;
}

export interface AgentThreadNotificationCenter {
  start(): () => void;
  setEnabled(enabled: boolean): void;
  setPresentation(presentation: AgentThreadNotificationPresentation): void;
  flush(): void;
  observe(
    subjects: ReadonlyArray<AgentThreadNotificationSubject>,
    visibleThreadId: string | null,
  ): void;
  toasts(): ReadonlyArray<AgentThreadNotificationToast>;
  subscribe(listener: () => void): () => void;
  dismiss(id: string): void;
  take(id: string): AgentThreadNotificationEvent | null;
  reportUnavailable(event: AgentThreadNotificationEvent): void;
}

export interface AgentThreadNotificationCenterPorts {
  readonly focus: AgentAppFocusPort;
  readonly system: AgentSystemAttentionPort;
  readonly now?: () => number;
}

export const MAX_AGENT_THREAD_NOTIFICATION_TOASTS = 8;
export const AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS = 10_000;
const MAX_RECENT_EVENT_KEYS = 256;
const NO_TOASTS: ReadonlyArray<AgentThreadNotificationToast> = Object.freeze([]);

export function createAgentThreadNotificationCenter({
  focus,
  system,
  now = Date.now,
}: AgentThreadNotificationCenterPorts): AgentThreadNotificationCenter {
  const listeners = new Set<() => void>();
  const recent = new Map<string, number>();
  const badgedThreads = new Set<string>();
  let baseline: AgentThreadNotificationBaseline = new Map();
  let toasts: ReadonlyArray<AgentThreadNotificationToast> = NO_TOASTS;
  let deferred: ReadonlyArray<AgentThreadNotificationEvent> = [];
  let visibleThreadId: string | null = null;
  let presentation: AgentThreadNotificationPresentation = {
    toastsVisible: true,
    threadViewVisible: true,
  };
  let enabled = true;
  let sequence = 0;

  const lookedAtThreadId = (): string | null =>
    presentation.threadViewVisible ? visibleThreadId : null;
  const current = (event: AgentThreadNotificationEvent): boolean =>
    agentThreadNotificationStillCurrent(baseline, event);

  const publish = (next: ReadonlyArray<AgentThreadNotificationToast>): void => {
    if (next === toasts) return;
    toasts = next.length === 0 ? NO_TOASTS : next;
    for (const listener of [...listeners]) listener();
  };

  const setBadge = (count: number): void => {
    void system.setBadgeCount(count).catch(() => undefined);
  };

  const clearBadge = (): void => {
    if (badgedThreads.size === 0) return;
    badgedThreads.clear();
    setBadge(0);
  };

  const enqueue = (
    events: ReadonlyArray<AgentThreadNotificationEvent>,
    status: AgentThreadNotificationToastStatus = "active",
  ): void => {
    if (events.length === 0) return;
    let next = [...toasts];
    for (const event of events) {
      next = next.filter((toast) => toast.event.threadId !== event.threadId);
      sequence += 1;
      next.push({ id: `agent-thread-notification:${sequence}`, status, event });
    }
    publish(next.slice(-MAX_AGENT_THREAD_NOTIFICATION_TOASTS));
  };

  const debounced = (event: AgentThreadNotificationEvent): boolean => {
    const at = now();
    const last = recent.get(event.key);
    if (last !== undefined && at - last < AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS) return true;
    recent.delete(event.key);
    recent.set(event.key, at);
    while (recent.size > MAX_RECENT_EVENT_KEYS) {
      const oldest = recent.keys().next().value;
      if (oldest === undefined) break;
      recent.delete(oldest);
    }
    return false;
  };

  const defer = (event: AgentThreadNotificationEvent): void => {
    deferred = [...deferred.filter((entry) => entry.threadId !== event.threadId), event].slice(
      -MAX_AGENT_THREAD_NOTIFICATION_TOASTS,
    );
  };

  const notifySystem = (event: AgentThreadNotificationEvent): void => {
    defer(event);
    if (!badgedThreads.has(event.threadId)) {
      badgedThreads.add(event.threadId);
      setBadge(badgedThreads.size);
    }
    void system.notify(agentThreadSystemNotification(event)).catch(() => "unavailable" as const);
  };

  const route = (event: AgentThreadNotificationEvent): void => {
    const focused = focus.isFocused();
    if (focused && event.threadId === lookedAtThreadId()) return;
    if (debounced(event)) return;
    if (!focused) {
      notifySystem(event);
      return;
    }
    if (!presentation.toastsVisible) {
      defer(event);
      return;
    }
    enqueue([event]);
  };

  const flushDeferred = (): void => {
    if (!enabled || !presentation.toastsVisible || !focus.isFocused()) return;
    const looking = lookedAtThreadId();
    const pending = deferred.filter((event) => event.threadId !== looking && current(event));
    deferred = [];
    enqueue(pending);
  };

  const pruneStale = (): void => {
    deferred = deferred.filter(current);
    const waiting = new Set(deferred.map((event) => event.threadId));
    const badged = badgedThreads.size;
    for (const threadId of [...badgedThreads]) {
      if (!waiting.has(threadId)) badgedThreads.delete(threadId);
    }
    if (badgedThreads.size !== badged) setBadge(badgedThreads.size);
    const fresh = toasts.filter((toast) => toast.status === "unavailable" || current(toast.event));
    if (fresh.length !== toasts.length) publish(fresh);
  };

  const onFocusChange = (focused: boolean): void => {
    if (!focused) return;
    system.recheckPermission();
    clearBadge();
    flushDeferred();
  };

  return {
    start() {
      setBadge(0);
      const unsubscribe = focus.subscribe(onFocusChange);
      return () => {
        unsubscribe();
        deferred = [];
        clearBadge();
      };
    },
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (next) return;
      deferred = [];
      clearBadge();
      publish(NO_TOASTS);
    },
    setPresentation(next) {
      presentation = next;
    },
    flush: flushDeferred,
    observe(subjects, visible) {
      visibleThreadId = visible;
      const detection = detectAgentThreadNotifications(baseline, subjects);
      baseline = detection.baseline;
      pruneStale();
      if (!enabled) return;
      for (const event of detection.events) route(event);
    },
    toasts: () => toasts,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismiss(id) {
      publish(toasts.filter((toast) => toast.id !== id));
    },
    take(id) {
      const toast = toasts.find((candidate) => candidate.id === id);
      if (toast === undefined || toast.status !== "active") return null;
      publish(toasts.filter((candidate) => candidate.id !== id));
      if (current(toast.event)) return toast.event;
      enqueue([toast.event], "unavailable");
      return null;
    },
    reportUnavailable(event) {
      enqueue([event], "unavailable");
    },
  };
}
