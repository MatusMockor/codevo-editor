// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERMINAL_IDLE_PRELOAD_TIMEOUT_MS,
  scheduleIdleWork,
  useTerminalSurfacesIdlePreload,
  type IdleScheduler,
} from "./useTerminalSurfacesIdlePreload";

const preloadMocks = vi.hoisted(() => ({
  preloadAgentSurfaceTerminal: vi.fn(),
  preloadTerminalTabsPanel: vi.fn(),
}));

vi.mock("./terminalTabsPanelChunk", () => ({
  preloadTerminalTabsPanel: preloadMocks.preloadTerminalTabsPanel,
}));
vi.mock("./agentMode/agentSurfaceTerminalChunk", () => ({
  preloadAgentSurfaceTerminal: preloadMocks.preloadAgentSurfaceTerminal,
}));

function timeoutScheduler(): IdleScheduler & {
  readonly clearTimeout: ReturnType<typeof vi.fn<(handle: number) => void>>;
  readonly setTimeout: ReturnType<typeof vi.fn<(callback: () => void, delay: number) => number>>;
} {
  return {
    clearTimeout: vi.fn<(handle: number) => void>(),
    setTimeout: vi.fn<(callback: () => void, delay: number) => number>(() => 41),
  };
}

describe("scheduleIdleWork", () => {
  it("uses the idle callback with a bounded timeout and cancels it", () => {
    const work = vi.fn();
    const cancelIdleCallback = vi.fn();
    const requestIdleCallback = vi.fn(() => 7);
    const scheduler = { ...timeoutScheduler(), cancelIdleCallback, requestIdleCallback };

    const cancel = scheduleIdleWork(scheduler, work);

    expect(requestIdleCallback).toHaveBeenCalledWith(work, {
      timeout: TERMINAL_IDLE_PRELOAD_TIMEOUT_MS,
    });
    expect(scheduler.setTimeout).not.toHaveBeenCalled();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(work).not.toHaveBeenCalled();
  });

  it("falls back to a timer when idle callbacks are unavailable", () => {
    const work = vi.fn();
    const scheduler = timeoutScheduler();

    const cancel = scheduleIdleWork(scheduler, work);

    expect(scheduler.setTimeout).toHaveBeenCalledWith(work, TERMINAL_IDLE_PRELOAD_TIMEOUT_MS);
    cancel();
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(41);
  });
});

describe("useTerminalSurfacesIdlePreload", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    preloadMocks.preloadAgentSurfaceTerminal.mockClear();
    preloadMocks.preloadTerminalTabsPanel.mockClear();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function Probe() {
    useTerminalSurfacesIdlePreload();
    return null;
  }

  it("preloads both terminal surfaces once the app is idle", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));

    expect(preloadMocks.preloadTerminalTabsPanel).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TERMINAL_IDLE_PRELOAD_TIMEOUT_MS));

    expect(preloadMocks.preloadTerminalTabsPanel).toHaveBeenCalledTimes(1);
    expect(preloadMocks.preloadAgentSurfaceTerminal).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("does not preload after the app unmounts first", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    act(() => root.unmount());

    act(() => vi.advanceTimersByTime(TERMINAL_IDLE_PRELOAD_TIMEOUT_MS * 2));

    expect(preloadMocks.preloadTerminalTabsPanel).not.toHaveBeenCalled();
    expect(preloadMocks.preloadAgentSurfaceTerminal).not.toHaveBeenCalled();
  });
});
