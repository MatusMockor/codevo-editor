// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useViewportWidth } from "./useViewportWidth";

describe("useViewportWidth", () => {
  let resizeElement: Map<Element, () => void>;

  beforeEach(() => {
    resizeElement = new Map();
    class ResizeObserverMock {
      readonly callback: ResizeObserverCallback;
      readonly targets = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      disconnect() {
        for (const target of this.targets) resizeElement.delete(target);
        this.targets.clear();
      }

      observe(target: Element) {
        this.targets.add(target);
        resizeElement.set(target, () => this.callback([], this as unknown as ResizeObserver));
      }

      unobserve(target: Element) {
        this.targets.delete(target);
        resizeElement.delete(target);
      }
    }
    Object.assign(globalThis, { ResizeObserver: ResizeObserverMock });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("isolates two owning frames while their widths change independently", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_280 });
    const frameA = sizedElement(900);
    const frameB = sizedElement(1_180);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);

    function Harness() {
      const widthA = useViewportWidth(frameA);
      const widthB = useViewportWidth(frameB);
      return (
        <>
          <output data-frame="a">{widthA}</output>
          <output data-frame="b">{widthB}</output>
        </>
      );
    }

    act(() => root.render(<Harness />));
    expect(host.querySelector('[data-frame="a"]')?.textContent).toBe("900");
    expect(host.querySelector('[data-frame="b"]')?.textContent).toBe("1180");

    setElementWidth(frameA, 720);
    act(() => resizeElement.get(frameA)?.());
    expect(host.querySelector('[data-frame="a"]')?.textContent).toBe("720");
    expect(host.querySelector('[data-frame="b"]')?.textContent).toBe("1180");

    setElementWidth(frameB, 1_000);
    act(() => resizeElement.get(frameB)?.());
    expect(host.querySelector('[data-frame="a"]')?.textContent).toBe("720");
    expect(host.querySelector('[data-frame="b"]')?.textContent).toBe("1000");

    act(() => root.unmount());
  });
});

function sizedElement(width: number): HTMLElement {
  const element = document.body.appendChild(document.createElement("section"));
  setElementWidth(element, width);
  return element;
}

function setElementWidth(element: HTMLElement, width: number): void {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
}
