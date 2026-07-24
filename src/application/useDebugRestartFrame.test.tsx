// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugPauseOwner, DebugRestartFrameCandidate } from "./debugSessionContracts";
import {
  useDebugRestartFrame,
  type DebugRestartFrameCommands,
  type UseDebugRestartFrameOptions,
} from "./useDebugRestartFrame";

function stoppedSnapshot(filePath: string | null = "/workspace/app.ts"): DebuggerSessionSnapshot {
  const frame = { column: 1, filePath, frameId: 11, lineNumber: 4, name: "main" };
  return {
    lastSeq: 3,
    state: {
      frames: [frame],
      kind: "stopped",
      reason: "breakpoint",
      sessionId: 4,
      topFrame: frame,
    },
  };
}

function renderHook(overrides: Partial<UseDebugRestartFrameOptions> = {}) {
  let snapshot = stoppedSnapshot();
  let selectedFrameId: number | null = 11;
  let canRestart = true;
  let pauseOwner: DebugPauseOwner = {
    pauseGeneration: 2,
    rootKey: "/workspace",
    sessionId: 4,
    workspaceOwnerKey: "owner-1",
  };
  const restartFrame = vi.fn(async (_candidate: DebugRestartFrameCandidate) => true);
  const options: UseDebugRestartFrameOptions = {
    canRestartFrame: () => canRestart,
    getDebugAdapterKind: () => "node",
    getPauseOwner: () => pauseOwner,
    getSelectedFrameId: () => selectedFrameId,
    getSnapshot: () => snapshot,
    isWorkspaceTrusted: () => true,
    restartFrame,
    ...overrides,
  };
  let commands!: DebugRestartFrameCommands;
  const root = createRoot(document.createElement("div"));
  function Harness() {
    commands = useDebugRestartFrame(options);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    commands: () => commands,
    options,
    restartFrame,
    setCanRestart: (value: boolean) => (canRestart = value),
    setPauseOwner: (value: DebugPauseOwner) => (pauseOwner = value),
    setSelectedFrameId: (value: number | null) => (selectedFrameId = value),
    setSnapshot: (value: DebuggerSessionSnapshot) => (snapshot = value),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugRestartFrame", () => {
  it("captures the exact selected owner and delegates locking to the session", () => {
    const ui = renderHook();
    expect(ui.commands().canRestartFrame()).toBe(true);
    expect(ui.commands().restartFrame()).toBe(true);
    expect(ui.restartFrame).toHaveBeenCalledExactlyOnceWith({
      frameId: 11,
      pauseGeneration: 2,
      rootPath: "/workspace",
      sessionId: 4,
      workspaceOwnerKey: "owner-1",
      isCurrent: expect.any(Function),
    });
    expect(ui.restartFrame.mock.calls[0]?.[0]?.isCurrent()).toBe(true);
    ui.unmount();
  });

  it("supports a fileless top-frame fallback", () => {
    const snapshot = stoppedSnapshot(null);
    const ui = renderHook({
      getSelectedFrameId: () => null,
      getSnapshot: () => snapshot,
    });
    expect(ui.commands().restartFrame()).toBe(true);
    expect(ui.restartFrame.mock.calls[0]?.[0]).toMatchObject({ frameId: 11 });
    ui.unmount();
  });

  it("fails closed for PHP, running state, no frame, and revoked trust", () => {
    for (const overrides of [
      { getDebugAdapterKind: () => "php" as const },
      { getSnapshot: () => ({ lastSeq: 4, state: { kind: "running", sessionId: 4 } }) },
      {
        getSelectedFrameId: () => null,
        getSnapshot: () => ({
          lastSeq: 3,
          state: {
            frames: [],
            kind: "stopped" as const,
            reason: "pause",
            sessionId: 4,
            topFrame: null,
          },
        }),
      },
      { isWorkspaceTrusted: () => false },
    ] satisfies Partial<UseDebugRestartFrameOptions>[]) {
      const ui = renderHook(overrides);
      expect(ui.commands().canRestartFrame()).toBe(false);
      expect(ui.commands().restartFrame()).toBe(false);
      expect(ui.restartFrame).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it.each(["label", "subtle"] as const)(
    "rejects a %s presentation-hint frame from UI and direct command invocation",
    (presentationHint) => {
      const snapshot = stoppedSnapshot() as DebuggerSessionSnapshot;
      if (snapshot.state.kind !== "stopped") throw new Error("Expected stopped fixture.");
      const frame = snapshot.state.frames[0];
      if (!frame) throw new Error("Expected frame fixture.");
      const hintedFrame = { ...frame, presentationHint };
      const hintedSnapshot: DebuggerSessionSnapshot = {
        ...snapshot,
        state: {
          ...snapshot.state,
          frames: [hintedFrame],
          topFrame: hintedFrame,
        },
      };
      const ui = renderHook({ getSnapshot: () => hintedSnapshot });

      expect(ui.commands().canRestartFrame()).toBe(false);
      expect(ui.commands().restartFrame()).toBe(false);
      expect(ui.restartFrame).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it("invalidates the candidate on snapshot, selection, owner, or capability drift", () => {
    const ui = renderHook();
    const originalSnapshot = ui.options.getSnapshot();
    const originalOwner = ui.options.getPauseOwner();
    if (!originalOwner) throw new Error("Expected a pause owner fixture.");
    expect(ui.commands().restartFrame()).toBe(true);
    const candidate = ui.restartFrame.mock.calls[0]?.[0];
    if (!candidate) throw new Error("Expected Restart Frame to capture a candidate.");
    expect(candidate.isCurrent()).toBe(true);
    ui.setSnapshot({ ...ui.options.getSnapshot() });
    expect(candidate.isCurrent()).toBe(false);
    ui.setSnapshot(originalSnapshot);
    ui.setSelectedFrameId(null);
    expect(candidate.isCurrent()).toBe(false);
    ui.setSelectedFrameId(11);
    ui.setPauseOwner({ ...originalOwner, pauseGeneration: 3 });
    expect(candidate.isCurrent()).toBe(false);
    ui.setPauseOwner({ ...originalOwner, rootKey: "/foreign" });
    expect(candidate.isCurrent()).toBe(false);
    ui.setPauseOwner({ ...originalOwner, sessionId: 5 });
    expect(candidate.isCurrent()).toBe(false);
    ui.setPauseOwner({ ...originalOwner, workspaceOwnerKey: "owner-2" });
    expect(candidate.isCurrent()).toBe(false);
    ui.setPauseOwner(originalOwner);
    ui.setCanRestart(false);
    expect(candidate.isCurrent()).toBe(false);
    ui.unmount();
  });

  it("keeps stable callbacks current when React replaces every option closure", () => {
    const snapshot = stoppedSnapshot();
    const restartA = vi.fn(async (_candidate: DebugRestartFrameCandidate) => true);
    const restartB = vi.fn(async (_candidate: DebugRestartFrameCandidate) => true);
    let commands!: DebugRestartFrameCommands;
    const root = createRoot(document.createElement("div"));
    const owner = {
      pauseGeneration: 2,
      rootKey: "/workspace",
      sessionId: 4,
      workspaceOwnerKey: "owner-1",
    };

    function Harness({
      restartFrame,
      trusted,
    }: {
      restartFrame(candidate: DebugRestartFrameCandidate): Promise<boolean>;
      trusted: boolean;
    }) {
      commands = useDebugRestartFrame({
        canRestartFrame: () => true,
        getDebugAdapterKind: () => "node",
        getPauseOwner: () => owner,
        getSelectedFrameId: () => 11,
        getSnapshot: () => snapshot,
        isWorkspaceTrusted: () => trusted,
        restartFrame,
      });
      return null;
    }

    act(() => root.render(<Harness restartFrame={restartA} trusted={true} />));
    const stableCanRestart = commands.canRestartFrame;
    const stableRestart = commands.restartFrame;
    act(() => root.render(<Harness restartFrame={restartB} trusted={false} />));
    expect(commands.canRestartFrame).toBe(stableCanRestart);
    expect(commands.restartFrame).toBe(stableRestart);
    expect(stableCanRestart()).toBe(false);
    expect(stableRestart()).toBe(false);

    act(() => root.render(<Harness restartFrame={restartB} trusted={true} />));
    expect(stableRestart()).toBe(true);
    expect(restartA).not.toHaveBeenCalled();
    expect(restartB).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("absorbs synchronous and asynchronous port failures and rechecks shared flight state", async () => {
    const synchronous = renderHook({
      restartFrame: () => {
        throw new Error("sync");
      },
    });
    expect(synchronous.commands().restartFrame()).toBe(false);
    synchronous.unmount();

    const ui = renderHook({ restartFrame: vi.fn().mockRejectedValue(new Error("async")) });
    expect(ui.commands().restartFrame()).toBe(true);
    await act(async () => Promise.resolve());
    expect(ui.commands().canRestartFrame()).toBe(true);
    ui.setCanRestart(false);
    expect(ui.commands().restartFrame()).toBe(false);
    ui.unmount();
  });
});
