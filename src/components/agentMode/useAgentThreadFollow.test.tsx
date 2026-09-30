// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentFollowsAfterScroll } from "./agentTranscriptAnchor";
import { AGENT_DISCLOSURE_HOLD_MS } from "./agentTranscriptFollowController";
import { useAgentThreadFollow, type AgentThreadFollow } from "./useAgentThreadFollow";

const VIEW_TOP = 100;
const VIEW_HEIGHT = 300;

class FakeTranscriptLayout {
  readonly container = document.createElement("div");
  readonly body = document.createElement("div");
  private readonly heights = new Map<Element, number>();
  private top = 0;
  private reportedTop = 0;
  private viewHeight = VIEW_HEIGHT;

  constructor() {
    this.container.append(this.body);
    Object.defineProperties(this.container, {
      scrollTop: {
        configurable: true,
        get: () => this.top,
        set: (value: number) => {
          this.top = Math.max(0, Math.min(value, this.maxTop()));
        },
      },
      scrollHeight: { configurable: true, get: () => this.height(this.body) },
      clientHeight: { configurable: true, get: () => this.viewHeight },
      clientTop: { configurable: true, value: 0 },
      getBoundingClientRect: {
        configurable: true,
        value: () => rect(VIEW_TOP, this.viewHeight),
      },
    });
    this.measure(this.body);
    document.body.append(this.container);
  }

  row(height: number, parent: Element = this.body, before: Element | null = null): HTMLElement {
    const element = document.createElement("div");
    this.heights.set(element, height);
    parent.insertBefore(element, before);
    this.measure(element);
    return element;
  }

  resize(element: Element, height: number): void {
    this.heights.set(element, height);
    this.clamp();
  }

  remove(element: Element): void {
    element.remove();
    this.clamp();
  }

  resizeView(height: number): void {
    this.viewHeight = height;
    this.clamp();
  }

  userScrollTo(top: number): void {
    this.container.scrollTop = top;
    this.frame();
  }

  viewportTop(element: Element): number {
    return element.getBoundingClientRect().top - VIEW_TOP;
  }

  maxTop(): number {
    return Math.max(0, this.height(this.body) - this.viewHeight);
  }

  frame(order: "scroll-first" | "layout-first" = "scroll-first"): void {
    act(() => {
      if (order === "layout-first") observers.forEach((callback) => callback());
      if (this.top !== this.reportedTop) {
        this.reportedTop = this.top;
        this.container.dispatchEvent(new Event("scroll"));
      }
      if (order === "scroll-first") observers.forEach((callback) => callback());
      this.reportedTop = this.top;
    });
  }

  scrollBy(delta: number): void {
    this.container.scrollTop = this.top + delta;
  }

  private clamp(): void {
    this.top = Math.max(0, Math.min(this.top, this.maxTop()));
  }

  private measure(element: Element): void {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(VIEW_TOP + this.offset(element) - this.top, this.height(element)),
    });
  }

  private height(element: Element): number {
    if (element.children.length === 0) return this.heights.get(element) ?? 0;
    let total = 0;
    for (const child of element.children) total += this.height(child);
    return total;
  }

  private offset(element: Element): number {
    const parent = element.parentElement;
    if (element === this.body || parent === null) return 0;
    let top = this.offset(parent);
    for (const sibling of parent.children) {
      if (sibling === element) break;
      top += this.height(sibling);
    }
    return top;
  }
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 600,
    width: 600,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

let observers: Array<() => void> = [];
let host: HTMLDivElement;
let root: Root;
let follow: AgentThreadFollow | null = null;
let clock = 0;

