// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExceptionTypeFilter } from "./ExceptionTypeFilter";

describe("ExceptionTypeFilter", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("reports an empty filter as off and adds a valid constructor name", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<ExceptionTypeFilter disabled={false} filter={[]} onChange={onChange} />),
    );

    expect(host.textContent).toContain("Off");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Exception type"]');
    act(() => {
      setInputValue(input, "errors.HttpError");
    });
    act(() => {
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onChange).toHaveBeenCalledWith(["errors.HttpError"]);
  });

  it("rejects duplicate constructor names and clears the draft with Escape", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <ExceptionTypeFilter disabled={false} filter={["TypeError"]} onChange={onChange} />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Exception type"]');
    act(() => {
      setInputValue(input, "TypeError");
    });
    act(() => {
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("already included");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(input?.value).toBe("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("removes entries and disables changes at the bound", () => {
    const onChange = vi.fn();
    const filter = Array.from({ length: 8 }, (_, index) => `Error${index}`);
    act(() =>
      root.render(<ExceptionTypeFilter disabled={false} filter={filter} onChange={onChange} />),
    );

    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Exception type"]')?.disabled,
    ).toBe(true);
    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Remove exception type Error0"]')
        ?.click();
    });
    expect(onChange).toHaveBeenCalledWith(filter.slice(1));
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
