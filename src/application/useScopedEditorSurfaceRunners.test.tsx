// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useScopedEditorSurfaceRunners,
  type EditorSurfaceRunners,
} from "./useScopedEditorSurfaceRunners";

describe("useScopedEditorSurfaceRunners", () => {
  it("routes runners through the active group and ignores inactive cleanup", async () => {
    const left = vi.fn();
    const right = vi.fn();
    const leftCapture = { readEditorCursorCapture: vi.fn(() => null) };
    const rightCapture = { readEditorCursorCapture: vi.fn(() => null) };
    const snapshots: EditorSurfaceRunners[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);

    function Harness() {
      const registry = useScopedEditorSurfaceRunners("left");
      useEffect(() => {
        registry.updateCommand("left", left);
        registry.updateCommand("right", right);
        registry.updateCursorCapture("left", leftCapture);
        registry.updateCursorCapture("right", rightCapture);
        registry.activateGroup("right");
        registry.updateCommand("left", null);
        registry.updateCursorCapture("left", null);
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
    expect(snapshots[snapshots.length - 1]?.cursorCapture).toBe(rightCapture);
    act(() => root.unmount());
  });

  it("republishes the exact group runners across an A-B-A return", () => {
    const root = createRoot(document.createElement("div"));
    let registry!: ReturnType<typeof useScopedEditorSurfaceRunners>;
    const captureA = { readEditorCursorCapture: vi.fn(() => null) };
    const captureB = { readEditorCursorCapture: vi.fn(() => null) };

    function Harness() {
      registry = useScopedEditorSurfaceRunners("a");
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => {
      registry.updateCursorCapture("a", captureA);
      registry.updateCursorCapture("b", captureB);
    });
    expect(registry.activeRunners.cursorCapture).toBe(captureA);

    act(() => registry.activateGroup("b"));
    expect(registry.activeRunners.cursorCapture).toBe(captureB);

    act(() => registry.focusGroup("a"));
    expect(registry.activeRunners.cursorCapture).toBe(captureA);
    act(() => root.unmount());
  });
});
