// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePerfAutorunInstall } from "./usePerfAutorunInstall";

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function mountAutorunHost(start: () => Promise<void>): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoot = root;

  function AutorunHost() {
    usePerfAutorunInstall(start);

    return null;
  }

  act(() => {
    root.render(createElement(AutorunHost));
  });
}

function enableAutorun(): void {
  vi.stubEnv("VITE_CODEVO_PERF_AUTORUN", "1");
  window.localStorage.setItem("codevo.perfBridge", "1");
  window.localStorage.setItem("codevo.qaBridge", "1");
}

afterEach(() => {
  const root = mountedRoot;
  const host = container;
  mountedRoot = null;
  container = null;

  if (root) {
    act(() => {
      root.unmount();
    });
  }

  host?.remove();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  delete window.__codevoPerfAutorunStartedAt;
});

describe("usePerfAutorunInstall", () => {
  it("starts nothing while the autorun flag is unset", () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    window.localStorage.setItem("codevo.qaBridge", "1");
    const start = vi.fn(() => Promise.resolve());
    mountAutorunHost(start);

    expect(start).not.toHaveBeenCalled();
    expect(window.__codevoPerfAutorunStartedAt).toBeUndefined();
  });

  it("starts nothing while the perf bridge is disabled", () => {
    vi.stubEnv("VITE_CODEVO_PERF_AUTORUN", "1");
    window.localStorage.setItem("codevo.qaBridge", "1");
    const start = vi.fn(() => Promise.resolve());
    mountAutorunHost(start);

    expect(start).not.toHaveBeenCalled();
  });

  it("starts nothing while the QA bridge is disabled", () => {
    vi.stubEnv("VITE_CODEVO_PERF_AUTORUN", "1");
    window.localStorage.setItem("codevo.perfBridge", "1");
    const start = vi.fn(() => Promise.resolve());
    mountAutorunHost(start);

    expect(start).not.toHaveBeenCalled();
  });

  it("starts the run once every gate is open", () => {
    enableAutorun();
    const start = vi.fn(() => Promise.resolve());
    mountAutorunHost(start);

    expect(start).toHaveBeenCalledTimes(1);
    expect(window.__codevoPerfAutorunStartedAt).toBeTypeOf("string");
  });

  it("never starts a second run when the host remounts", () => {
    enableAutorun();
    const start = vi.fn(() => Promise.resolve());
    mountAutorunHost(start);

    const root = mountedRoot;
    mountedRoot = null;
    act(() => {
      root?.unmount();
    });
    container?.remove();
    mountAutorunHost(start);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("logs and keeps the app alive when the run rejects", async () => {
    enableAutorun();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const start = vi.fn(() => Promise.reject(new Error("autorun failed")));
    mountAutorunHost(start);

    await act(async () => {
      await Promise.resolve();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/autorun failed/);
    logged.mockRestore();
  });
});
