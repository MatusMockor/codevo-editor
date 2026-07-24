// @vitest-environment jsdom

import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWindowedRows,
  type WindowedRowsInput,
  type WindowedRowsResult,
} from "./useWindowedRows";

describe("useWindowedRows", () => {
  let animationFrame: ReturnType<typeof installAnimationFrameMock>;
  let geometry: ReturnType<typeof mockElementGeometry>;
  let host: HTMLDivElement;
  let resizeObserver: ReturnType<typeof installResizeObserverMock>;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    animationFrame = installAnimationFrameMock();
    geometry = mockElementGeometry();
    resizeObserver = installResizeObserverMock();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resizeObserver.restore();
    geometry.restore();
    animationFrame.restore();
  });

  it("renders only the windowed slice plus overscan for uniform rows", () => {
    geometry.setHeight(100);
    const hook = renderWindowedRows(root, animationFrame, uniformInput({ itemCount: 100 }));

    act(() => {
      hook.element.scrollTop = 400;
      hook.current.onScroll(scrollEvent(hook.element));
      animationFrame.flush();
    });

    expect(hook.current.rows.map((row) => row.index)).toEqual(
      Array.from({ length: 21 }, (_value, index) => index + 12),
    );
    expect(hook.current.windowOffsetTop).toBe(240);
    expect(hook.current.totalHeight).toBe(2_000);
  });

  it("corrects estimated offsets after a row measurement changes", () => {
    geometry.setHeight(60);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 10, overscan: 0 }),
    );
    const row = measuredElement(40);

    act(() => hook.current.measureRow("row-0", row));

    expect(hook.current.totalHeight).toBe(220);
    expect(hook.current.rows).toEqual([
      { index: 0, offsetTop: 0, pinned: false },
      { index: 1, offsetTop: 40, pinned: false },
    ]);
  });

  it("ignores zero-height row measurements", () => {
    geometry.setHeight(60);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 10, overscan: 0 }),
    );

    act(() => hook.current.measureRow("row-0", measuredElement(0)));

    expect(hook.current.totalHeight).toBe(200);
    expect(hook.current.rows).toEqual([
      { index: 0, offsetTop: 0, pinned: false },
      { index: 1, offsetTop: 20, pinned: false },
      { index: 2, offsetTop: 40, pinned: false },
    ]);
  });

  it("keeps pinned indices mounted outside the scroll window", () => {
    geometry.setHeight(60);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 100, overscan: 0, pinnedIndices: [90] }),
    );

    expect(hook.current.rows).toEqual([
      { index: 0, offsetTop: 0, pinned: false },
      { index: 1, offsetTop: 20, pinned: false },
      { index: 2, offsetTop: 40, pinned: false },
      { index: 90, offsetTop: 1_800, pinned: true },
    ]);
  });

  it("deduplicates pinned indices and ignores invalid pinned indices", () => {
    geometry.setHeight(60);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({
        itemCount: 100,
        overscan: 0,
        pinnedIndices: [1, 90, 90, -1, 100],
      }),
    );

    expect(hook.current.rows).toEqual([
      { index: 0, offsetTop: 0, pinned: false },
      { index: 1, offsetTop: 20, pinned: false },
      { index: 2, offsetTop: 40, pinned: false },
      { index: 90, offsetTop: 1_800, pinned: true },
    ]);
  });

  it("uses variable height boundaries for windowing and scroll alignment", () => {
    geometry.setHeight(30);
    const heights = [10, 30, 20, 40, 50];
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({
        estimateHeight: (index) => heights[index] ?? 0,
        itemCount: heights.length,
        overscan: 0,
      }),
    );

    act(() => {
      hook.element.scrollTop = 10;
      hook.current.onScroll(scrollEvent(hook.element));
      animationFrame.flush();
    });

    expect(hook.current.rows).toEqual([{ index: 1, offsetTop: 10, pinned: false }]);
    expect(hook.current.windowOffsetTop).toBe(10);
    expect(hook.current.totalHeight).toBe(150);

    act(() => hook.current.scrollToIndex(3, "start"));
    expect(hook.element.scrollTop).toBe(60);

    act(() => hook.current.scrollToIndex(3, "end"));
    expect(hook.element.scrollTop).toBe(70);
  });

  it("clamps scrollToIndex and aligns nearest, start, and end", () => {
    geometry.setHeight(60);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 10, overscan: 0 }),
    );

    act(() => hook.current.scrollToIndex(-4, "start"));
    expect(hook.element.scrollTop).toBe(0);

    act(() => hook.current.scrollToIndex(99, "end"));
    expect(hook.element.scrollTop).toBe(140);

    act(() => hook.current.scrollToIndex(4, "start"));
    expect(hook.element.scrollTop).toBe(80);

    act(() => hook.current.scrollToIndex(5, "nearest"));
    expect(hook.element.scrollTop).toBe(80);

    hook.element.scrollTop = 0;
    act(() => hook.current.scrollToIndex(4, "nearest"));
    expect(hook.element.scrollTop).toBe(40);

    act(() => hook.current.scrollToIndex(4, "end"));
    expect(hook.element.scrollTop).toBe(40);
  });

  it("reports pinned-to-bottom within the tolerance band", () => {
    geometry.setHeight(100);
    geometry.setScrollHeight(500);
    const hook = renderWindowedRows(root, animationFrame, uniformInput());

    hook.element.scrollTop = 396;
    expect(hook.current.isPinnedToBottom()).toBe(true);

    hook.element.scrollTop = 395;
    expect(hook.current.isPinnedToBottom()).toBe(false);
  });

  it("scrolls to the bottom and reports pinned-to-bottom", () => {
    geometry.setHeight(100);
    geometry.setScrollHeight(500);
    const hook = renderWindowedRows(root, animationFrame, uniformInput({ itemCount: 25 }));

    act(() => hook.current.scrollToBottom());

    expect(hook.element.scrollTop).toBe(400);
    expect(hook.current.isPinnedToBottom()).toBe(true);
  });

  it("handles an empty item list", () => {
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 0, pinnedIndices: [0] }),
    );

    expect(hook.current.rows).toEqual([]);
    expect(hook.current.totalHeight).toBe(0);
    expect(() => act(() => hook.current.scrollToIndex(0, "start"))).not.toThrow();
    expect(hook.element.scrollTop).toBe(0);
  });

  it("renders every row when disabled", () => {
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ enabled: false, itemCount: 12 }),
    );

    act(() => hook.current.measureRow("row-0", measuredElement(80)));

    expect(hook.current.rows).toEqual(
      Array.from({ length: 12 }, (_value, index) => ({
        index,
        offsetTop: index * 20,
        pinned: false,
      })),
    );
    expect(hook.current.totalHeight).toBe(240);
    expect(hook.current.windowOffsetTop).toBe(0);
  });

  it("clears measurements when the container width changes", () => {
    geometry.setHeight(60);
    geometry.setWidth(240);
    const hook = renderWindowedRows(
      root,
      animationFrame,
      uniformInput({ itemCount: 10, overscan: 0 }),
    );

    act(() => hook.current.measureRow("row-0", measuredElement(40)));
    expect(hook.current.totalHeight).toBe(220);

    geometry.setWidth(320);
    act(() => resizeObserver.trigger());

    expect(hook.current.totalHeight).toBe(200);
    expect(hook.current.rows[1]?.offsetTop).toBe(20);
  });
});

