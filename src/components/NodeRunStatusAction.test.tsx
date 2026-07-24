// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunStatusPresentation } from "../application/nodeRunWithoutDebuggingPresentation";
import { NodeRunStatusAction } from "./NodeRunStatusAction";

describe("NodeRunStatusAction", () => {
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

  it("exposes the lifecycle label and stops an active run", async () => {
    const onStop = vi.fn();
    await render(status({ label: "Node: Running", phase: "running" }), onStop);

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("Stop Node run — Running");
    expect(button?.textContent).toBe("Node: Running");
    expect(button?.getAttribute("aria-live")).toBe("polite");

    await act(async () => button?.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("disables duplicate stop actions while stopping", async () => {
    const onStop = vi.fn();
    await render(
      status({
        canStop: false,
        label: "Node: Stopping",
        phase: "stopping",
        stopLabel: "Node run is stopping",
      }),
      onStop,
    );

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("enables an accessible retry after stop fails", async () => {
    const onStop = vi.fn();
    await render(
      status({
        label: "Node: Stop failed",
        phase: "stopping",
        stopLabel: "Retry stopping Node run",
      }),
      onStop,
    );

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-label")).toBe("Retry stopping Node run");
    await act(async () => button?.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  async function render(current: NodeRunStatusPresentation, onStop: () => void) {
    await act(async () => {
      root.render(<NodeRunStatusAction onStop={onStop} status={current} />);
    });
  }
});

function status(overrides: Partial<NodeRunStatusPresentation> = {}): NodeRunStatusPresentation {
  return {
    canStop: true,
    label: "Node: Running",
    phase: "running",
    stopLabel: "Stop Node run — Running",
    ...overrides,
  };
}
