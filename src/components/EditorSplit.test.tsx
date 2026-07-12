// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSplit } from "./EditorSplit";

describe("EditorSplit", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("exposes separator ARIA and resizes by keyboard", () => {
    const onResize = vi.fn();
    act(() => root.render(
      <EditorSplit onResize={onResize} orientation="horizontal" sizes={[0.5, 0.5]} splitPath={[1]}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </EditorSplit>,
    ));
    const separator = required(host, "[role='separator']");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe("10");
    expect(separator.getAttribute("aria-valuemax")).toBe("90");
    expect(separator.getAttribute("aria-valuenow")).toBe("50");

    act(() => separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })));
    expect(onResize).toHaveBeenLastCalledWith([1], [0.52, 0.48]);
    act(() => separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft", shiftKey: true })));
    expect(onResize).toHaveBeenLastCalledWith([1], [0.4, 0.6]);
    act(() => separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    expect(onResize).toHaveBeenLastCalledWith([1], [0.1, 0.9]);
    act(() => separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]?.[1][0]).toBeCloseTo(0.9);
  });

  it("resizes by pointer position and removes listeners after pointerup", () => {
    const onResize = vi.fn();
    act(() => root.render(
      <EditorSplit onResize={onResize} orientation="vertical" sizes={[0.5, 0.5]} splitPath={[]}>
        {[<div key="a" />, <div key="b" />]}
      </EditorSplit>,
    ));
    const split = required(host, ".editor-split");
    vi.spyOn(split, "getBoundingClientRect").mockReturnValue(rectangle());
    const separator = required(host, "[role='separator']");
    act(() => {
      separator.dispatchEvent(pointer("pointerdown", { button: 0 }));
      window.dispatchEvent(pointer("pointermove", { clientY: 75 }));
      window.dispatchEvent(pointer("pointerup", {}));
      window.dispatchEvent(pointer("pointermove", { clientY: 20 }));
    });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith([], [0.75, 0.25]);
  });
});

function required(host: ParentNode, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
function pointer(type: string, values: Record<string, number>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  return event;
}
function rectangle(): DOMRect {
  return { bottom: 100, height: 100, left: 0, right: 100, top: 0, width: 100, x: 0, y: 0, toJSON: () => ({}) };
}
