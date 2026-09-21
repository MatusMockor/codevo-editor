// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentHistoryActivitySource } from "../../application/useAgentHistoryActivity";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentHistoryActivity } from "./AgentHistoryActivity";

it("navigates saved activity without mutating live turn events or status", async () => {
  const turn: AgentTurn = {
    turnId: "turn",
    prompt: "prompt",
    status: { kind: "interrupted" },
    startedAtEpochMs: 1,
    endedAtEpochMs: 2,
    events: [{ kind: "assistantText", text: "live" }],
    eventsTruncated: true,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
  const readPage = vi.fn<AgentHistoryActivitySource["readPage"]>().mockResolvedValue({
    entries: [{ seq: 21, event: { kind: "assistantText", text: "saved" } }],
    firstSeq: 21,
    lastSeq: 21,
    hasEarlier: true,
    hasLater: true,
    loss: { kind: "legacyWindow" },
    clipped: true,
  });
  const source: AgentHistoryActivitySource = {
    scope: { rootKey: "/root", ownerId: "owner", threadId: "thread", turnId: "turn" },
    generation: 1,
    leaseToken: 1,
    readPage,
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  let projected: AgentTurn | null = null;
  try {
    act(() =>
      root.render(
        <AgentHistoryActivity turn={turn} source={source}>
          {(activity) => {
            projected = activity.turn;
            return (
              <>
                <button onClick={activity.open}>Open work</button>
                {activity.controls}
              </>
            );
          }}
        </AgentHistoryActivity>,
      ),
    );
    const click = async (text: string) => {
      const button = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === text,
      );
      expect(button).toBeDefined();
      await act(async () => {
        button?.click();
      });
    };
    expect(readPage).not.toHaveBeenCalled();
    await click("Open work");
    expect(projected!.firstEventOffset).toBe(20);
    expect(projected!.eventsTruncated).toBe(false);
    expect(projected!.status).toBe(turn.status);
    expect(host.textContent).toContain("Some activity is missing");
    expect(host.textContent).toContain("display limit");
    await click("Earlier activity");
    expect(readPage.mock.calls[1]?.[0].anchor).toEqual({ at: "before", seq: 21 });
    expect(host.textContent).toContain("Could not load saved activity");
    await click("Back to latest activity");
    expect(projected).toBeNull();
    expect(turn.events).toEqual([{ kind: "assistantText", text: "live" }]);
  } finally {
    act(() => root.unmount());
  }
});

it("keeps the work model stable for unchanged turns", () => {
  const turn: AgentTurn = {
    turnId: "turn",
    prompt: "prompt",
    status: { kind: "interrupted" },
    startedAtEpochMs: 1,
    endedAtEpochMs: 2,
    events: [],
    eventsTruncated: true,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
  const source: AgentHistoryActivitySource = {
    scope: { rootKey: "/root", ownerId: "owner", threadId: "thread", turnId: "turn" },
    generation: 1,
    leaseToken: 1,
    readPage: vi.fn(),
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  const models: unknown[] = [];
  const render = () =>
    act(() =>
      root.render(
        <AgentHistoryActivity turn={turn} source={{ ...source }}>
          {(activity) => {
            models.push(activity);
            return null;
          }}
        </AgentHistoryActivity>,
      ),
    );
  try {
    render();
    render();
    expect(models[1]).toBe(models[0]);
  } finally {
    act(() => root.unmount());
  }
});

it.each([
  { count: 0, offset: 0, truncated: false, available: false },
  { count: 200, offset: 0, truncated: false, available: false },
  { count: 201, offset: 0, truncated: false, available: true },
  { count: 0, offset: 3, truncated: false, available: true },
  { count: 0, offset: 0, truncated: true, available: true },
])(
  "offers lazy history only when the displayed window omits events: $count/$offset/$truncated",
  ({ count, offset, truncated, available }) => {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "prompt",
      status: { kind: "interrupted" },
      startedAtEpochMs: 1,
      endedAtEpochMs: 2,
      events: Array.from({ length: count }, () => ({
        kind: "assistantText" as const,
        text: "text",
      })),
      eventsTruncated: truncated,
      firstEventOffset: offset,
      lastStatusSequence: 1,
      lastOutputSequence: 1,
      launch: null,
      cliVersion: null,
    };
    const readPage = vi.fn();
    const source: AgentHistoryActivitySource = {
      scope: { rootKey: "/root", ownerId: "owner", threadId: "thread", turnId: "turn" },
      generation: 1,
      leaseToken: 1,
      readPage,
    };
    const root = createRoot(document.createElement("div"));
    try {
      act(() =>
        root.render(
          <AgentHistoryActivity turn={turn} source={source}>
            {(work) => {
              expect(work.available).toBe(available);
              return work.controls;
            }}
          </AgentHistoryActivity>,
        ),
      );
      expect(readPage).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  },
);
