// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompactComposerControls } from "./useCompactComposerControls";

describe("useCompactComposerControls", () => {
  let callbacks: ResizeObserverCallback[];
  let disconnectCount: number;
  let host: HTMLDivElement;
  let originalInnerWidth: PropertyDescriptor | undefined;
  let originalResizeObserver: PropertyDescriptor | undefined;
  let originalMatchMedia: PropertyDescriptor | undefined;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    callbacks = [];
    disconnectCount = 0;
    host = document.createElement("div");
    document.body.append(host);
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
    originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    root = createRoot(host);

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }

      disconnect(): void {
        disconnectCount += 1;
      }

      observe(): void {}

      unobserve(): void {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restoreProperty(window, "innerWidth", originalInnerWidth);
    restoreProperty(globalThis, "ResizeObserver", originalResizeObserver);
    restoreProperty(window, "matchMedia", originalMatchMedia);
  });

  it("uses a compact center at a wide viewport", () => {
    stubViewport(1_200, false);
    renderProbe(412);

    expect(host.textContent).toBe("compact");
  });

  it("uses a wide center at a compact viewport and follows center resizes", () => {
    stubViewport(600, true);
    renderProbe(650);

    expect(host.textContent).toBe("wide");

    center().dataset.inlineSize = "412";
    deliverResize();

    expect(host.textContent).toBe("compact");
  });

  it("disconnects its owner and ignores a stale callback after unmount", () => {
    stubViewport(1_200, false);
    renderProbe(412);
    expect(callbacks).toHaveLength(1);
    const staleCallback = callbacks[0];

    act(() => root.unmount());

    expect(disconnectCount).toBe(1);
    expect(() => staleCallback?.([], {} as ResizeObserver)).not.toThrow();
  });

  it("isolates concurrent composers to their own center", () => {
    stubViewport(1_200, false);
    act(() =>
      root.render(
        <>
          <CenterProbe inlineSize={412} name="first" />
          <CenterProbe inlineSize={650} name="second" />
        </>,
      ),
    );

    expect(probe("first").textContent).toBe("compact");
    expect(probe("second").textContent).toBe("wide");

    center("first").dataset.inlineSize = "700";
    act(() => callbacks[0]?.([], {} as ResizeObserver));

    expect(probe("first").textContent).toBe("wide");
    expect(probe("second").textContent).toBe("wide");

    center("first").dataset.inlineSize = "300";
    act(() => callbacks[1]?.([], {} as ResizeObserver));
    expect(probe("first").textContent).toBe("wide");

    act(() => callbacks[0]?.([], {} as ResizeObserver));
    expect(probe("first").textContent).toBe("compact");
  });

  function Probe() {
    const ownerRef = useRef<HTMLDivElement>(null);
    const compact = useCompactComposerControls(ownerRef);
    return <div ref={ownerRef}>{compact ? "compact" : "wide"}</div>;
  }

  function CenterProbe({
    inlineSize,
    name,
  }: {
    readonly inlineSize: number;
    readonly name: string;
  }) {
    return (
      <div
        className="agent-mode__center"
        data-center={name}
        data-inline-size={inlineSize}
        ref={(element) => {
          if (element === null) return;
          element.getBoundingClientRect = () => measureElement(element);
        }}
      >
        <Probe />
      </div>
    );
  }

  function center(name?: string): HTMLElement {
    const selector = name === undefined ? ".agent-mode__center" : `[data-center="${name}"]`;
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function probe(name: string): HTMLElement {
    const element = center(name).firstElementChild;
    expect(element).toBeInstanceOf(HTMLElement);
    return element as HTMLElement;
  }

  function deliverResize(): void {
    act(() => callbacks[0]?.([], {} as ResizeObserver));
  }

  function renderProbe(inlineSize: number): void {
    act(() =>
      root.render(
        <div
          className="agent-mode__center"
          data-inline-size={inlineSize}
          ref={(element) => {
            if (element === null) return;
            element.getBoundingClientRect = () => measureElement(element);
          }}
        >
          <Probe />
        </div>,
      ),
    );
  }

  function stubViewport(width: number, compact: boolean): void {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener: vi.fn(),
        matches: compact,
        removeEventListener: vi.fn(),
      }),
    });
  }
});

function restoreProperty(
  target: typeof globalThis | Window,
  property: "ResizeObserver" | "innerWidth" | "matchMedia",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function measureElement(element: HTMLElement): DOMRect {
  const width = Number(element.dataset.inlineSize ?? "0");
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
    x: 0,
    y: 0,
  };
}
