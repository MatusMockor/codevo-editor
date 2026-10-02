// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageSnapshot,
} from "../domain/agentAccountUsage";
import { RESET_REFRESH_GRACE_MS } from "../domain/agentAccountUsageFreshness";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";
import { useAgentAccountUsageFreshness } from "./useAgentAccountUsageFreshness";

type Provider = "claudeCode" | "codex";
type Usage = Readonly<Record<Provider, AgentAccountUsageLoadState>>;

const NOW = Date.UTC(2026, 9, 2, 8, 21);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function snapshot(fetchedAtEpochMs: number, resetsAtEpochMs: number): AgentAccountUsageSnapshot {
  return {
    provider: "claudeCode",
    fetchedAtEpochMs,
    windows: [
      {
        id: "five_hour",
        label: "5-hour limit",
        usedPercent: 3,
        windowDurationMinutes: 300,
        resetsAtEpochMs,
        resetsLabel: null,
      },
    ],
  };
}

function usageOf(claude: AgentAccountUsageSnapshot): Usage {
  return { claudeCode: { kind: "ready", snapshot: claude }, codex: { kind: "idle" } };
}

describe("useAgentAccountUsageFreshness", () => {
  let host: HTMLDivElement;
  let root: Root;
  let publish: ((next: AgentAccountUsageSnapshot) => void) | null;
  let refreshes: Provider[];
  let respond: (provider: Provider) => AgentAccountUsageRefreshOutcome;
  let readiness: Readonly<Record<Provider, boolean>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    publish = null;
    refreshes = [];
    respond = () => ({ kind: "failed" });
    readiness = { claudeCode: true, codex: false };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const refresh = async (provider: Provider): Promise<AgentAccountUsageRefreshOutcome> => {
    refreshes.push(provider);
    return respond(provider);
  };

  function Harness({ initial }: { readonly initial: AgentAccountUsageSnapshot }) {
    const [current, setCurrent] = useState(initial);
    publish = setCurrent;
    useAgentAccountUsageFreshness({
      accountUsage: usageOf(current),
      readiness,
      refresh,
      now: () => Date.now(),
    });
    return null;
  }

  async function render(initial: AgentAccountUsageSnapshot): Promise<void> {
    await act(async () => {
      root.render(<Harness initial={initial} />);
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("refreshes once when a displayed window reaches its reset while the app stays open", async () => {
    respond = () => ({ kind: "refreshed" });
    await render(snapshot(NOW - MINUTE, NOW + HOUR));
    await act(async () => {
      publish?.(snapshot(NOW, NOW + HOUR));
    });
    expect(refreshes).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(HOUR + RESET_REFRESH_GRACE_MS - 1);
    });
    expect(refreshes).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(refreshes).toEqual(["claudeCode"]);

    await act(async () => {
      vi.advanceTimersByTime(10 * HOUR);
    });
    expect(refreshes).toEqual(["claudeCode"]);
  });

  it("does not loop when the refresh still reports the window that just reset", async () => {
    const reset = NOW - 2 * MINUTE;
    respond = () => {
      publish?.(snapshot(Date.now(), reset));
      return { kind: "refreshed" };
    };
    await render(snapshot(NOW - 3 * HOUR, reset));
    await settle();
    await settle();

    expect(refreshes).toEqual(["claudeCode"]);
  });

  it("waits for the provider to become ready and retries a refresh it could not run", async () => {
    readiness = { claudeCode: false, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    expect(refreshes).toEqual([]);

    respond = () => ({ kind: "unavailable" });
    readiness = { claudeCode: true, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    await settle();
    expect(refreshes).toEqual(["claudeCode"]);

    readiness = { claudeCode: false, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    respond = () => ({ kind: "failed" });
    readiness = { claudeCode: true, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    await settle();
    expect(refreshes).toEqual(["claudeCode", "claudeCode"]);

    readiness = { claudeCode: false, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    readiness = { claudeCode: true, codex: false };
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    await settle();
    expect(refreshes).toEqual(["claudeCode", "claudeCode"]);
  });

  it("retries a failed refresh once after a delay and then gives up", async () => {
    respond = () => ({ kind: "failed" });
    await render(snapshot(NOW - 40 * HOUR, NOW - 36 * HOUR));
    await settle();
    expect(refreshes).toEqual(["claudeCode"]);

    await act(async () => {
      vi.advanceTimersByTime(5 * MINUTE - 1);
    });
    expect(refreshes).toEqual(["claudeCode"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await settle();
    expect(refreshes).toEqual(["claudeCode", "claudeCode"]);

    await act(async () => {
      vi.advanceTimersByTime(HOUR);
    });
    await settle();
    expect(refreshes).toEqual(["claudeCode", "claudeCode"]);
  });

  it("refreshes a restored snapshot once it is older than the freshness window", async () => {
    await render(snapshot(NOW - 20 * MINUTE, NOW + 4 * HOUR));
    await settle();

    expect(refreshes).toEqual(["claudeCode"]);
  });

  it("leaves a live reading alone however long the app stays open inside its window", async () => {
    const initial = snapshot(NOW, NOW + 4 * HOUR);
    await render(initial);
    await act(async () => {
      publish?.(snapshot(NOW + MINUTE, NOW + 4 * HOUR));
    });
    await act(async () => {
      vi.advanceTimersByTime(3 * HOUR);
    });

    expect(refreshes).toEqual([]);
  });
});
