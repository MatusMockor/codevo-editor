// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { OpenEditorsSwitcher } from "./OpenEditorsSwitcher";

describe("OpenEditorsSwitcher", () => {
  it("portals the switcher outside the surface stacking context and cleans up on close", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const surface = document.createElement("div");
    surface.dataset.slot = "surface";
    document.body.append(surface);
    const root = createRoot(surface);
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    const entries = [{ name: "index.ts", path: "/project/index.ts" }];
    const render = (isOpen: boolean) =>
      act(() =>
        root.render(
          <OpenEditorsSwitcher
            activeIndex={0}
            entries={entries}
            isOpen={isOpen}
            onCancel={onCancel}
            onSelect={onSelect}
          />,
        ),
      );
    try {
      render(true);
      const backdrop = document.body.querySelector<HTMLElement>(".palette-backdrop");
      expect(backdrop?.parentElement).toBe(document.body);
      expect(surface.querySelector(".palette-backdrop")).toBeNull();
      const option = backdrop?.querySelector<HTMLElement>('[role="option"]');
      act(() => option?.click());
      expect(onSelect).toHaveBeenCalledWith("/project/index.ts");
      act(() => backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
      expect(onCancel).toHaveBeenCalledOnce();
      render(false);
      expect(document.body.querySelector(".palette-backdrop")).toBeNull();
    } finally {
      act(() => root.unmount());
      surface.remove();
    }
  });
});
