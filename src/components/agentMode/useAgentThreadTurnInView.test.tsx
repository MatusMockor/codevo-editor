// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OBSERVED_AGENT_COLUMN_ENTRIES,
  sampledColumnTargets,
  useAgentThreadTurnInView,
} from "./useAgentThreadTurnInView";

class IntersectionFake {
  static instances: IntersectionFake[] = [];
  readonly targets: Element[] = [];
  readonly disconnect = vi.fn();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    IntersectionFake.instances.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  report(index: number): void {
    const target = this.targets[index];
    if (!target) throw new Error("Missing observed turn");
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class ResizeFake {
  static instances: ResizeFake[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  constructor(readonly callback: () => void) {
    ResizeFake.instances.push(this);
  }
}

let height = 200;
function Harness({ threadId, enabled = true }: { threadId: string; enabled?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = useAgentThreadTurnInView({
    scrollRef,
    threadId,
    enabled,
    columnSignature: "first,second",
  });
  return (
    <div>
      <output>{current}</output>
      <div
        ref={(element) => {
          scrollRef.current = element;
          if (element) {
            Object.defineProperties(element, {
              clientHeight: { configurable: true, get: () => height },
              clientWidth: { configurable: true, value: 1600 },
            });
          }
        }}
      >
        <article data-agent-column={`${threadId}-first`} />
        <article data-agent-column={`${threadId}-second`} />
      </div>
    </div>
  );
}

describe("turn in view scrollport ownership", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    height = 200;
    IntersectionFake.instances = [];
    ResizeFake.instances = [];
    vi.stubGlobal("IntersectionObserver", IntersectionFake);
    vi.stubGlobal("ResizeObserver", ResizeFake);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(threadId: string, enabled = true): void {
    act(() => root.render(<Harness threadId={threadId} enabled={enabled} />));
  }
  function observer(): IntersectionFake {
    const current = IntersectionFake.instances[IntersectionFake.instances.length - 1];
    if (!current) throw new Error("Missing intersection observer");
    return current;
  }
  function resize(): ResizeFake {
    const current = ResizeFake.instances[ResizeFake.instances.length - 1];
    if (!current) throw new Error("Missing resize observer");
    return current;
  }

  it("keeps a nonempty reading band in a wide short scrollport and updates it on resize", () => {
    render("A");
    expect(observer().options.rootMargin).toBe("-30px 0px -140px 0px");
    expect(observer().targets).toHaveLength(2);
    const previous = observer();
    act(() => previous.report(1));
    expect(host.querySelector("output")?.textContent).toBe("A-second");
    height = 400;
    act(() => resize().callback());
    expect(previous.disconnect).toHaveBeenCalledOnce();
    expect(observer().options.rootMargin).toBe("-60px 0px -280px 0px");
    act(() => observer().report(1));
    act(() => previous.report(0));
    expect(host.querySelector("output")?.textContent).toBe("A-second");
    act(() => resize().callback());
    expect(IntersectionFake.instances).toHaveLength(2);
  });

  it("ignores stale intersection and resize deliveries through A to B to A and disable", () => {
    render("A");
    const oldIntersection = observer();
    const oldResize = resize();
    render("B");
    render("A");
    expect(host.querySelector("output")?.textContent).toBe("");
    act(() => observer().report(1));
    height = 300;
    act(() => {
      oldIntersection.report(0);
      oldResize.callback();
    });
    expect(host.querySelector("output")?.textContent).toBe("A-second");
    expect(IntersectionFake.instances).toHaveLength(3);
    expect(oldResize.disconnect).toHaveBeenCalledOnce();
    const lastIntersection = observer();
    const lastResize = resize();
    render("A", false);
    act(() => {
      lastIntersection.report(0);
      lastResize.callback();
      window.dispatchEvent(new Event("resize"));
    });
    expect(host.querySelector("output")?.textContent).toBe("");
    expect(IntersectionFake.instances).toHaveLength(3);
    expect(lastResize.disconnect).toHaveBeenCalledOnce();
  });

  it("updates on window resize when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render("A");
    height = 600;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(observer().options.rootMargin).toBe("-90px 0px -420px 0px");
  });
});

describe("column observation budget", () => {
  it("observes every entry while the column fits the budget", () => {
    const entries = Array.from({ length: MAX_OBSERVED_AGENT_COLUMN_ENTRIES }, (_u, i) => i);

    expect(sampledColumnTargets(entries)).toBe(entries);
  });

  it("spreads the budget across the whole column instead of dropping the tail", () => {
    const total = MAX_OBSERVED_AGENT_COLUMN_ENTRIES * 3;
    const entries = Array.from({ length: total }, (_unused, index) => index);
    const picked = sampledColumnTargets(entries);

    expect(picked).toHaveLength(MAX_OBSERVED_AGENT_COLUMN_ENTRIES);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(total - 1);
    expect(new Set(picked).size).toBe(picked.length);
    expect([...picked]).toEqual([...picked].sort((left, right) => left - right));
  });

  it("reaches the live half of a column whose imported half alone fills the budget", () => {
    const imported = Array.from(
      { length: MAX_OBSERVED_AGENT_COLUMN_ENTRIES },
      (_unused, index) => `imported:${index}`,
    );
    const live = Array.from({ length: 40 }, (_unused, index) => `turn:t${index}`);
    const picked = sampledColumnTargets([...imported, ...live]);

    expect(picked.some((key) => key.startsWith("turn:"))).toBe(true);
    expect(picked[picked.length - 1]).toBe("turn:t39");
  });

  it("stays bounded for degenerate limits", () => {
    expect(sampledColumnTargets([1, 2, 3], 0)).toEqual([]);
    expect(sampledColumnTargets([1, 2, 3], 1)).toEqual([1]);
    expect(sampledColumnTargets([], 8)).toEqual([]);
  });
});
