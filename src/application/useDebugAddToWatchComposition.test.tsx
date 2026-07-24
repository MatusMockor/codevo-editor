// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import { createDebugAddToWatchCommandBridge } from "./debugAddToWatchCommandBridge";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";
import {
  useDebugAddToWatchComposition,
  type DebugAddToWatchComposition,
  type DebugAddToWatchFocusedCandidate,
} from "./useDebugAddToWatchComposition";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};

function renderHook() {
  const host = document.createElement("div");
  const root = createRoot(host);
  const bridge = createDebugAddToWatchCommandBridge();
  const canAddWatch = vi.fn(() => true);
  const addWatch = vi.fn(() => true);
  let adapter: ActiveDebugAdapterKind = "node";
  let inspectionOwner: DebugInspectionOwner | null = owner;
  let workspaceOwnerKey: string | null = "workspace-owner-a";
  let current: DebugAddToWatchComposition | null = null;
  function Harness() {
    current = useDebugAddToWatchComposition({
      addWatch,
      bridge,
      canAddWatch,
      debugAdapterKind: adapter,
      inspectionOwner,
      workspaceOwnerKey,
    });
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    addWatch,
    canAddWatch,
    hook: () => current as unknown as DebugAddToWatchComposition,
    publish(candidate: DebugAddToWatchFocusedCandidate) {
      let cleanup: () => void = () => undefined;
      act(() => {
        cleanup = (current as unknown as DebugAddToWatchComposition).surface.setFocusedCandidate(
          candidate,
        );
      });
      return cleanup;
    },
    setAdapter(next: ActiveDebugAdapterKind) {
      adapter = next;
      render();
    },
    setOwner(next: DebugInspectionOwner | null) {
      inspectionOwner = next;
      render();
    },
    setWorkspaceOwner(next: string | null) {
      workspaceOwnerKey = next;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function candidate(
  overrides: Partial<DebugAddToWatchFocusedCandidate> = {},
): DebugAddToWatchFocusedCandidate {
  return {
    identity: {},
    owner,
    adapterEvaluateName: 'users[0]["display-name"]',
    isCurrent: () => true,
    ...overrides,
  };
}

describe("useDebugAddToWatchComposition", () => {
  it("keeps raw adapter evaluate names out of the frozen controller command surface", () => {
    const ui = renderHook();
    expect(Object.keys(ui.hook().commands).sort()).toEqual(["addToWatch", "canAddToWatch"]);
    expect(Object.isFrozen(ui.hook().commands)).toBe(true);
    expect(Object.isFrozen(ui.hook().surface)).toBe(true);
    expect(JSON.stringify(ui.hook().commands)).not.toContain("users");
    ui.unmount();
  });

  it("uses only adapterEvaluateName and delegates through watch canAdd/add once", () => {
    const ui = renderHook();
    ui.publish(candidate());

    expect(ui.hook().commands.addToWatch()).toBe(true);
    expect(ui.canAddWatch).toHaveBeenCalledExactlyOnceWith('users[0]["display-name"]');
    expect(ui.addWatch).toHaveBeenCalledExactlyOnceWith('users[0]["display-name"]');
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.unmount();
  });

  it("rejects duplicate/full watch state before add and consumes the attempt", () => {
    const ui = renderHook();
    ui.canAddWatch.mockReturnValue(false);
    ui.publish(candidate());

    expect(ui.hook().commands.addToWatch()).toBe(false);
    expect(ui.canAddWatch).toHaveBeenCalledOnce();
    expect(ui.addWatch).not.toHaveBeenCalled();
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.unmount();
  });

  it("fails closed for missing, oversized, controlled, stale and throwing row input", () => {
    const ui = renderHook();
    const invalid = ["", "x".repeat(4_097), "bad\npath"];
    for (const expression of invalid) {
      ui.publish(candidate({ adapterEvaluateName: expression }));
      expect(ui.hook().commands.addToWatch()).toBe(false);
    }
    ui.publish(candidate({ owner: { ...owner, frameId: 12 } }));
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.publish(
      candidate({
        isCurrent: () => {
          throw new Error("detached row");
        },
      }),
    );
    expect(ui.hook().commands.addToWatch()).toBe(false);
    expect(ui.canAddWatch).not.toHaveBeenCalled();
    expect(ui.addWatch).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("invalidates root, workspace, session, pause and frame drift including A-B-A", () => {
    const cases: Array<(ui: ReturnType<typeof renderHook>) => void> = [
      (ui) => ui.setOwner({ ...owner, rootKey: "/other" }),
      (ui) => ui.setWorkspaceOwner("workspace-owner-b"),
      (ui) => ui.setOwner({ ...owner, sessionId: 8 }),
      (ui) => ui.setOwner({ ...owner, pauseGeneration: 4 }),
      (ui) => ui.setOwner({ ...owner, frameId: 12 }),
    ];
    for (const drift of cases) {
      const ui = renderHook();
      ui.publish(candidate());
      drift(ui);
      expect(ui.hook().commands.addToWatch()).toBe(false);
      expect(ui.addWatch).not.toHaveBeenCalled();
      ui.unmount();
    }

    const ui = renderHook();
    ui.publish(candidate());
    ui.setWorkspaceOwner("workspace-owner-b");
    ui.setWorkspaceOwner("workspace-owner-a");
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.unmount();
  });

  it("rejects PHP, running/ownerless state and unmount", () => {
    const ui = renderHook();
    ui.setAdapter("php");
    ui.publish(candidate());
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.setAdapter("node");
    ui.setOwner(null);
    ui.publish(candidate());
    expect(ui.hook().commands.addToWatch()).toBe(false);
    ui.setOwner(owner);
    ui.publish(candidate());
    ui.unmount();
    expect(ui.addWatch).not.toHaveBeenCalled();
  });

  it("rejects row replacement, stale cleanup and drift during canAdd", () => {
    const ui = renderHook();
    let firstCurrent = true;
    const releaseFirst = ui.publish(candidate({ identity: {}, isCurrent: () => firstCurrent }));
    const replacement = candidate({ identity: {}, adapterEvaluateName: "replacement.path" });
    ui.publish(replacement);
    releaseFirst();
    expect(ui.hook().commands.addToWatch()).toBe(true);
    expect(ui.addWatch).toHaveBeenCalledExactlyOnceWith("replacement.path");

    let nextCurrent = true;
    const next = candidate({
      adapterEvaluateName: "next.path",
      isCurrent: () => nextCurrent,
    });
    ui.publish(next);
    ui.canAddWatch.mockImplementationOnce(() => {
      firstCurrent = false;
      nextCurrent = false;
      return true;
    });
    expect(ui.hook().commands.addToWatch()).toBe(false);
    expect(ui.addWatch).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});
