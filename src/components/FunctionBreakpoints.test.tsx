// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionBreakpoints } from "./FunctionBreakpoints";

describe("FunctionBreakpoints", () => {
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

  it("commits valid names with Enter and reports injection-shaped input inline", () => {
    const onAdd = vi.fn();
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[]}
          onAdd={onAdd}
          onRemove={vi.fn()}
          onSetEnabled={vi.fn()}
        />,
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Function name"]');
    act(() => setInputValue(input, "app.render()"));
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("dotted path");
    expect(onAdd).not.toHaveBeenCalled();

    act(() => setInputValue(input, "app.render"));
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("app.render");
    expect(input?.value).toBe("");
  });

  it("toggles, removes, and lets Escape cancel input", () => {
    const onRemove = vi.fn();
    const onSetEnabled = vi.fn();
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[{ id: "fn-1", functionName: "app.render", enabled: true }]}
          onAdd={vi.fn()}
          onRemove={onRemove}
          onSetEnabled={onSetEnabled}
        />,
      );
    });
    const checkbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="Enable function breakpoint app.render"]',
    );
    act(() => checkbox?.click());
    expect(onSetEnabled).toHaveBeenCalledWith("fn-1", false);
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove function breakpoint app.render"]',
        )
        ?.click(),
    );
    expect(onRemove).toHaveBeenCalledWith("fn-1");

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Function name"]');
    act(() => setInputValue(input, "draft"));
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input?.value).toBe("");
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input?.dispatchEvent(new Event("input", { bubbles: true }));
}
