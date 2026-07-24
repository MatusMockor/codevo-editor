// @vitest-environment jsdom

import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { isLocalDebugCopyShortcut } from "./debugCopyValueSurface";

const copyEvent = {
  altKey: false,
  ctrlKey: true,
  key: "c",
  metaKey: false,
  shiftKey: false,
} as KeyboardEvent<HTMLElement>;

describe("local debug Copy shortcut", () => {
  it("fails closed when selection authority is missing, null, or throws", () => {
    const original = window.getSelection;
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: undefined,
    });
    expect(isLocalDebugCopyShortcut(copyEvent)).toBe(false);

    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("selection unavailable");
      }),
    });
    expect(isLocalDebugCopyShortcut(copyEvent)).toBe(false);

    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: vi.fn(() => null),
    });
    expect(isLocalDebugCopyShortcut(copyEvent)).toBe(false);
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: original,
    });
  });

  it("accepts only a collapsed selection and leaves selected text to native Copy", () => {
    const selection = vi.spyOn(window, "getSelection");
    selection.mockReturnValue({ isCollapsed: true } as Selection);
    expect(isLocalDebugCopyShortcut(copyEvent)).toBe(true);
    selection.mockReturnValue({ isCollapsed: false } as Selection);
    expect(isLocalDebugCopyShortcut(copyEvent)).toBe(false);
    selection.mockRestore();
  });
});
