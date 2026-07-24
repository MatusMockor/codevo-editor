// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NodeDebugAttachProcessPicker,
  type NodeDebugAttachProcessPickerCandidate,
  type NodeDebugAttachProcessPickerProps,
  type NodeDebugAttachProcessPickerResult,
} from "./NodeDebugAttachProcessPicker";

const apiCandidate = Object.freeze({
  presentationId: "candidate-1",
  label: "API process",
  detail: "Integrated terminal · 127.0.0.1:9229",
  port: 9229,
}) satisfies NodeDebugAttachProcessPickerCandidate;

const workerCandidate = Object.freeze({
  presentationId: "candidate-2",
  label: "Worker process",
  detail: "Integrated terminal · 127.0.0.1:9230",
  port: 9230,
}) satisfies NodeDebugAttachProcessPickerCandidate;

const readyResult = Object.freeze({
  status: "ok",
  candidates: Object.freeze([apiCandidate, workerCandidate]),
  truncated: false,
}) satisfies NodeDebugAttachProcessPickerResult;

function props(
  overrides: Partial<NodeDebugAttachProcessPickerProps> = {},
): NodeDebugAttachProcessPickerProps {
  return {
    onClose: vi.fn(),
    onManualPort: vi.fn(),
    onRetry: vi.fn(),
    onSelectCandidate: vi.fn(),
    open: true,
    result: readyResult,
    ...overrides,
  };
}

describe("NodeDebugAttachProcessPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(overrides: Partial<NodeDebugAttachProcessPickerProps> = {}) {
    const value = props(overrides);
    act(() => {
      root.render(<NodeDebugAttachProcessPicker {...value} />);
    });
    return value;
  }

  function key(target: Element, value: string, shiftKey = false) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value, shiftKey }));
    });
  }

  function search(value: string) {
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("selects only the active opaque presentation id from the search input", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;

    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(
      "Node.js processes",
    );
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].every(
        (option) => option.tabIndex === -1,
      ),
    ).toBe(true);

    key(input, "ArrowUp");
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "Worker process",
    );
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    key(input, "Enter");

    expect(value.onSelectCandidate).toHaveBeenCalledOnce();
    expect(value.onSelectCandidate).toHaveBeenCalledWith(workerCandidate.presentationId);
  });

  it("searches only presentation fields and resets keyboard selection", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;

    key(input, "ArrowDown");
    search("9229");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.querySelector('[role="option"]')?.textContent).toContain("API process");
    key(input, "Enter");
    expect(value.onSelectCandidate).toHaveBeenCalledWith(apiCandidate.presentationId);
  });

  it.each([
    [{ status: "ok", candidates: [], truncated: false }, "No debuggable Node.js processes found."],
    [{ status: "unavailable" }, "Process discovery is unavailable on this platform."],
    [{ status: "error" }, "Unable to list Node.js processes."],
  ] as const)("renders the closed %s state", (result, message) => {
    render({ result: Object.freeze(result) as NodeDebugAttachProcessPickerResult });
    expect(host.textContent).toContain(message);
  });

  it("announces loading and keeps manual port as a separate action", () => {
    const onManualPort = vi.fn();
    render({ onManualPort, result: null });
    expect(host.textContent).toContain("Searching for Node.js processes…");
    const manual = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Attach by port…",
    )!;
    act(() => manual.click());
    expect(onManualPort).toHaveBeenCalledOnce();
  });

  it("announces truncation and delegates retry without owning a reload", () => {
    const onRetry = vi.fn();
    const value = props({
      onRetry,
      result: Object.freeze({ ...readyResult, truncated: true }),
    });
    act(() => root.render(<NodeDebugAttachProcessPicker {...value} />));
    expect(host.textContent).toContain("More processes were found.");

    act(() =>
      root.render(
        <NodeDebugAttachProcessPicker
          {...value}
          result={Object.freeze({ status: "unavailable" })}
        />,
      ),
    );
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("closes with Escape and restores focus to the opener", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const value = render();
    expect(document.activeElement).not.toBe(opener);

    key(host.querySelector<HTMLElement>('[role="dialog"]')!, "Escape");
    expect(value.onClose).toHaveBeenCalledOnce();
    act(() => {
      root.render(<NodeDebugAttachProcessPicker {...value} open={false} />);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("selects the clicked item and scrolls keyboard-active options into view", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    const options = host.querySelectorAll<HTMLButtonElement>('[role="option"]');
    act(() => options[1]?.click());
    expect(value.onSelectCandidate).toHaveBeenCalledWith(workerCandidate.presentationId);

    key(input, "ArrowDown");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("does not treat Enter outside the search input as a candidate selection", () => {
    const value = render();
    const manual = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Attach by port…",
    )!;
    key(manual, "Enter");
    expect(value.onSelectCandidate).not.toHaveBeenCalled();
  });

  it("caps the deterministic search input", () => {
    render();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(input.maxLength).toBe(256);
  });
});
