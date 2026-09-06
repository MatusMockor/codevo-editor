// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  DEFAULT_AGENT_RAIL_WIDTH,
  MAX_AGENT_RAIL_WIDTH,
  MIN_AGENT_RAIL_WIDTH,
} from "../../domain/agentWorkbenchLayout";
import { AgentRailResizeHandle } from "./AgentRailResizeHandle";
import {
  AGENT_RAIL_RESIZE_LABEL,
  AGENT_RAIL_RESIZE_STEP,
  AGENT_RAIL_WIDTH_VARIABLE,
} from "./agentRailResize";

interface PointerInit {
  readonly clientX: number;
  readonly pointerId?: number;
  readonly button?: number;
  readonly buttons?: number;
}

describe("AgentRailResizeHandle", () => {
  let host: HTMLDivElement;
  let frame: HTMLDivElement;
  let root: Root;
  let onResize: Mock<(width: number) => void>;
  let onReset: Mock<() => void>;
  const captured = new Set<number>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    captured.clear();
    host = document.createElement("div");
    frame = document.createElement("div");
    frame.className = "editor-workbench";
    host.append(frame);
    document.body.append(host);
    root = createRoot(frame);
    onResize = vi.fn();
    onReset = vi.fn();
    Object.assign(Element.prototype, {
      setPointerCapture(pointerId: number) {
        captured.add(pointerId);
      },
      releasePointerCapture(pointerId: number) {
        captured.delete(pointerId);
      },
      hasPointerCapture(pointerId: number) {
        return captured.has(pointerId);
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("exposes a bounded vertical separator for the rail width", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    const handle = separator();
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe(AGENT_RAIL_RESIZE_LABEL);
    expect(handle.getAttribute("aria-valuemin")).toBe(String(MIN_AGENT_RAIL_WIDTH));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(MAX_AGENT_RAIL_WIDTH));
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_AGENT_RAIL_WIDTH));
    expect(handle.tabIndex).toBe(0);
  });

  it("reports the clamped width for an out-of-range value", () => {
    render(9000);

    expect(separator().getAttribute("aria-valuenow")).toBe(String(MAX_AGENT_RAIL_WIDTH));
  });

  it("previews every move on the frame variable and commits once on release", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    expect(captured.has(1)).toBe(true);

    for (const clientX of [310, 330, 348, 360]) press("pointermove", { clientX });

    expect(onResize).not.toHaveBeenCalled();
    expect(previewWidth()).toBe(`${DEFAULT_AGENT_RAIL_WIDTH + 60}px`);

    press("pointerup", { clientX: 360, buttons: 0 });

    expect(onResize.mock.calls).toEqual([[DEFAULT_AGENT_RAIL_WIDTH + 60]]);
    expect(previewWidth()).toBe("");
    expect(captured.has(1)).toBe(false);
  });

  it("clamps the preview to the supported bounds", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 3000 });
    expect(previewWidth()).toBe(`${MAX_AGENT_RAIL_WIDTH}px`);

    press("pointermove", { clientX: 0 });
    expect(previewWidth()).toBe(`${MIN_AGENT_RAIL_WIDTH}px`);

    press("pointerup", { clientX: 0, buttons: 0 });
    expect(onResize.mock.calls).toEqual([[MIN_AGENT_RAIL_WIDTH]]);
  });

  it("commits nothing when the pointer never moved", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointerup", { clientX: 300, buttons: 0 });

    expect(onResize).not.toHaveBeenCalled();
    expect(previewWidth()).toBe("");
  });

  it("discards the drag on pointer cancel and keeps the preview off the frame", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 360 });
    press("pointercancel", { clientX: 360 });

    expect(onResize).not.toHaveBeenCalled();
    expect(previewWidth()).toBe("");
    expect(captured.has(1)).toBe(false);
  });

  it("commits the drag when the capture is lost to the browser", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 340 });
    press("lostpointercapture", { clientX: 340 });

    expect(onResize.mock.calls).toEqual([[DEFAULT_AGENT_RAIL_WIDTH + 40]]);
    expect(previewWidth()).toBe("");
  });

  it("settles a drag whose buttons were released outside the window", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 340 });
    press("pointermove", { clientX: 400, buttons: 0 });

    expect(onResize.mock.calls).toEqual([[DEFAULT_AGENT_RAIL_WIDTH + 40]]);

    press("pointermove", { clientX: 500 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("settles a drag when the window loses focus", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 340 });
    act(() => void window.dispatchEvent(new Event("blur")));

    expect(onResize.mock.calls).toEqual([[DEFAULT_AGENT_RAIL_WIDTH + 40]]);
    expect(previewWidth()).toBe("");

    press("pointermove", { clientX: 500 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("ignores a drag that never started, a foreign pointer and a secondary button", () => {
    render(DEFAULT_AGENT_RAIL_WIDTH);

    press("pointermove", { clientX: 500 });
    expect(onResize).not.toHaveBeenCalled();

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 500, pointerId: 7 });
    expect(previewWidth()).toBe("");

    press("pointerup", { clientX: 300, buttons: 0 });
    press("pointerdown", { clientX: 300, button: 2 });
    expect(captured.size).toBe(0);
  });

  it("steps the width with the arrow keys and jumps to the bounds with Home and End", () => {
    render(300);

    key("ArrowLeft");
    key("ArrowRight");
    key("Home");
    key("End");
    key("Tab");

    expect(onResize.mock.calls).toEqual([
      [300 - AGENT_RAIL_RESIZE_STEP],
      [300 + AGENT_RAIL_RESIZE_STEP],
      [MIN_AGENT_RAIL_WIDTH],
      [MAX_AGENT_RAIL_WIDTH],
    ]);
  });

  it("resets the width on a double click and drops any preview first", () => {
    render(400);

    press("pointerdown", { clientX: 300 });
    press("pointerup", { clientX: 300, buttons: 0 });
    act(() => void separator().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();
    expect(previewWidth()).toBe("");
    expect(captured.size).toBe(0);
  });

  it("keeps the committed rail variable untouched so the frame keeps publishing it", () => {
    frame.style.setProperty("--agent-rail-committed", "384px");
    render(384);

    press("pointerdown", { clientX: 300 });
    press("pointermove", { clientX: 340 });
    press("pointerup", { clientX: 340, buttons: 0 });

    expect(frame.style.getPropertyValue("--agent-rail-committed")).toBe("384px");
    expect(previewWidth()).toBe("");
  });

  function previewWidth(): string {
    return frame.style.getPropertyValue(AGENT_RAIL_WIDTH_VARIABLE);
  }

  function key(name: string): void {
    act(() => {
      separator().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: name }));
    });
  }

  function press(type: string, init: PointerInit): void {
    const event = new MouseEvent(type, { bubbles: true, button: init.button ?? 0 });
    Object.defineProperty(event, "clientX", { value: init.clientX });
    Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
    Object.defineProperty(event, "buttons", { value: init.buttons ?? 1 });
    act(() => void separator().dispatchEvent(event));
  }

  function separator(): HTMLElement {
    const handle = frame.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();
    return handle as HTMLElement;
  }

  function render(width: number): void {
    act(() => {
      root.render(<AgentRailResizeHandle onReset={onReset} onResize={onResize} width={width} />);
    });
  }
});
