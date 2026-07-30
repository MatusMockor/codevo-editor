// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import {
  useWorkbenchSearchEverywhere,
  type WorkbenchSearchEverywhere,
  type WorkbenchSearchEverywhereDependencies,
} from "./useWorkbenchSearchEverywhere";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkbenchSearchEverywhere", () => {
  it("aborts superseded indexed symbol work and publishes only the latest query", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const searchClassOpenSymbols = vi.fn((_query: string, _limit: number, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return Promise.resolve([]);
    });
    const harness = renderSearchEverywhere(dependencies({ searchClassOpenSymbols }));

    act(() => {
      harness.value().setSearchEverywhereOpen(true);
      harness.value().setSearchEverywhereQuery("Us");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(signals[0]?.aborted).toBe(false);

    act(() => harness.value().setSearchEverywhereQuery("User"));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(120));

    expect(searchClassOpenSymbols).toHaveBeenLastCalledWith("User", 40, expect.any(AbortSignal));
    expect(signals[1]?.aborted).toBe(false);
    harness.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});

function dependencies(
  overrides: Partial<WorkbenchSearchEverywhereDependencies> = {},
): WorkbenchSearchEverywhereDependencies {
  return {
    canSearchClassOpenSymbols: true,
    fileSearch: { searchFiles: vi.fn(async () => []) },
    latencyTrackerForRoot: () => createLatencyTracker(),
    reportError: vi.fn(),
    searchClassOpenSymbols: vi.fn(async () => []),
    workspaceRoot: "/project",
    ...overrides,
  };
}

function renderSearchEverywhere(deps: WorkbenchSearchEverywhereDependencies) {
  const root = createRoot(document.createElement("div"));
  let current: WorkbenchSearchEverywhere | null = null;
  function Harness() {
    current = useWorkbenchSearchEverywhere(deps);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    value: () => {
      if (!current) throw new Error("hook is not mounted");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}
