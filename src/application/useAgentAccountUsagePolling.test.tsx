// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";
import { useAgentAccountUsagePolling } from "./useAgentAccountUsagePolling";

describe("idle local account polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterEach(() => vi.useRealTimers());
  it("polls ready providers without local turns, coalesces a pending cycle and clears timers on disposal", async () => {
    const root = createRoot(document.createElement("div"));
    let resolve!: (outcome: AgentAccountUsageRefreshOutcome) => void;
    const refresh = vi.fn().mockImplementation(
      () =>
        new Promise((settle) => {
          resolve = settle;
        }),
    );
    function Harness() {
      useAgentAccountUsagePolling({ claudeCode: false, codex: true }, refresh);
      return null;
    }
    act(() => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledExactlyOnceWith("codex");
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    await act(async () => {
      resolve({ kind: "refreshed" });
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
