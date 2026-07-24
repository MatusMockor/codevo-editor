// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuProps } from "./ContextMenu";

describe("ContextMenu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(overrides: Partial<ContextMenuProps> = {}) {
    const props: ContextMenuProps = {
      ariaLabel: "Value actions",
      items: [
        { id: "copy", label: "Copy", onSelect: vi.fn() },
        { id: "inspect", label: "Inspect", onSelect: vi.fn() },
      ],
      onClose: vi.fn(),
      position: { x: 40, y: 60 },
      ...overrides,
    };

    act(() => root.render(<ContextMenu {...props} />));
    return props;
  }

  function menu(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[role="menu"]');
    if (!element) throw new Error("Context menu was not found.");
    return element;
  }

  function items(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  it("portals the labelled menu to document.body and focuses its first item", () => {
    render();

    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(menu().parentElement).toBe(document.body);
    expect(menu().getAttribute("aria-label")).toBe("Value actions");
    expect(items().map((item) => item.textContent)).toEqual(["Copy", "Inspect"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("clamps the menu inside the viewport with the existing eight-pixel margin", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);

    render({ position: { x: -100, y: -100 } });
    expect(menu().style.left).toBe("8px");
    expect(menu().style.top).toBe("8px");

    render({ position: { x: window.innerWidth + 100, y: window.innerHeight + 100 } });

    expect(menu().style.left).toBe(`${window.innerWidth - 128}px`);
    expect(menu().style.top).toBe(`${window.innerHeight - 88}px`);
  });

  it("wraps focus with ArrowDown and ArrowUp", () => {
    render();
    const [first, second] = items();

    act(() =>
      first?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    expect(document.activeElement).toBe(second);
    act(() =>
      second?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    expect(document.activeElement).toBe(first);
    act(() =>
      first?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })),
    );
    expect(document.activeElement).toBe(second);
  });

  it("closes on Escape and prevents its default action", () => {
    const onClose = vi.fn();
    render({ onClose });
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });

    act(() => document.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on outside mousedown but ignores mousedown inside the portal", () => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => menu().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["blur", "resize"])("closes on window %s", (eventName) => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => window.dispatchEvent(new Event(eventName)));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes before selecting the item", () => {
    const calls: string[] = [];
    render({
      items: [{ id: "copy", label: "Copy", onSelect: () => calls.push("select") }],
      onClose: () => calls.push("close"),
    });

    act(() => items()[0]?.click());

    expect(calls).toEqual(["close", "select"]);
  });
});
