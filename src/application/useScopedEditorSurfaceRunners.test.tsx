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
    const snapshots: EditorSurfaceRunners[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);

    function Harness() {
      const registry = useScopedEditorSurfaceRunners("left");
      useEffect(() => {
        registry.updateCommand("left", left);
        registry.updateCommand("right", right);
        registry.activateGroup("right");
        registry.updateCommand("left", null);
      }, [registry.activateGroup, registry.updateCommand]);
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
    act(() => root.unmount());
  });
});
