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

  it("focuses the documented global-name input from its visible add action", () => {
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[]}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onSetEnabled={vi.fn()}
        />,
      );
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Function name"]');
    expect(input?.placeholder).toBe("globalThis.handler");
    expect(input?.getAttribute("aria-describedby")).toBe("function-breakpoint-help");
    act(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Add function breakpoint"]')
        ?.click(),
    );
    expect(document.activeElement).toBe(input);
    expect(host.querySelector("#function-breakpoint-help")?.textContent).toContain(
      "global function name",
    );
  });

  it("renders unresolved verification and updates to the filled verified indicator", () => {
    const render = (verified: boolean) =>
      act(() => {
        root.render(
          <FunctionBreakpoints
            breakpoints={[{ id: "fn-1", functionName: "app.render", enabled: true, verified }]}
            onAdd={vi.fn()}
            onRemove={vi.fn()}
            onSetEnabled={vi.fn()}
          />,
        );
      });

    render(false);
    const unverified = host.querySelector<HTMLElement>(
      '[role="img"][aria-label="Unverified function breakpoint app.render - function not resolved yet"]',
    );
    expect(unverified?.title).toBe("Unverified - function not resolved yet");
    expect(unverified?.style.background).toBe("transparent");
    expect(unverified?.style.border).toBe("1.5px solid var(--color-text-muted)");

    render(true);
    const verified = host.querySelector<HTMLElement>(
      '[role="img"][aria-label="Verified function breakpoint app.render"]',
    );
    expect(verified).toBe(unverified);
    expect(verified?.title).toBe("Verified function breakpoint");
    expect(verified?.style.background).toBe("var(--color-error)");
    expect(verified?.style.border).toBe("");
  });

  it("renders an unknown verification state as pending instead of verified", () => {
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[{ id: "fn-1", functionName: "globalThis.handler", enabled: true }]}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onSetEnabled={vi.fn()}
        />,
      );
    });

    const pending = host.querySelector<HTMLElement>(
      '[role="img"][aria-label="Pending function breakpoint globalThis.handler - verification pending"]',
    );
    expect(pending?.dataset.status).toBe("pending");
    expect(pending?.title).toBe("Pending verification");
    expect(pending?.style.background).toBe("transparent");
    expect(pending?.style.border).toBe("1.5px dashed var(--color-text-muted)");
    expect(host.querySelector('[aria-label^="Verified function breakpoint"]')).toBeNull();
  });

  it("labels disabled entries truthfully regardless of their last verification", () => {
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[
            {
              id: "fn-1",
              functionName: "globalThis.handler",
              enabled: false,
              verified: false,
            },
          ]}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onSetEnabled={vi.fn()}
        />,
      );
    });

    const indicator = host.querySelector<HTMLElement>(
      '[role="img"][aria-label="Disabled function breakpoint globalThis.handler"]',
    );
    expect(indicator?.dataset.status).toBe("disabled");
    expect(indicator?.title).toBe("Disabled function breakpoint");
    expect(
      host.querySelector('[aria-label^="Unverified function breakpoint globalThis.handler"]'),
    ).toBeNull();
  });

  it("disables every mutation control for an untrusted workspace", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const onSetEnabled = vi.fn();
    act(() => {
      root.render(
        <FunctionBreakpoints
          breakpoints={[{ id: "fn-1", functionName: "globalThis.handler", enabled: true }]}
          disabled
          onAdd={onAdd}
          onRemove={onRemove}
          onSetEnabled={onSetEnabled}
        />,
      );
    });

    const controls = [
      host.querySelector<HTMLButtonElement>('button[aria-label="Add function breakpoint"]'),
      host.querySelector<HTMLInputElement>('input[aria-label="Function name"]'),
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Enable function breakpoint globalThis.handler"]',
      ),
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove function breakpoint globalThis.handler"]',
      ),
    ];
    expect(controls.every((control) => control?.disabled === true)).toBe(true);
    controls.forEach((control) => act(() => control?.click()));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onSetEnabled).not.toHaveBeenCalled();
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input?.dispatchEvent(new Event("input", { bubbles: true }));
}
