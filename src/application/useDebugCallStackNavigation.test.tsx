// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugPauseOwner } from "./debugSessionContracts";
import {
  useDebugCallStackNavigation,
  type DebugCallStackNavigationCommands,
  type UseDebugCallStackNavigationOptions,
} from "./useDebugCallStackNavigation";

describe("useDebugCallStackNavigation", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let commands!: DebugCallStackNavigationCommands;
  let options: UseDebugCallStackNavigationOptions;
  let snapshot: DebuggerSessionSnapshot;
  let owner: DebugPauseOwner | null;
  let selectedFrameId: number | null;
  let selection: ReturnType<typeof deferred<void>>;
  const selectFrame = vi.fn();

  function Harness() {
    commands = useDebugCallStackNavigation(options);
    return null;
  }

  const render = () => act(() => root.render(<Harness />));

  beforeEach(() => {
    host = document.createElement("div");
    root = createRoot(host);
    snapshot = stoppedSnapshot();
    owner = pauseOwner();
    selectedFrameId = 11;
    selection = deferred<void>();
    selectFrame.mockReset();
    selectFrame.mockReturnValue(selection.promise);
    options = {
      getPauseOwner: () => owner,
      getSelectedFrameId: () => selectedFrameId,
      getSnapshot: () => snapshot,
      selectFrame,
    };
    render();
  });

  afterEach(() => act(() => root.unmount()));

  it("routes official top, bottom, up and down actions through exact frame selection", async () => {
    expect(commands.canSelectCallStackFrame()).toBe(true);
    expect(commands.selectCallStackDown()).toBe(true);
    expect(commands.canSelectCallStackFrame()).toBe(false);
    expect(commands.selectCallStackUp()).toBe(false);
    expect(selectFrame).toHaveBeenCalledWith(12, expect.any(Function));
    expect(selectFrame.mock.calls[0]?.[1]()).toBe(true);
    await act(async () => selection.resolve());

    selectedFrameId = null;
    for (const [invoke, expected] of [
      [() => commands.selectCallStackTop(), 11],
      [() => commands.selectCallStackBottom(), 13],
      [() => commands.selectCallStackUp(), 13],
      [() => commands.selectCallStackDown(), 11],
    ] as const) {
      selection = deferred<void>();
      selectFrame.mockReturnValueOnce(selection.promise);
      expect(invoke()).toBe(true);
      expect(selectFrame).toHaveBeenLastCalledWith(expected, expect.any(Function));
      await act(async () => selection.resolve());
    }
  });

  it("keeps a pathless frame selectable", () => {
    expect(commands.selectCallStackDown()).toBe(true);
    expect(selectFrame).toHaveBeenCalledWith(12, expect.any(Function));
  });

  it("fails closed for missing ownership, stale selection and invalid snapshots", () => {
    owner = null;
    expect(commands.canSelectCallStackFrame()).toBe(false);
    expect(commands.selectCallStackTop()).toBe(false);
    owner = pauseOwner();
    selectedFrameId = 99;
    expect(commands.canSelectCallStackFrame()).toBe(false);
    selectedFrameId = null;
    snapshot = { lastSeq: 4, state: { kind: "running", sessionId: 4 } };
    expect(commands.canSelectCallStackFrame()).toBe(false);
    snapshot = stoppedSnapshot([frame(11, "/workspace/a.ts"), frame(11, "/workspace/b.ts")]);
    expect(commands.canSelectCallStackFrame()).toBe(false);
    expect(selectFrame).not.toHaveBeenCalled();
  });

  it("invalidates the commit fence after snapshot, pause, selection, or ownership drift", () => {
    expect(commands.selectCallStackBottom()).toBe(true);
    const shouldCommit = selectFrame.mock.calls[0]?.[1] as () => boolean;
    expect(shouldCommit()).toBe(true);
    snapshot = { ...snapshot };
    expect(shouldCommit()).toBe(false);
    snapshot = stoppedSnapshot();
    owner = { ...pauseOwner(), pauseGeneration: 2 };
    expect(shouldCommit()).toBe(false);
    owner = pauseOwner();
    selectedFrameId = 12;
    expect(shouldCommit()).toBe(false);
  });

  it("releases single-flight after rejection and catches synchronous ports", async () => {
    expect(commands.selectCallStackTop()).toBe(true);
    await act(async () => selection.reject(new Error("selection failed")));
    expect(commands.canSelectCallStackFrame()).toBe(true);

    selectFrame.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    expect(commands.selectCallStackTop()).toBe(false);
    expect(commands.canSelectCallStackFrame()).toBe(true);
  });
});

function frame(frameId: number, filePath: string | null) {
  return { column: 1, filePath, frameId, lineNumber: frameId, name: `frame-${frameId}` };
}

function stoppedSnapshot(
  frames = [frame(11, "/workspace/a.ts"), frame(12, null), frame(13, "/workspace/b.ts")],
): DebuggerSessionSnapshot {
  return {
    lastSeq: 3,
    state: { frames, kind: "stopped", reason: "breakpoint", sessionId: 4, topFrame: frames[0] },
  };
}

function pauseOwner(): DebugPauseOwner {
  return {
    pauseGeneration: 1,
    rootKey: "/workspace",
    sessionId: 4,
    workspaceOwnerKey: "owner-a",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
