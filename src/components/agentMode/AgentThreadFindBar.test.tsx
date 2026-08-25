// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentThreadFindBar, type AgentThreadFindBarProps } from "./AgentThreadFindBar";

describe("AgentThreadFindBar", () => {
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
  });

  it("shows the current position of the hit list", () => {
    render({ hitCount: 12, currentIndex: 2 });

    const count = host.querySelector('[role="status"]');
    expect(count?.textContent).toBe("3 of 12");
    expect(count?.getAttribute("aria-live")).toBe("polite");
  });

  it("states the empty and pending searches truthfully", () => {
    render({ hitCount: 0, currentIndex: -1 });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No results");

    render({ hitCount: 0, currentIndex: -1, pending: true });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Searching…");
  });

  it("exposes the capped hit count instead of pretending it is complete", () => {
    render({ hitCount: 500, currentIndex: 0, truncated: true });

    expect(host.querySelector(".agent-find__note")?.textContent).toBe("first 500");
  });

  it("steps forward and backward with the chevron buttons", () => {
    const onNavigate = vi.fn();
    render({ hitCount: 3, currentIndex: 1, onNavigate });

    clickLabel("Next match");
    expect(onNavigate).toHaveBeenLastCalledWith(2);

    clickLabel("Previous match");
    expect(onNavigate).toHaveBeenLastCalledWith(0);
  });

  it("wraps around both ends of the hit list", () => {
    const onNavigate = vi.fn();
    render({ hitCount: 3, currentIndex: 2, onNavigate });
    clickLabel("Next match");
    expect(onNavigate).toHaveBeenLastCalledWith(0);

    render({ hitCount: 3, currentIndex: 0, onNavigate });
    clickLabel("Previous match");
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it("starts at the first hit when nothing is selected yet", () => {
    const onNavigate = vi.fn();
    render({ hitCount: 4, currentIndex: -1, onNavigate });

    clickLabel("Next match");

    expect(onNavigate).toHaveBeenLastCalledWith(0);
  });

  it("moves with Enter and Shift+Enter", () => {
    const onNavigate = vi.fn();
    render({ hitCount: 3, currentIndex: 0, onNavigate });

    press("Enter", false);
    expect(onNavigate).toHaveBeenLastCalledWith(1);

    press("Enter", true);
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it("never navigates without hits", () => {
    const onNavigate = vi.fn();
    render({ hitCount: 0, currentIndex: -1, onNavigate });

    press("Enter", false);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(buttonLabelled("Next match")?.disabled).toBe(true);
    expect(buttonLabelled("Previous match")?.disabled).toBe(true);
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render({ onClose });

    press("Escape", false);
    expect(onClose).toHaveBeenCalledTimes(1);

    clickLabel("Close find bar");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("clips the typed query at the domain bound and reports it", () => {
    const onChangeQuery = vi.fn();
    render({ onChangeQuery });

    const input = requireInput();
    expect(input.maxLength).toBe(200);

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "parser",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChangeQuery).toHaveBeenCalledWith("parser");
  });

  function press(key: string, shiftKey: boolean): void {
    const input = requireInput();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }));
    });
  }

  function buttonLabelled(label: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  }

  function clickLabel(label: string): void {
    const button = buttonLabelled(label);
    expect(button).not.toBeNull();
    act(() => button?.click());
  }

  function requireInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(".agent-find__input");
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function render(overrides: Partial<AgentThreadFindBarProps> = {}): void {
    act(() => root.render(<AgentThreadFindBar {...defaults()} {...overrides} />));
  }
});

function defaults(): AgentThreadFindBarProps {
  return {
    currentIndex: 0,
    hitCount: 1,
    onChangeQuery: () => undefined,
    onClose: () => undefined,
    onNavigate: () => undefined,
    query: "",
  };
}
