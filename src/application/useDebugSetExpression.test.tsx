// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugGateway } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { useDebugSetExpression, type DebugSetExpressionCandidate } from "./useDebugSetExpression";

const frame = {
  frameId: 11,
  name: "main",
  filePath: "/workspace/one/index.js",
  lineNumber: 4,
  column: 1,
};

function renderLifecycle() {
  const setExpression = vi.fn<DebugGateway["setExpression"]>();
  const gateway = { setExpression } as unknown as DebugGateway;
  const current = { current: true };
  const invalidated = vi.fn();
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
  const pendingControlsRef = { current: new Map<string, Promise<unknown>>() };
  let commit!: ReturnType<typeof useDebugSetExpression>;
  const host = document.createElement("div");
  const root = createRoot(host);
  function Harness() {
    commit = useDebugSetExpression({
      adapterKindForSession: () => "node",
      currentRootRef: { current: "/workspace/one" },
      currentWorkspaceIdRef: { current: "owner-1" },
      frameSelectionByRootRef: { current: { "/workspace/one": null } },
      frameSelectionGenerationByRootRef: { current: { "/workspace/one": 0 } },
      gateway,
      invalidateWatchEvaluations: invalidated,
      isExactWorkspaceOwnerCurrent: () => true,
      isWorkspaceTrusted: () => true,
      mountedRef: { current: true },
      pauseGenerationByRootRef: { current: { "/workspace/one": 2 } },
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
      sideEffectingEvaluationFlightsRef: { current: new Set() },
      snapshotsRef,
      workspaceOwnerEpochRef: {
        current: { epoch: 0, workspaceId: "owner-1", workspaceRoot: "/workspace/one" },
      },
    });
    return null;
  }
  act(() => root.render(<Harness />));
  const candidate: DebugSetExpressionCandidate = {
    definitionId: "watch-1",
    definitionRevision: 7,
    expression: "count",
    owner: { rootKey: "/workspace/one", sessionId: 4, pauseGeneration: 2, frameId: 11 },
    setExpressionReference: 31,
    isCurrent: () => current.current,
  };
  return { candidate, commit, current, invalidated, setExpression, unmount: () => root.unmount() };
}

describe("useDebugSetExpression", () => {
  it("dispatches only the opaque exact-owner authority and invalidates after settlement", async () => {
    const ui = renderLifecycle();
    ui.setExpression.mockResolvedValueOnce({
      setExpressionReference: 31,
      expression: "count",
      value: { status: "ok", value: "43", variablesReference: 0 },
    });
    await expect(ui.commit(ui.candidate, "43")).resolves.toMatchObject({ value: "43" });
    expect(ui.setExpression).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 2,
      frameId: 11,
      setExpressionReference: 31,
      expression: "count",
      value: "43",
    });
    expect(ui.invalidated).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("rejects stale candidates before dispatch and drops stale replies without retry", async () => {
    const ui = renderLifecycle();
    ui.current.current = false;
    await expect(ui.commit(ui.candidate, "43")).resolves.toBeNull();
    expect(ui.setExpression).not.toHaveBeenCalled();

    ui.current.current = true;
    let settle!: (value: Awaited<ReturnType<DebugGateway["setExpression"]>>) => void;
    ui.setExpression.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    const pending = ui.commit(ui.candidate, "44");
    ui.current.current = false;
    settle({
      setExpressionReference: 31,
      expression: "count",
      value: { status: "ok", value: "44" },
    });
    await expect(pending).resolves.toBeNull();
    expect(ui.setExpression).toHaveBeenCalledTimes(1);
    expect(ui.invalidated).toHaveBeenCalledOnce();
    ui.unmount();
  });
});
