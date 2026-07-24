// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import type {
  DebugInlineBreakpointCapture,
  DebugInlineBreakpointCaptureReader,
} from "../domain/debugInlineBreakpointCapture";
import {
  useDebugInlineBreakpoint,
  type DebugInlineBreakpointCommands,
  type DebugInlineBreakpointCandidate,
} from "./useDebugInlineBreakpoint";

const capture: DebugInlineBreakpointCapture = {
  columnNumber: 7,
  documentPath: "/workspace/src/index.ts",
  focusEpoch: 1,
  focused: true,
  lineNumber: 4,
  modelIdentity: "model-1",
  modelVersion: 3,
  workspaceOwnerKey: "owner-1",
  workspaceRoot: "/workspace",
  writable: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function renderHook({
  addBreakpoint = vi.fn(async () => null),
  getBreakpoints = () => [],
  readCapture = () => capture,
}: {
  addBreakpoint?: (
    candidate: DebugInlineBreakpointCandidate,
  ) => Promise<BreakpointCreationOwnership | null>;
  getBreakpoints?: () => readonly Breakpoint[];
  readCapture?: () => DebugInlineBreakpointCapture | null;
} = {}) {
  const reader: DebugInlineBreakpointCaptureReader = {
    readDebugInlineBreakpointCapture: vi.fn(readCapture),
  };
  let api!: DebugInlineBreakpointCommands;
  const root = createRoot(window.document.createElement("div"));
  function Harness() {
    api = useDebugInlineBreakpoint({
      addBreakpoint,
      captureReader: reader,
      getBreakpoints,
      isWorkspaceCurrent: (workspaceRoot, owner) =>
        workspaceRoot === "/workspace" && owner === "owner-1",
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return { api: () => api, reader, unmount: () => act(() => root.unmount()) };
}

describe("useDebugInlineBreakpoint", () => {
  it("double-captures and dispatches an exact inline tuple", () => {
    const addBreakpoint = vi.fn(async () => null);
    const ui = renderHook({ addBreakpoint });

    expect(ui.api().canAddInlineBreakpoint()).toBe(true);
    expect(ui.api().addInlineBreakpoint()).toBe(true);
    expect(addBreakpoint).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        columnNumber: 7,
        filePath: capture.documentPath,
        lineNumber: capture.lineNumber,
        workspaceOwnerKey: capture.workspaceOwnerKey,
      }),
    );
    ui.unmount();
  });

  it("normalizes cursor column one to a line tuple and no-ops an exact sibling", () => {
    const addBreakpoint = vi.fn(async () => null);
    const atStart = { ...capture, columnNumber: 1 };
    const ui = renderHook({ addBreakpoint, readCapture: () => atStart });
    expect(ui.api().addInlineBreakpoint()).toBe(true);
    expect(addBreakpoint).toHaveBeenCalledWith(
      expect.not.objectContaining({ columnNumber: expect.anything() }),
    );
    ui.unmount();

    const existing = renderHook({
      getBreakpoints: () => [
        { id: "line", enabled: true, filePath: capture.documentPath, lineNumber: 4 },
      ],
      readCapture: () => atStart,
    });
    expect(existing.api().canAddInlineBreakpoint()).toBe(false);
    expect(existing.api().addInlineBreakpoint()).toBe(false);
    existing.unmount();
  });

  it("holds one flight and rolls back only its owned result after capture drift", async () => {
    let current = capture;
    const pending = deferred<BreakpointCreationOwnership | null>();
    const rollback = vi.fn(async () => undefined);
    const ui = renderHook({
      addBreakpoint: vi.fn(() => pending.promise),
      readCapture: () => current,
    });

    expect(ui.api().addInlineBreakpoint()).toBe(true);
    expect(ui.api().addInlineBreakpoint()).toBe(false);
    current = { ...capture, modelVersion: 4 };
    await act(async () => {
      pending.resolve({
        breakpointId: "inline",
        columnNumber: 7,
        filePath: capture.documentPath,
        isCurrent: () => true,
        lineNumber: 4,
        rollback,
      });
      await pending.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rollback).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("fails closed when the two capture reads disagree", () => {
    let reads = 0;
    const ui = renderHook({
      readCapture: () => (reads++ === 0 ? capture : { ...capture, modelVersion: 4 }),
    });
    expect(ui.api().canAddInlineBreakpoint()).toBe(false);
    ui.unmount();
  });

  it("fails closed for an exact A-B-A return with a newer focus epoch", () => {
    let reads = 0;
    const returnedA = { ...capture, focusEpoch: 3 };
    const ui = renderHook({
      // The intervening B increments the epoch even though the second visible
      // capture returns to the exact same A model/version/cursor tuple.
      readCapture: () => (reads++ % 2 === 0 ? capture : returnedA),
    });
    expect(ui.api().canAddInlineBreakpoint()).toBe(false);
    expect(ui.api().addInlineBreakpoint()).toBe(false);
    ui.unmount();
  });

  it("rejects invalid or exhausted focus epochs", () => {
    for (const focusEpoch of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
      const ui = renderHook({ readCapture: () => ({ ...capture, focusEpoch }) });
      expect(ui.api().canAddInlineBreakpoint()).toBe(false);
      ui.unmount();
    }
  });
});
