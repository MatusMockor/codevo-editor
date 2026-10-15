import { useEffect } from "react";
import { preloadAgentSurfaceTerminal } from "./agentMode/agentSurfaceTerminalChunk";
import { preloadTerminalTabsPanel } from "./terminalTabsPanelChunk";

export const TERMINAL_IDLE_PRELOAD_TIMEOUT_MS = 2_000;

export interface IdleScheduler {
  requestIdleCallback?(callback: () => void, options: { timeout: number }): number;
  cancelIdleCallback?(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

export function scheduleIdleWork(scheduler: IdleScheduler, work: () => void): () => void {
  const { cancelIdleCallback, requestIdleCallback } = scheduler;
  if (requestIdleCallback && cancelIdleCallback) {
    const handle = requestIdleCallback(work, { timeout: TERMINAL_IDLE_PRELOAD_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = scheduler.setTimeout(work, TERMINAL_IDLE_PRELOAD_TIMEOUT_MS);
  return () => scheduler.clearTimeout(handle);
}

export function preloadTerminalSurfaces(): void {
  preloadTerminalTabsPanel();
  preloadAgentSurfaceTerminal();
}

export function useTerminalSurfacesIdlePreload(): void {
  useEffect(() => scheduleIdleWork(browserIdleScheduler(), preloadTerminalSurfaces), []);
}

function browserIdleScheduler(): IdleScheduler {
  return {
    cancelIdleCallback:
      typeof window.cancelIdleCallback === "function"
        ? (handle) => window.cancelIdleCallback(handle)
        : undefined,
    clearTimeout: (handle) => window.clearTimeout(handle),
    requestIdleCallback:
      typeof window.requestIdleCallback === "function"
        ? (callback, options) => window.requestIdleCallback(callback, options)
        : undefined,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  };
}
