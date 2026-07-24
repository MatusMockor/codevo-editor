// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeRunWithoutDebuggingPickerAction } from "./NodeRunWithoutDebuggingPickerAction";

describe("NodeRunWithoutDebuggingPickerAction", () => {
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

  it("renders an accessible native keyboard button and only opens the picker", () => {
    const openPicker = vi.fn();
    const startTarget = vi.fn();
    act(() =>
      root.render(
        <NodeRunWithoutDebuggingPickerAction
          command={
            {
              args: ["--private-argument"],
              canOpenPicker: () => true,
              env: { PRIVATE_TOKEN: "must-not-render" },
              openPicker,
              startTarget,
            } as never
          }
        />,
      ),
    );

    const action = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Select and start without debugging"]',
    );
    expect(action).not.toBeNull();
    expect(action?.type).toBe("button");
    expect(action?.title).toBe("Run: Select and Start Without Debugging");
    expect(action?.disabled).toBe(false);
    action?.focus();
    expect(document.activeElement).toBe(action);

    act(() => action?.click());
    expect(openPicker).toHaveBeenCalledOnce();
    expect(startTarget).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("--private-argument");
    expect(host.textContent).not.toContain("must-not-render");
    expect(host.innerHTML).not.toContain("PRIVATE_TOKEN");
  });

  it("is disabled when the live owner-safe command cannot open", () => {
    const openPicker = vi.fn();
    act(() =>
      root.render(
        <NodeRunWithoutDebuggingPickerAction
          command={{ canOpenPicker: () => false, openPicker }}
        />,
      ),
    );

    const action = host.querySelector<HTMLButtonElement>("button");
    expect(action?.disabled).toBe(true);
    act(() => action?.click());
    expect(openPicker).not.toHaveBeenCalled();
  });

  it("rechecks a true-to-false availability drift at the click boundary", () => {
    let available = true;
    const openPicker = vi.fn();
    act(() =>
      root.render(
        <NodeRunWithoutDebuggingPickerAction
          command={{ canOpenPicker: () => available, openPicker }}
        />,
      ),
    );

    const action = host.querySelector<HTMLButtonElement>("button")!;
    expect(action.disabled).toBe(false);
    available = false;
    act(() => action.click());
    expect(openPicker).not.toHaveBeenCalled();
  });
});
