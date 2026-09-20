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
  let projected = turn;
  try {
    act(() =>
      root.render(
        <AgentHistoryActivity turn={turn} source={source}>
          {(view, saved) => {
            projected = view;
            return <p>{saved ? "saved-view" : "live-view"}</p>;
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
    await click("Saved activity");
    expect(projected.firstEventOffset).toBe(20);
    expect(projected.eventsTruncated).toBe(false);
    expect(projected.status).toBe(turn.status);
    expect(host.textContent).toContain("Some activity is missing");
    expect(host.textContent).toContain("display limit");
    await click("Earlier activity");
    expect(readPage.mock.calls[1]?.[0].anchor).toEqual({ at: "before", seq: 21 });
    expect(host.textContent).toContain("Could not load saved activity");
    await click("Back to latest activity");
    expect(projected).toBe(turn);
    expect(turn.events).toEqual([{ kind: "assistantText", text: "live" }]);
  } finally {
    act(() => root.unmount());
  }
});
