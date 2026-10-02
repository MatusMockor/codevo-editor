import { describe, expect, it } from "vitest";
import type { AgentThreadNotificationEvent } from "../domain/agentNotification";
import {
  MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS,
  agentThreadNotificationView,
  agentThreadSystemNotification,
  agentThreadUnavailableView,
} from "./agentThreadNotificationPresenter";

function event(
  overrides: Partial<AgentThreadNotificationEvent> = {},
): AgentThreadNotificationEvent {
  return {
    threadId: "t1",
    ownerKey: "owner",
    title: "Fix parser",
    projectLabel: "api",
    kind: "completed",
    signalKey: "u1:completed",
    key: "k",
    ...overrides,
  };
}

describe("agent thread notification view", () => {
  it("headlines the outcome and keeps the thread and project apart", () => {
    expect(agentThreadNotificationView(event())).toEqual({
      title: "Thread finished",
      description: "Fix parser",
      project: "api",
      tone: "success",
    });
    expect(agentThreadNotificationView(event({ kind: "failed" }))).toEqual({
      title: "Thread failed",
      description: "Fix parser",
      project: "api",
      tone: "error",
    });
    expect(agentThreadNotificationView(event({ kind: "approval" }))).toEqual({
      title: "Approval needed",
      description: "Fix parser",
      project: "api",
      tone: "info",
    });
    expect(agentThreadNotificationView(event({ kind: "input" }))).toEqual({
      title: "Input needed",
      description: "Fix parser",
      project: "api",
      tone: "info",
    });
  });

  it("omits the project when its label is blank", () => {
    expect(agentThreadNotificationView(event({ projectLabel: " \n " })).project).toBeNull();
  });

  it("collapses whitespace, bounds long titles and falls back for empty ones", () => {
    const long = agentThreadNotificationView(event({ title: `a\n${"b".repeat(300)}` }));
    expect(long.description.startsWith("a b")).toBe(true);
    expect(long.description.endsWith("…")).toBe(true);
    expect(Array.from(long.description)).toHaveLength(MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS);
    expect(agentThreadNotificationView(event({ title: "  " })).description).toBe("Untitled thread");
  });

  it("builds a system notification with a kind title and thread body", () => {
    expect(agentThreadSystemNotification(event({ kind: "input" }))).toEqual({
      title: "Input needed",
      body: "Fix parser · api",
    });
    expect(agentThreadSystemNotification(event({ projectLabel: "" }))).toEqual({
      title: "Thread finished",
      body: "Fix parser",
    });
  });

  it("explains that a thread can no longer be opened", () => {
    expect(agentThreadUnavailableView(event({ kind: "failed" }))).toEqual({
      title: "Thread unavailable",
      description: "Fix parser",
      project: "api",
      tone: "info",
    });
  });
});
