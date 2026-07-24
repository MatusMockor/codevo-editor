// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugGateway, DebugVariable } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { debugMutationOwnerKey, useDebugSetVariable } from "./useDebugSetVariable";

const frame = {
  frameId: 11,
  name: "main",
  filePath: "/workspace/one/index.js",
  lineNumber: 4,
  column: 1,
};

function renderLifecycle() {
  const setVariable = vi.fn<DebugGateway["setVariable"]>();
  const gateway = { setVariable } as unknown as DebugGateway;
  const currentRootRef: { current: string | null } = { current: "/workspace/one" };
  const currentWorkspaceIdRef: { current: string | null } = { current: "owner-1" };
  const workspaceOwnerEpochRef = {
    current: { epoch: 0, workspaceId: "owner-1", workspaceRoot: "/workspace/one" },
  };
  const snapshotsRef: { current: Record<string, DebuggerSessionSnapshot> } = {
    current: {
      "/workspace/one": {
        lastSeq: 1,
        state: {
          kind: "stopped",
          sessionId: 4,
          reason: "breakpoint",
          frames: [frame],
          topFrame: frame,
        },
      },
    },
  };
  const frameSelectionByRootRef = { current: { "/workspace/one": null } };
  const frameSelectionGenerationByRootRef = { current: { "/workspace/one": 0 } };
  const pauseGenerationByRootRef = { current: { "/workspace/one": 2 } };
  const pendingControlsRef = { current: new Map<string, Promise<unknown>>() };
  const sideEffectingEvaluationFlightsRef = { current: new Set<string>() };
  const mountedRef = { current: true };
  const trusted = { current: true };
  const indeterminate = { current: false };
  const captured: {
    commit:
      ((reference: number, name: string, value: string) => Promise<DebugVariable | null>) | null;
  } = { commit: null };
  const host = document.createElement("div");
  const root = createRoot(host);

  function Harness() {
    captured.commit = useDebugSetVariable({
      adapterKindForSession: () => "node",
      currentRootRef,
      currentWorkspaceIdRef,
      frameSelectionByRootRef,
      frameSelectionGenerationByRootRef,
      gateway,
      isExactWorkspaceOwnerCurrent: (rootPath, workspaceId) => {
        if (indeterminate.current) throw new Error("owner lookup failed");
        return rootPath === currentRootRef.current && workspaceId === currentWorkspaceIdRef.current;
      },
      isWorkspaceTrusted: () => trusted.current,
      mountedRef,
      pauseGenerationByRootRef,
      pendingActiveStopsRef: { current: new Map() },
      pendingBreakpointBulkMutationsRef: { current: new Map() },
      pendingControlsRef,
      pendingRestartsRef: { current: new Map() },
      pendingStartKeysRef: { current: new Set() },
      sessionOwnersRef: {
        current: new Map([
          [
            "/workspace/one",
            { sessionId: 4, targetKind: "node-script" as const, workspaceId: "owner-1" },
          ],
        ]),
      },
      setControlPendingByRoot: vi.fn(),
      sideEffectingEvaluationFlightsRef,
      snapshotsRef,
      workspaceOwnerEpochRef,
    });
    return null;
  }
  act(() => root.render(<Harness />));

  return {
    commit: (reference: number, name: string, value: string) =>
      captured.commit!(reference, name, value),
    currentRootRef,
    frameSelectionGenerationByRootRef,
    gatewaySetVariable: setVariable,
    indeterminate,
    mountedRef,
    pauseGenerationByRootRef,
    pendingControlsRef,
    sideEffectingEvaluationFlightsRef,
    snapshotsRef,
    trusted,
    unmount: () => act(() => root.unmount()),
    workspaceOwnerEpochRef,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("useDebugSetVariable", () => {
  it("invokes the exact current owner request and returns the immutable wire metadata", async () => {
    const ui = renderLifecycle();
    const result: DebugVariable = {
      name: "count",
      value: "43",
      evaluateName: "state.count",
      canSetValue: true,
      variablesReference: 91,
    };
    ui.gatewaySetVariable.mockResolvedValueOnce(result);
    await expect(ui.commit(21, "count", "43")).resolves.toEqual(result);
    expect(ui.gatewaySetVariable).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 2,
      frameId: 11,
      variablesReference: 21,
      name: "count",
      value: "43",
    });
    ui.unmount();
  });

  it("serializes only the matching side-effecting evaluation owner", async () => {
    const ui = renderLifecycle();
    const sameOwner = debugMutationOwnerKey("/workspace/one", 4, 2, 11);
    ui.sideEffectingEvaluationFlightsRef.current.add(sameOwner);
    await expect(ui.commit(21, "count", "43")).resolves.toBeNull();
    expect(ui.gatewaySetVariable).not.toHaveBeenCalled();

    ui.sideEffectingEvaluationFlightsRef.current.clear();
    ui.sideEffectingEvaluationFlightsRef.current.add(
      debugMutationOwnerKey("/workspace/other", 9, 1, 7),
    );
    ui.gatewaySetVariable.mockResolvedValueOnce({
      name: "count",
      value: "43",
      variablesReference: 0,
    });
    await expect(ui.commit(21, "count", "43")).resolves.toMatchObject({ value: "43" });
    expect(ui.gatewaySetVariable).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it.each(["owner", "trust", "resume", "frame", "unmount", "indeterminate"] as const)(
    "drops a stale adapter failure after %s drift",
    async (boundary) => {
      const ui = renderLifecycle();
      const reply = deferred<DebugVariable>();
      ui.gatewaySetVariable.mockReturnValueOnce(reply.promise);
      const pending = ui.commit(21, "count", "43");
      if (boundary === "owner") ui.workspaceOwnerEpochRef.current.epoch += 2;
      else if (boundary === "trust") ui.trusted.current = false;
      else if (boundary === "resume") {
        ui.snapshotsRef.current["/workspace/one"] = {
          lastSeq: 2,
          state: { kind: "running", sessionId: 4 },
        };
      } else if (boundary === "frame") {
        ui.frameSelectionGenerationByRootRef.current["/workspace/one"] = 1;
      } else if (boundary === "unmount") {
        ui.mountedRef.current = false;
      } else {
        ui.indeterminate.current = true;
      }
      reply.reject(new Error("adapter rejected"));
      await expect(pending).resolves.toBeNull();
      expect(ui.gatewaySetVariable).toHaveBeenCalledTimes(1);
      ui.unmount();
    },
  );

  it("propagates a current adapter error and releases the shared control flight", async () => {
    const ui = renderLifecycle();
    const failure = { kind: "adapter", message: "assignment rejected" };
    ui.gatewaySetVariable.mockRejectedValueOnce(failure);
    await expect(ui.commit(21, "count", "43")).rejects.toBe(failure);
    expect(ui.pendingControlsRef.current.size).toBe(0);
    expect(ui.gatewaySetVariable).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});