function Probe({
  container,
  revision,
}: {
  readonly container: HTMLDivElement;
  readonly revision: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(container);
  follow = useAgentThreadFollow({
    scrollRef,
    threadId: "agt-1",
    pageKey: null,
    lastTurn: null,
    contentRevision: revision,
    queuedPrompts: [],
    viewport: null,
    now: readClock,
  });
  return null;
}

function readClock(): number {
  return clock;
}

function mount(layout: FakeTranscriptLayout): (revision: number) => void {
  const render = (revision: number) =>
    act(() =>
      root.render(<Probe container={layout.container as HTMLDivElement} revision={revision} />),
    );
  render(0);
  layout.frame();
  return render;
}

function transcript(rowCount: number): {
  readonly layout: FakeTranscriptLayout;
  readonly rows: HTMLElement[];
} {
  const layout = new FakeTranscriptLayout();
  const rows = Array.from({ length: rowCount }, () => layout.row(100));
  return { layout, rows };
}

beforeEach(() => {
  observers = [];
  clock = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push(callback);
      }
      observe(): void {}
      disconnect(): void {
        observers = observers.filter((entry) => entry !== this.callback);
      }
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  follow = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("useAgentThreadFollow", () => {
  it("keeps a scrolled-up reader still while new items stream in below", () => {
    const { layout, rows } = transcript(10);
    const render = mount(layout);
    expect(layout.container.scrollTop).toBe(700);

    layout.userScrollTo(250);
    const reading = rows[2] as HTMLElement;
    const before = layout.viewportTop(reading);
    for (let revision = 1; revision <= 5; revision += 1) {
      layout.row(80);
      render(revision);
      layout.frame();
    }

    expect(layout.container.scrollTop).toBe(250);
    expect(layout.viewportTop(reading)).toBe(before);
    expect(follow?.atLatest).toBe(false);
    expect(follow?.unseenActivity).toBe(true);
  });

  it("compensates rows above the viewport that grow, shrink or re-render", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    layout.userScrollTo(350);
    const reading = rows[4] as HTMLElement;
    const before = layout.viewportTop(reading);

    layout.resize(rows[1] as HTMLElement, 260);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(before);

    layout.resize(rows[0] as HTMLElement, 40);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(before);

    const status = layout.row(24, layout.body, rows[2] as HTMLElement);
    layout.frame();
    layout.remove(status);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(before);

    layout.resize(rows[8] as HTMLElement, 400);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(before);
    expect(follow?.atLatest).toBe(false);
  });

  it("anchors inside a partly visible turn and falls back when the anchor is re-rendered", () => {
    const layout = new FakeTranscriptLayout();
    const turns = Array.from({ length: 6 }, () => layout.row(0));
    const blocks = turns.map((turn) => [layout.row(120, turn), layout.row(120, turn)]);
    mount(layout);
    layout.userScrollTo(380);
    const reading = blocks[1]?.[1] as HTMLElement;
    const before = layout.viewportTop(reading);

    const highlighted = layout.row(300, turns[1] as HTMLElement, blocks[1]?.[0] ?? null);
    layout.remove(blocks[1]?.[0] as HTMLElement);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(before);

    const turn = turns[1] as HTMLElement;
    const turnBefore = layout.viewportTop(turn);
    layout.row(160, turn, reading);
    layout.remove(reading);
    layout.resize(blocks[0]?.[0] as HTMLElement, 170);
    layout.frame();
    expect(layout.viewportTop(turn)).toBe(turnBefore);
    expect(layout.viewportTop(highlighted)).toBe(turnBefore);
  });

  it.each(["scroll-first", "layout-first"] as const)(
    "compensates a row above that grows in the same frame as a user scroll (%s)",
    (order) => {
      const { layout, rows } = transcript(10);
      mount(layout);
      layout.userScrollTo(350);
      const reading = rows[4] as HTMLElement;
      const before = layout.viewportTop(reading);

      layout.resize(rows[1] as HTMLElement, 260);
      layout.scrollBy(-50);
      layout.frame(order);

      expect(layout.viewportTop(reading)).toBe(before + 50);
      expect(follow?.atLatest).toBe(false);
    },
  );

  it.each(["scroll-first", "layout-first"] as const)(
    "does not double-compensate another writer that already kept the reader in place (%s)",
    (order) => {
      const { layout, rows } = transcript(10);
      mount(layout);
      layout.userScrollTo(350);
      const reading = rows[4] as HTMLElement;
      const before = layout.viewportTop(reading);

      layout.row(100, layout.body, rows[0] as HTMLElement);
      layout.row(100, layout.body, rows[0] as HTMLElement);
      layout.scrollBy(200);
      layout.frame(order);

      expect(layout.viewportTop(reading)).toBe(before);
      expect(follow?.atLatest).toBe(false);
    },
  );

  it("does not move a reader when the dock or composer below changes height", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    layout.userScrollTo(320);
    const reading = rows[3] as HTMLElement;
    const before = layout.viewportTop(reading);

    layout.resizeView(220);
    layout.frame();
    layout.resizeView(300);
    layout.frame();

    expect(layout.viewportTop(reading)).toBe(before);
  });

  it("stays pinned to the bottom while following and new output arrives", () => {
    const { layout } = transcript(10);
    const render = mount(layout);
    for (let revision = 1; revision <= 3; revision += 1) {
      layout.row(90);
      render(revision);
      layout.frame();
      expect(layout.container.scrollTop).toBe(layout.maxTop());
    }
    const last = layout.body.lastElementChild as HTMLElement;
    layout.resize(last, 400);
    layout.frame();
    expect(layout.container.scrollTop).toBe(layout.maxTop());
    expect(follow?.atLatest).toBe(true);
  });

  it("lets a small upward scroll escape following instead of snapping back", () => {
    const { layout, rows } = transcript(10);
    const render = mount(layout);
    layout.userScrollTo(layout.maxTop() - 8);
    const reading = rows[8] as HTMLElement;
    const before = layout.viewportTop(reading);

    layout.row(60);
    render(1);
    layout.frame();

    expect(layout.viewportTop(reading)).toBe(before);
    expect(follow?.atLatest).toBe(false);
  });

  it("releases following as soon as the wheel scrolls up", () => {
    const { layout } = transcript(10);
    mount(layout);
    act(() => {
      layout.container.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
    });
    expect(follow?.atLatest).toBe(false);
    expect(follow?.pinnedRef.current).toBe(false);
  });

  it("keeps following on a horizontal swipe with vertical jitter", () => {
    const { layout } = transcript(10);
    mount(layout);
    act(() => {
      layout.container.dispatchEvent(new WheelEvent("wheel", { deltaX: -24, deltaY: -2 }));
    });
    expect(follow?.atLatest).toBe(true);
  });

  it("keeps following when the wheel scrolls a nested output pane", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    const pane = layout.row(80, rows[9] as HTMLElement);
    Object.defineProperty(pane, "scrollTop", { configurable: true, value: 40 });
    act(() => {
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -4, bubbles: true }));
    });
    expect(follow?.atLatest).toBe(true);
  });

  it("does not flip following when a live row near the bottom disappears and returns", () => {
    const { layout, rows } = transcript(10);
    const live = layout.row(30);
    const render = mount(layout);
    layout.userScrollTo(layout.maxTop() - 20);
    const reading = rows[8] as HTMLElement;

    layout.remove(live);
    render(1);
    layout.frame();
    expect(follow?.atLatest).toBe(false);
    const settled = layout.viewportTop(reading);

    layout.row(30);
    render(2);
    layout.frame();
    expect(layout.viewportTop(reading)).toBe(settled);
    expect(follow?.atLatest).toBe(false);
  });

  it("keeps following when content shrinks under a pinned view", () => {
    const { layout } = transcript(10);
    const live = layout.row(30);
    mount(layout);
    layout.remove(live);
    layout.frame();
    expect(follow?.atLatest).toBe(true);
    layout.row(50);
    layout.frame();
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("resumes following when the user scrolls back to the bottom", () => {
    const { layout } = transcript(10);
    const render = mount(layout);
    layout.userScrollTo(200);
    expect(follow?.atLatest).toBe(false);

    layout.userScrollTo(layout.maxTop() - 10);
    expect(follow?.atLatest).toBe(true);

    layout.row(120);
    render(1);
    layout.frame();
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("jumps to the latest output and follows again", () => {
    const { layout } = transcript(10);
    const render = mount(layout);
    layout.userScrollTo(100);
    layout.row(120);
    render(1);
    layout.frame();
    expect(follow?.unseenActivity).toBe(true);

    act(() => follow?.jumpToLatest());
    expect(layout.container.scrollTop).toBe(layout.maxTop());
    expect(follow?.atLatest).toBe(true);
    expect(follow?.unseenActivity).toBe(false);

    layout.row(120);
    render(2);
    layout.frame();
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("keeps a clicked fold header in place while reading above", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    layout.userScrollTo(330);
    const fold = rows[5] as HTMLElement;
    const header = layout.row(30, fold);
    header.setAttribute("aria-expanded", "false");
    const body = layout.row(0, fold);
    layout.resize(rows[2] as HTMLElement, 100);
    layout.frame();
    const before = layout.viewportTop(header);

    act(() => header.click());
    layout.resize(body, 500);
    layout.resize(rows[1] as HTMLElement, 180);
    layout.frame();

    expect(layout.viewportTop(header)).toBe(before);
  });

  it("keeps a fold clicked at the bottom in place and stops following", () => {
    const { layout, rows } = transcript(10);
    const render = mount(layout);
    const fold = rows[9] as HTMLElement;
    const header = layout.row(30, fold);
    header.setAttribute("aria-expanded", "false");
    const body = layout.row(0, fold);
    layout.frame();
    const before = layout.viewportTop(header);

    act(() => header.click());
    layout.resize(body, 600);
    render(1);
    layout.frame();

    expect(layout.viewportTop(header)).toBe(before);
    expect(follow?.atLatest).toBe(false);
  });

  it("keeps following when a fold clicked at the bottom does not push past the viewport", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    const fold = rows[9] as HTMLElement;
    const header = layout.row(30, fold);
    header.setAttribute("aria-expanded", "true");
    const body = layout.row(200, fold);
    layout.frame();

    act(() => header.click());
    layout.resize(body, 0);
    layout.frame();

    expect(follow?.atLatest).toBe(true);
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("keeps following when a fold clicked at the bottom grows only slightly", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    const fold = rows[9] as HTMLElement;
    const header = layout.row(30, fold);
    header.setAttribute("aria-expanded", "false");
    const body = layout.row(0, fold);
    layout.frame();

    act(() => header.click());
    layout.resize(body, 12);
    layout.frame();

    expect(follow?.atLatest).toBe(true);
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("ignores a stale fold click once its hold has expired", () => {
    const { layout, rows } = transcript(10);
    mount(layout);
    const header = layout.row(30, rows[9] as HTMLElement);
    header.setAttribute("aria-expanded", "false");
    layout.frame();

    act(() => header.click());
    clock += AGENT_DISCLOSURE_HOLD_MS + 1;
    layout.row(200);
    layout.frame();

    expect(follow?.atLatest).toBe(true);
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });
});

describe("agentFollowsAfterScroll", () => {
  it("releases on any upward user scroll that leaves the bottom", () => {
    expect(agentFollowsAfterScroll({ following: true, movedBy: -3, distanceFromBottom: 3 })).toBe(
      false,
    );
  });

  it("keeps the current state when a clamp moves the view up but it stays at the bottom", () => {
    expect(agentFollowsAfterScroll({ following: true, movedBy: -30, distanceFromBottom: 0 })).toBe(
      true,
    );
    expect(agentFollowsAfterScroll({ following: false, movedBy: -30, distanceFromBottom: 0 })).toBe(
      false,
    );
  });

  it("follows again when the user scrolls down near the bottom", () => {
    expect(agentFollowsAfterScroll({ following: false, movedBy: 40, distanceFromBottom: 20 })).toBe(
      true,
    );
    expect(
      agentFollowsAfterScroll({ following: false, movedBy: 40, distanceFromBottom: 200 }),
    ).toBe(false);
  });
});
