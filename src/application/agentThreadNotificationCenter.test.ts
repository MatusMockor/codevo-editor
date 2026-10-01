import { describe, expect, it } from "vitest";
import type {
  AgentThreadNotificationSignal,
  AgentThreadNotificationSubject,
} from "../domain/agentNotification";
import {
  AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS,
  MAX_AGENT_THREAD_NOTIFICATION_TOASTS,
  createAgentThreadNotificationCenter,
  type AgentAppFocusPort,
  type AgentSystemAttentionPort,
  type AgentSystemNotification,
} from "./agentThreadNotificationCenter";

class FakeFocus implements AgentAppFocusPort {
  private listeners = new Set<(focused: boolean) => void>();
  constructor(public focused = true) {}
  isFocused(): boolean {
    return this.focused;
  }
  subscribe(listener: (focused: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(focused: boolean): void {
    this.focused = focused;
    for (const listener of this.listeners) listener(focused);
  }
}

class FakeSystem implements AgentSystemAttentionPort {
  readonly notifications: AgentSystemNotification[] = [];
  readonly badges: number[] = [];
  async notify(notification: AgentSystemNotification) {
    this.notifications.push(notification);
    return "delivered" as const;
  }
  async setBadgeCount(count: number): Promise<void> {
    this.badges.push(count);
  }
  rechecks = 0;
  recheckPermission(): void {
    this.rechecks += 1;
  }
}

function subject(
  threadId: string,
  signal: AgentThreadNotificationSignal | null,
  ownerKey = "owner-a",
): AgentThreadNotificationSubject {
  return {
    threadId,
    ownerKey,
    whenMissing: "forget",
    title: `Thread ${threadId}`,
    projectLabel: "api",
    state: signal === null ? { kind: "quiet" } : { kind: "signal", signal },
  };
}

const DONE = { kind: "completed", key: "u1:completed" } as const;
const APPROVAL = { kind: "approval", key: "approval:req-1" } as const;

function setup(focused = true) {
  const focus = new FakeFocus(focused);
  const system = new FakeSystem();
  let now = 1_000;
  const center = createAgentThreadNotificationCenter({ focus, system, now: () => now });
  const stop = center.start();
  return {
    focus,
    system,
    center,
    stop,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("agent thread notification center", () => {
  it("toasts a non-visible thread that finishes while the window is focused", () => {
    const { center, system } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");

    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["b1"]);
    expect(center.toasts()[0]?.event.kind).toBe("completed");
    expect(system.notifications).toEqual([]);
  });

  it("stays quiet for the thread the user is looking at", () => {
    const { center, system } = setup();
    center.observe([subject("a1", null)], "a1");
    center.observe([subject("a1", DONE)], "a1");

    expect(center.toasts()).toEqual([]);
    expect(system.notifications).toEqual([]);
  });

  it("sends a system notification and badges the dock while unfocused", () => {
    const { center, system } = setup(false);
    center.observe([subject("a1", null), subject("b1", null)], "a1");
    center.observe([subject("a1", DONE), subject("b1", APPROVAL)], "a1");

    expect(system.notifications.map((entry) => entry.title)).toEqual([
      "Thread finished",
      "Approval needed",
    ]);
    expect(system.notifications[0]?.body).toBe("Thread a1 · api");
    expect(system.badges[system.badges.length - 1]).toBe(2);
    expect(center.toasts()).toEqual([]);
  });

  it("clears the badge and surfaces deferred toasts when the window regains focus", () => {
    const { center, focus, system } = setup(false);
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    focus.set(true);

    expect(system.badges[system.badges.length - 1]).toBe(0);
    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["b1"]);
  });

  it("does nothing while disabled and drops pending work when switched off", () => {
    const { center, system } = setup(false);
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    center.setEnabled(false);

    expect(center.toasts()).toEqual([]);
    expect(system.badges[system.badges.length - 1]).toBe(0);

    center.observe([subject("b1", { kind: "failed", key: "u2:failed" })], "a1");
    expect(system.notifications).toHaveLength(1);
    expect(center.toasts()).toEqual([]);
  });

  it("debounces a signal that flickers back within the window", () => {
    const { center, advance } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", APPROVAL)], "a1");
    center.dismiss(center.toasts()[0]?.id ?? "");
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", APPROVAL)], "a1");
    expect(center.toasts()).toEqual([]);

    advance(AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS + 1);
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", APPROVAL)], "a1");
    expect(center.toasts()).toHaveLength(1);
  });

  it("does not let a suppressed event for the visible thread consume the debounce window", () => {
    const { center } = setup();
    center.observe([subject("a1", null)], "a1");
    center.observe([subject("a1", APPROVAL)], "a1");
    expect(center.toasts()).toEqual([]);

    center.observe([subject("a1", null)], "b1");
    center.observe([subject("a1", APPROVAL)], "b1");
    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["a1"]);
  });

  it("treats the selected thread as not visible while its thread view is not shown", () => {
    const { center } = setup();
    center.observe([subject("a1", null)], "a1");
    center.setPresentation({ toastsVisible: true, threadViewVisible: false });
    center.observe([subject("a1", DONE)], "a1");

    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["a1"]);
  });

  it("holds events while toasts cannot be seen and shows them once they can", () => {
    const { center, system } = setup();
    center.observe([subject("a1", null), subject("b1", null)], "a1");
    center.setPresentation({ toastsVisible: false, threadViewVisible: false });
    center.observe([subject("a1", DONE), subject("b1", DONE)], "a1");

    expect(center.toasts()).toEqual([]);
    expect(system.notifications).toEqual([]);

    center.setPresentation({ toastsVisible: true, threadViewVisible: true });
    center.flush();
    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["b1"]);
  });