interface WindowedRowsHarness {
  readonly current: WindowedRowsResult;
  readonly element: HTMLDivElement;
}

function renderWindowedRows(
  root: Root,
  animationFrame: ReturnType<typeof installAnimationFrameMock>,
  input: WindowedRowsInput,
): WindowedRowsHarness {
  let current: WindowedRowsResult | null = null;

  function Harness(): ReactElement {
    const result = useWindowedRows(input);
    current = result;

    return createElement("div", { ref: result.containerRef });
  }

  act(() => root.render(createElement(Harness)));
  act(() => animationFrame.flush());

  const element = document.querySelector<HTMLDivElement>("body > div:last-child > div");

  if (!current || !element) {
    throw new Error("Windowed rows harness did not render.");
  }

  return {
    get current() {
      if (!current) {
        throw new Error("Windowed rows result is unavailable.");
      }

      return current;
    },
    element,
  };
}

function uniformInput(overrides: Partial<WindowedRowsInput> = {}): WindowedRowsInput {
  return {
    enabled: true,
    estimateHeight: () => 20,
    itemCount: 20,
    keyForIndex: (index) => `row-${index}`,
    ...overrides,
  };
}

function scrollEvent(element: HTMLElement): React.UIEvent<HTMLElement> {
  return { currentTarget: element } as React.UIEvent<HTMLElement>;
}

function measuredElement(height: number): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: height,
  });

  return element;
}

function installAnimationFrameMock() {
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;

  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);

      return handle;
    }),
    writable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    writable: true,
  });

  return {
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();

      for (const callback of pendingCallbacks) {
        callback(0);
      }
    },
    restore() {
      callbacks.clear();
      restoreProperty(globalThis, "requestAnimationFrame", originalRequestAnimationFrame);
      restoreProperty(globalThis, "cancelAnimationFrame", originalCancelAnimationFrame);
    },
  };
}

function installResizeObserverMock() {
  const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const callbacks = new Set<ResizeObserverCallback>();

  class MockResizeObserver {
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.add(callback);
    }

    disconnect(): void {
      callbacks.delete(this.callback);
    }

    observe(): void {}

    unobserve(): void {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
    writable: true,
  });

  return {
    restore() {
      callbacks.clear();
      restoreProperty(globalThis, "ResizeObserver", originalResizeObserver);
    },
    trigger() {
      for (const callback of callbacks) {
        callback([], {} as ResizeObserver);
      }
    },
  };
}

function mockElementGeometry() {
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  let height = 360;
  let scrollHeight = 0;
  let width = 240;

  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: {
      configurable: true,
      get: () => height,
    },
    clientWidth: {
      configurable: true,
      get: () => width,
    },
    scrollHeight: {
      configurable: true,
      get: () => scrollHeight,
    },
  });

  return {
    restore() {
      restoreProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      restoreProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
      restoreProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    },
    setHeight(nextHeight: number) {
      height = nextHeight;
    },
    setScrollHeight(nextScrollHeight: number) {
      scrollHeight = nextScrollHeight;
    },
    setWidth(nextWidth: number) {
      width = nextWidth;
    },
  };
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  Reflect.deleteProperty(target, property);
}
