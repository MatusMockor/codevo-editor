// @vitest-environment jsdom

import { act, startTransition, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugGateway } from "../domain/debug";
import { useDebugExceptionPause } from "./useDebugExceptionPause";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function renderPauseHook(
  setExceptionPauseForSession: (
    rootPath: string,
    sessionId: number,
    mode: "none" | "uncaught" | "all",
    exceptionTypeFilter: readonly string[],
  ) => Promise<void>,
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let workspaceRoot: string | null = "/workspace/a";
  let activeSessionId: number | null = 7;
  let suspendedRender: Promise<never> | null = null;
  let hook!: ReturnType<typeof useDebugExceptionPause>;

  function Harness() {
    hook = useDebugExceptionPause({
      activeSessionId: () => activeSessionId,
      gateway: {} as DebugGateway,
      setExceptionPauseForSession,
      workspaceRoot,
    });
    if (suspendedRender) throw suspendedRender;
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    hook: () => hook,
    setRoot(next: string | null) {
      workspaceRoot = next;
      act(() => root.render(<Harness />));
    },
    setSession(next: number | null) {
      activeSessionId = next;
      act(() => root.render(<Harness />));
    },
    abandonRoot(next: string) {
      workspaceRoot = next;
      suspendedRender = new Promise<never>(() => undefined);
      act(() => {
        startTransition(() => {
          root.render(
            <Suspense fallback={null}>
              <Harness />
            </Suspense>,
          );
        });
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugExceptionPause", () => {
  it("keeps a validated filter per root and includes it in Node start policy", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const ui = renderPauseHook(setPolicy);

    expect(ui.hook().startPolicyForAdapter("/workspace/a", "node")).toEqual({
      adapterKind: "node",
      mode: "none",
      exceptionTypeFilter: [],
    });
    await act(() => ui.hook().setExceptionTypeFilter(["Error", "app.DomainError"]));
    expect(ui.hook().exceptionTypeFilter).toEqual(["Error", "app.DomainError"]);
    expect(ui.hook().startPolicyForAdapter("/workspace/a", "node")).toEqual({
      adapterKind: "node",
      mode: "none",
      exceptionTypeFilter: ["Error", "app.DomainError"],
    });

    ui.setRoot("/workspace/b");
    expect(ui.hook().exceptionTypeFilter).toEqual([]);
    ui.setRoot("/workspace/a");
    expect(ui.hook().exceptionTypeFilter).toEqual(["Error", "app.DomainError"]);
    ui.unmount();
  });

  it("suppresses the stored filter for native watch start policy", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const ui = renderPauseHook(setPolicy);

    await act(() => ui.hook().setExceptionTypeFilter(["TypeError"]));

    expect(ui.hook().startPolicyForAdapter("/workspace/a", "node", false)).toEqual({
      adapterKind: "node",
      mode: "none",
      exceptionTypeFilter: [],
    });
    expect(ui.hook().exceptionTypeFilter).toEqual(["TypeError"]);
    ui.unmount();
  });

  it("sends the complete live policy only to the exact Node session", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const ui = renderPauseHook(setPolicy);
    act(() => ui.hook().adoptSession("/workspace/a", 7, "node"));

    await act(() => ui.hook().setExceptionPauseMode("uncaught"));
    await act(() => ui.hook().setExceptionTypeFilter(["TypeError"]));

    expect(setPolicy).toHaveBeenNthCalledWith(1, "/workspace/a", 7, "uncaught", []);
    expect(setPolicy).toHaveBeenNthCalledWith(2, "/workspace/a", 7, "uncaught", ["TypeError"]);
    ui.setSession(8);
    await act(() => ui.hook().setExceptionTypeFilter(["RangeError"]));
    expect(setPolicy).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("isolates pending policy updates across an A to B to A transition", async () => {
    const first = deferred();
    const second = deferred();
    const setPolicy = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const ui = renderPauseHook(setPolicy);
    act(() => ui.hook().adoptSession("/workspace/a", 7, "node"));

    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = ui.hook().setExceptionTypeFilter(["TypeError"]);
    });
    expect(ui.hook().exceptionPausePending).toBe(true);
    ui.setRoot("/workspace/b");
    ui.setRoot("/workspace/a");
    expect(ui.hook().exceptionPausePending).toBe(false);

    let secondRequest!: Promise<void>;
    act(() => {
      secondRequest = ui.hook().setExceptionTypeFilter(["RangeError"]);
    });
    first.resolve();
    await act(() => firstRequest);
    expect(ui.hook().exceptionPausePending).toBe(true);
    second.resolve();
    await act(() => secondRequest);
    expect(ui.hook().exceptionPausePending).toBe(false);
    ui.unmount();
  });

  it("does not let a replaced session clear the current session pending state", async () => {
    const first = deferred();
    const second = deferred();
    const setPolicy = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const ui = renderPauseHook(setPolicy);
    act(() => ui.hook().adoptSession("/workspace/a", 7, "node"));

    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = ui.hook().setExceptionTypeFilter(["TypeError"]);
    });
    ui.setSession(8);
    act(() => ui.hook().adoptSession("/workspace/a", 8, "node"));

    let secondRequest!: Promise<void>;
    act(() => {
      secondRequest = ui.hook().setExceptionTypeFilter(["RangeError"]);
    });
    first.resolve();
    await act(() => firstRequest);
    expect(ui.hook().exceptionPausePending).toBe(true);
    second.resolve();
    await act(() => secondRequest);
    expect(ui.hook().exceptionPausePending).toBe(false);
    ui.unmount();
  });

  it("does not redirect a committed-root setter from an abandoned transition", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const ui = renderPauseHook(setPolicy);
    act(() => ui.hook().adoptSession("/workspace/a", 7, "node"));
    const setFilterFromCommittedRoot = ui.hook().setExceptionTypeFilter;

    ui.abandonRoot("/workspace/b");
    await act(() => setFilterFromCommittedRoot(["TypeError"]));

    expect(setPolicy).toHaveBeenCalledWith("/workspace/a", 7, "none", ["TypeError"]);
    expect(setPolicy).not.toHaveBeenCalledWith(
      "/workspace/b",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    ui.unmount();
  });

  it("rejects malformed filters without mutating or synchronizing policy", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const ui = renderPauseHook(setPolicy);
    act(() => ui.hook().adoptSession("/workspace/a", 7, "node"));

    await act(() => ui.hook().setExceptionTypeFilter(["Error", "Error"]));
    expect(ui.hook().exceptionTypeFilter).toEqual([]);
    expect(setPolicy).not.toHaveBeenCalled();
    ui.unmount();
  });
});