  it("drops held events that are no longer current when they are flushed", () => {
    const { center, focus } = setup(false);
    center.observe(
      [subject("a1", null), subject("b1", null), subject("c1", null), subject("d1", null)],
      null,
    );
    center.observe(
      [subject("a1", APPROVAL), subject("b1", DONE), subject("c1", DONE), subject("d1", APPROVAL)],
      null,
    );
    center.observe(
      [subject("a1", null), subject("c1", DONE, "owner-b"), subject("d1", APPROVAL)],
      null,
    );
    focus.set(true);

    expect(center.toasts().map((toast) => toast.event.threadId)).toEqual(["d1"]);
  });

  it("keeps the Dock badge to threads that still have something to show", () => {
    const { center, system } = setup(false);
    center.observe([subject("a1", null), subject("b1", null)], null);
    center.observe([subject("a1", APPROVAL), subject("b1", DONE)], null);
    expect(system.badges[system.badges.length - 1]).toBe(2);

    center.observe([subject("a1", null), subject("b1", DONE)], null);
    expect(system.badges[system.badges.length - 1]).toBe(1);
  });

  it("keeps a finished toast when the thread starts its next turn", () => {
    const { center } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    center.observe([subject("b1", null)], "a1");

    expect(center.toasts().map((toast) => toast.event.kind)).toEqual(["completed"]);
  });

  it("removes a toast whose request was answered elsewhere", () => {
    const { center } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", APPROVAL)], "a1");
    expect(center.toasts()).toHaveLength(1);

    center.observe([subject("b1", null)], "a1");
    expect(center.toasts()).toEqual([]);
  });

  it("says a thread is no longer available instead of opening it", () => {
    const { center } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    const id = center.toasts()[0]?.id ?? "";
    const event = center.toasts()[0]?.event;
    expect(event).toBeDefined();
    if (event === undefined) return;

    center.reportUnavailable(event);
    expect(center.take(id)).toBeNull();
    expect(center.toasts().map((toast) => toast.status)).toEqual(["unavailable"]);
  });

  it("clears a stale Dock badge on start and rechecks permission on focus", () => {
    const { focus, system } = setup(false);
    expect(system.badges).toEqual([0]);

    focus.set(true);
    expect(system.rechecks).toBe(1);
  });

  it("keeps one toast per thread and bounds the queue", () => {
    const { center } = setup();
    const ids = Array.from(
      { length: MAX_AGENT_THREAD_NOTIFICATION_TOASTS + 3 },
      (_, index) => `t${index}`,
    );
    center.observe(
      ids.map((id) => subject(id, null)),
      null,
    );
    center.observe(
      ids.map((id) => subject(id, APPROVAL)),
      null,
    );
    center.observe(
      ids.map((id) => subject(id, DONE)),
      null,
    );

    const toasts = center.toasts();
    expect(toasts).toHaveLength(MAX_AGENT_THREAD_NOTIFICATION_TOASTS);
    expect(new Set(toasts.map((toast) => toast.event.threadId)).size).toBe(toasts.length);
    expect(toasts.every((toast) => toast.event.kind === "completed")).toBe(true);
    expect(toasts[toasts.length - 1]?.event.threadId).toBe(ids[ids.length - 1]);
  });

  it("hands out a toast exactly once when opened", () => {
    const { center } = setup();
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    const id = center.toasts()[0]?.id ?? "";

    expect(center.take(id)?.threadId).toBe("b1");
    expect(center.take(id)).toBeNull();
    expect(center.toasts()).toEqual([]);
  });

  it("stops reacting to focus changes after it is stopped", () => {
    const { center, focus, stop, system } = setup(false);
    center.observe([subject("b1", null)], "a1");
    center.observe([subject("b1", DONE)], "a1");
    stop();
    const badges = system.badges.length;
    focus.set(true);

    expect(system.badges).toHaveLength(badges);
  });
});
