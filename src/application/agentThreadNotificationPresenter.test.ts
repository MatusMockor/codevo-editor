import { describe, expect, it } from "vitest";
import type { AgentThreadNotificationEvent } from "../domain/agentNotification";
import {
  MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS,
  agentThreadNotificationCopy,
  agentThreadSystemNotification,
  agentThreadUnavailableCopy,
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

describe("agent thread notification copy", () => {
  it("names the thread, the outcome and the project", () => {
    expect(agentThreadNotificationCopy(event())).toEqual({
      message: "Fix parser finished in api",
      tone: "success",
    });
    expect(agentThreadNotificationCopy(event({ kind: "failed" }))).toEqual({
      message: "Fix parser failed in api",
      tone: "error",
    });
    expect(agentThreadNotificationCopy(event({ kind: "approval" })).message).toBe(
      "Fix parser needs your approval in api",
    );
    expect(agentThreadNotificationCopy(event({ kind: "input" })).message).toBe(
      "Fix parser needs your input in api",
    );
  });

  it("collapses whitespace, bounds long titles and falls back for empty ones", () => {
    const long = agentThreadNotificationCopy(event({ title: `a\n${"b".repeat(300)}` })).message;
    expect(long.startsWith("a b")).toBe(true);
    expect(Array.from(long.split(" finished")[0] ?? "").length).toBe(
      MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS,
    );
    expect(agentThreadNotificationCopy(event({ title: "  ", projectLabel: "" })).message).toBe(
      "Untitled thread finished",
    );
  });

  it("builds a system notification with a kind title and thread body", () => {
    expect(agentThreadSystemNotification(event({ kind: "input" }))).toEqual({
      title: "Input needed",
      body: "Fix parser · api",
    });
  });

  it("explains that a thread can no longer be opened", () => {
    expect(agentThreadUnavailableCopy(event())).toEqual({
      message: "Fix parser is no longer available",
      tone: "info",
    });
  });
});
