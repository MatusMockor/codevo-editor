// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import { CLAUDE_COMPACTION_IDLE_MS } from "../domain/agentContextCompaction";
import { useAgentResumeCompactionOffer } from "./useAgentResumeCompactionOffer";

const endedAt = 2_000_000_000_000;
const thread = logThread({
  provider: { kind: "claudeCode", sessionId: "session" },
  turns: [
    logTurn({
      status: { kind: "exited", exitCode: 0 },
      endedAtEpochMs: endedAt,
      events: [
        { kind: "contextUsage", model: "sonnet", inputTokens: 120_000, contextWindow: 200_000 },
      ],
    }),
  ],
});
afterEach(() => vi.useRealTimers());
it("offers after idle threshold without another provider event and cleans its timer", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(endedAt + CLAUDE_COMPACTION_IDLE_MS - 60_000);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe({ enabled = true }: { enabled?: boolean }) {
    const offer = useAgentResumeCompactionOffer(enabled ? thread : null, null);
    return <output>{offer?.contextTokens ?? "none"}</output>;
  }
  try {
    act(() => root.render(<Probe />));
    expect(host.textContent).toBe("none");
    act(() => vi.advanceTimersByTime(60_000));
    expect(host.textContent).toBe("120000");
    act(() => root.render(<Probe enabled={false} />));
    expect(host.textContent).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
    act(() => root.render(<Probe />));
    expect(vi.getTimerCount()).toBe(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
  expect(vi.getTimerCount()).toBe(0);
});
