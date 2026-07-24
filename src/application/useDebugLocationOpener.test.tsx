// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebugLocationOpener } from "./useDebugLocationOpener";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDebugLocationOpener", () => {
  it("forwards an exact column, commit guard, and Promise<boolean> result", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const captured: { current: ReturnType<typeof useDebugLocationOpener> | null } = {
      current: null,
    };

    function Harness() {
      captured.current = useDebugLocationOpener(openNavigationTarget);
      return null;
    }

    act(() => root.render(<Harness />));
    if (!captured.current) throw new Error("hook did not render");
    const shouldCommit = vi.fn(() => true);
    const exact = captured.current("/workspace/src/routes.ts", 7, 13, shouldCommit);
    const defaultColumn = captured.current("/workspace/src/default.ts", 3);

    await expect(exact).resolves.toBe(true);
    await expect(defaultColumn).resolves.toBe(true);

    expect(openNavigationTarget).toHaveBeenNthCalledWith(
      1,
      "/workspace/src/routes.ts",
      { column: 13, lineNumber: 7 },
      "/workspace/src/routes.ts",
      { shouldCommit },
    );
    expect(openNavigationTarget).toHaveBeenNthCalledWith(
      2,
      "/workspace/src/default.ts",
      { column: 1, lineNumber: 3 },
      "/workspace/src/default.ts",
      undefined,
    );
    act(() => root.unmount());
  });
});
