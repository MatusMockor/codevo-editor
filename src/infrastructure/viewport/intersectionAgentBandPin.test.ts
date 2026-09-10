// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBandPin } from "../../application/agentBandPin";
import { createIntersectionAgentBandPin } from "./intersectionAgentBandPin";

interface FakeEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly boundingClientRect: { readonly top: number };
  readonly rootBounds: { readonly top: number; readonly height: number } | null;
}

const created: FakeInstance[] = [];

class FakeInstance {
  readonly targets = new Set<Element>();
  disconnects = 0;

  constructor(
    readonly deliver: (entries: ReadonlyArray<FakeEntry>) => void,
    readonly options: { root: Element | null; threshold: number },
  ) {
    created.push(this);
  }

  observe(element: Element): void {
    this.targets.add(element);
  }

  unobserve(element: Element): void {
    this.targets.delete(element);
  }

  disconnect(): void {
    this.disconnects += 1;
    this.targets.clear();
  }
}

function install(): void {
  Reflect.set(globalThis, "IntersectionObserver", FakeInstance);
}

function entry(target: Element, isIntersecting: boolean, top: number, rootTop: number): FakeEntry {
  return {
    target,
    isIntersecting,
    boundingClientRect: { top },
    rootBounds: { top: rootTop, height: 600 },
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  created.length = 0;
});

describe("intersection agent band pin", () => {
  it("reports no observer when the platform has no IntersectionObserver", () => {
    expect(createIntersectionAgentBandPin(() => null)).toBeNull();
  });

  it("observes the sentinel inside the resolved scroll root", () => {
    install();
    const root = document.createElement("div");
    const sentinel = document.createElement("span");
    const pin = createIntersectionAgentBandPin(() => root);

    pin?.observe(sentinel, () => undefined);

    expect(created).toHaveLength(1);
    expect(created[0]?.options.root).toBe(root);
    expect([...(created[0]?.targets ?? [])]).toEqual([sentinel]);
  });

  it("reports the pin state each time the sentinel crosses the top edge", () => {
    install();
    const sentinel = document.createElement("span");
    const states: AgentBandPin[] = [];
    const pin = createIntersectionAgentBandPin(() => null);
    pin?.observe(sentinel, (state) => states.push(state));
    const observer = created[0];

    observer?.deliver([entry(sentinel, false, -20, 0)]);
    observer?.deliver([entry(sentinel, true, 10, 0)]);
    observer?.deliver([entry(sentinel, false, 900, 0)]);

    expect(states).toEqual(["pinned", "released", "released"]);
  });

  it("treats a scroll port without geometry as released", () => {
    install();
    const sentinel = document.createElement("span");
    const states: AgentBandPin[] = [];
    const pin = createIntersectionAgentBandPin(() => null);
    pin?.observe(sentinel, (state) => states.push(state));

    created[0]?.deliver([
      {
        target: sentinel,
        isIntersecting: false,
        boundingClientRect: { top: 0 },
        rootBounds: { top: 0, height: 0 },
      },
    ]);

    expect(states).toEqual(["released"]);
  });

  it("never reports after the caller unsubscribes or the observer is disposed", () => {
    install();
    const first = document.createElement("span");
    const second = document.createElement("span");
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const pin = createIntersectionAgentBandPin(() => null);
    const stop = pin?.observe(first, onFirst);
    pin?.observe(second, onSecond);
    const observer = created[0];

    stop?.();
    observer?.deliver([entry(first, false, -10, 0)]);
    expect(onFirst).not.toHaveBeenCalled();

    pin?.dispose();
    observer?.deliver([entry(second, false, -10, 0)]);

    expect(onSecond).not.toHaveBeenCalled();
    expect(observer?.disconnects).toBe(1);
  });
});
