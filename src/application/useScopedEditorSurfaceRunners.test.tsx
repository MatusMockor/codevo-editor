// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  nextDebugInlineBreakpointFocusEpoch,
  useScopedEditorSurfaceRunners,
  type EditorSurfaceRunners,
} from "./useScopedEditorSurfaceRunners";

describe("useScopedEditorSurfaceRunners", () => {
  it("routes runners through the active group and ignores inactive cleanup", async () => {
    const left = vi.fn();
    const right = vi.fn();
    const leftCapture = { readDebugWatchAtCursorCapture: vi.fn(() => null) };
    const rightCapture = { readDebugWatchAtCursorCapture: vi.fn(() => null) };
    const leftEvaluate = { readDebugEvaluateInConsoleCapture: vi.fn(() => null) };
    const rightEvaluate = { readDebugEvaluateInConsoleCapture: vi.fn(() => null) };
    const leftBreakpointNavigation = { readDebugBreakpointNavigationCapture: vi.fn(() => null) };
    const rightBreakpointNavigation = { readDebugBreakpointNavigationCapture: vi.fn(() => null) };
    const leftInlineBreakpoint = inlineReader("left");
    const rightInlineBreakpoint = inlineReader("right");
    const snapshots: EditorSurfaceRunners[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);

    function Harness() {
      const registry = useScopedEditorSurfaceRunners("left");
      useEffect(() => {
        registry.updateCommand("left", left);
        registry.updateCommand("right", right);
        registry.updateDebugWatchAtCursorCapture("left", leftCapture);
        registry.updateDebugWatchAtCursorCapture("right", rightCapture);
        registry.updateDebugEvaluateInConsoleCapture("left", leftEvaluate);
        registry.updateDebugEvaluateInConsoleCapture("right", rightEvaluate);
        registry.updateDebugBreakpointNavigationCapture("left", leftBreakpointNavigation);
        registry.updateDebugBreakpointNavigationCapture("right", rightBreakpointNavigation);
        registry.updateDebugInlineBreakpointCapture("left", leftInlineBreakpoint);
        registry.updateDebugInlineBreakpointCapture("right", rightInlineBreakpoint);
        registry.activateGroup("right");
        registry.updateCommand("left", null);
        registry.updateDebugWatchAtCursorCapture("left", null);
        registry.updateDebugEvaluateInConsoleCapture("left", null);
        registry.updateDebugBreakpointNavigationCapture("left", null);
        registry.updateDebugInlineBreakpointCapture("left", null);
      }, [registry]);
      useEffect(() => {
        snapshots.push(registry.activeRunners);
      }, [registry.activeRunners]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(snapshots[snapshots.length - 1]?.command).toBe(right);
    expect(snapshots[snapshots.length - 1]?.debugWatchAtCursorCapture).toBe(rightCapture);
    expect(snapshots[snapshots.length - 1]?.debugEvaluateInConsoleCapture).toBe(rightEvaluate);
    expect(snapshots[snapshots.length - 1]?.debugBreakpointNavigationCapture).toBe(
      rightBreakpointNavigation,
    );
    expect(
      snapshots[
        snapshots.length - 1
      ]?.debugInlineBreakpointCapture?.readDebugInlineBreakpointCapture()?.workspaceOwnerKey,
    ).toBe("right");
    act(() => root.unmount());
  });

  it("assigns unreused focus epochs across an exact A-B-A return", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let registry!: ReturnType<typeof useScopedEditorSurfaceRunners>;

    function Harness() {
      registry = useScopedEditorSurfaceRunners("a");
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => {
      registry.updateDebugInlineBreakpointCapture("a", inlineReader("a"));
      registry.updateDebugInlineBreakpointCapture("b", inlineReader("b"));
    });
    const firstA = registry.activeRunners.debugInlineBreakpointCapture;
    const epochA = firstA?.readDebugInlineBreakpointCapture()?.focusEpoch;

    act(() => registry.activateGroup("b"));
    const epochB =
      registry.activeRunners.debugInlineBreakpointCapture?.readDebugInlineBreakpointCapture()
        ?.focusEpoch;
    expect(firstA?.readDebugInlineBreakpointCapture()).toBeNull();

    act(() => registry.activateGroup("a"));
    const returnedA =
      registry.activeRunners.debugInlineBreakpointCapture?.readDebugInlineBreakpointCapture();
    expect([epochA, epochB, returnedA?.focusEpoch]).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(epochA!).toBeLessThan(epochB!);
    expect(epochB!).toBeLessThan(returnedA!.focusEpoch);
    expect(returnedA?.workspaceOwnerKey).toBe("a");
    act(() => root.unmount());
  });

  it("fails closed at the bounded focus epoch instead of wrapping or reusing it", () => {
    expect(nextDebugInlineBreakpointFocusEpoch(4_294_967_294)).toBe(4_294_967_295);
    expect(nextDebugInlineBreakpointFocusEpoch(4_294_967_295)).toBeNull();
    expect(nextDebugInlineBreakpointFocusEpoch(0)).toBeNull();
  });

  it("never republishes an exhausted inline reader after unrelated runner updates", () => {
    const root = createRoot(document.createElement("div"));
    let registry!: ReturnType<typeof useScopedEditorSurfaceRunners>;
    const command = vi.fn();

    function Harness() {
      registry = useScopedEditorSurfaceRunners("a", 4_294_967_295);
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => registry.updateDebugInlineBreakpointCapture("a", inlineReader("a")));
    expect(registry.activeRunners.debugInlineBreakpointCapture).toBeNull();

    act(() => registry.updateCommand("a", command));
    expect(registry.activeRunners.command).toBe(command);
    expect(registry.activeRunners.debugInlineBreakpointCapture).toBeNull();

    act(() => registry.focusGroup("a"));
    expect(registry.activeRunners.debugInlineBreakpointCapture).toBeNull();
    act(() => root.unmount());
  });
});

function inlineReader(workspaceOwnerKey: string) {
  return {
    readDebugInlineBreakpointCapture: vi.fn(() => ({
      columnNumber: 4,
      documentPath: "/workspace/app.ts",
      focusEpoch: 1,
      focused: true as const,
      lineNumber: 2,
      modelIdentity: "model",
      modelVersion: 1,
      workspaceOwnerKey,
      workspaceRoot: "/workspace",
      writable: true as const,
    })),
  };
}
