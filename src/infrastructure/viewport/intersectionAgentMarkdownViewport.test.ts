// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_MARKDOWN_VIEWPORT_MARGIN_PX,
  AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
  isWithinAgentMarkdownViewport,
} from "../../application/agentMarkdownViewport";
import { createIntersectionAgentMarkdownViewport } from "./intersectionAgentMarkdownViewport";

interface FakeEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
}

const created: FakeInstance[] = [];

class FakeInstance {
  readonly targets = new Set<Element>();
  disconnects = 0;

  constructor(
    readonly deliver: (entries: ReadonlyArray<FakeEntry>) => void,
    readonly options: { root: Element | null; rootMargin: string },
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

function uninstall(): void {
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  created.length = 0;
}

function stubRect(element: Element, band: { readonly top: number; readonly bottom: number }): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...band, height: band.bottom - band.top, left: 0, right: 0, width: 0 }),
  });
}

const attached: Element[] = [];

function mounted(tag: "div" | "button"): HTMLElement {
  const element = document.createElement(tag);
  document.body.append(element);
  attached.push(element);
  return element;
}

function stubVisibility(element: Element, visible: () => boolean): void {
  Object.defineProperty(element, "checkVisibility", { configurable: true, value: visible });
}

afterEach(() => {
  uninstall();
  attached.splice(0).forEach((element) => element.remove());
});

describe("intersection agent markdown viewport", () => {
  it("reports no port when the platform has no IntersectionObserver", () => {
    expect(createIntersectionAgentMarkdownViewport(() => null)).toBeNull();
  });

  it("observes inside the resolved scroll root with a generous margin", () => {
    install();
    const root = document.createElement("div");
    const element = document.createElement("p");
    const viewport = createIntersectionAgentMarkdownViewport(() => root);
    expect(viewport).not.toBeNull();

    viewport?.observe(element, () => undefined);

    expect(created).toHaveLength(1);
    expect(created[0]?.options.root).toBe(root);
    expect(created[0]?.options.rootMargin).toBe(AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN);
    expect([...(created[0]?.targets ?? [])]).toEqual([element]);
  });

  it("measures the same band the observer margin declares", () => {
    const declared = Number.parseInt(AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN, 10);
    expect(AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN).toBe(`${declared}px 0px`);
    const root = { top: 0, bottom: 800 };

    expect(isWithinAgentMarkdownViewport({ top: 400, bottom: 500 }, root)).toBe(true);
    expect(isWithinAgentMarkdownViewport({ top: -declared, bottom: -declared }, root)).toBe(true);
    expect(isWithinAgentMarkdownViewport({ top: -declared - 1, bottom: -declared - 1 }, root)).toBe(
      false,
    );
    expect(
      isWithinAgentMarkdownViewport({ top: root.bottom + declared, bottom: 9_999 }, root),
    ).toBe(true);
    expect(
      isWithinAgentMarkdownViewport({ top: root.bottom + declared + 1, bottom: 9_999 }, root),
    ).toBe(false);
    expect(declared).toBe(AGENT_MARKDOWN_VIEWPORT_MARGIN_PX);
  });

  it("reports containment against the resolved scroll root", () => {
    install();
    const root = document.createElement("div");
    const element = document.createElement("p");
    stubRect(root, { top: 0, bottom: 800 });
    stubRect(element, { top: 4_000, bottom: 4_100 });
    const viewport = createIntersectionAgentMarkdownViewport(() => root);

    expect(viewport?.contains(element)).toBe(false);

    stubRect(element, { top: 900, bottom: 1_000 });
    expect(viewport?.contains(element)).toBe(true);
  });

  it("delivers an entry once and stops observing that element", () => {
    install();
    const element = document.createElement("p");
    const onEnter = vi.fn();
    const viewport = createIntersectionAgentMarkdownViewport(() => null);
    viewport?.observe(element, onEnter);
    const observer = created[0];

    observer?.deliver([{ target: element, isIntersecting: false }]);
    expect(onEnter).not.toHaveBeenCalled();

    observer?.deliver([{ target: element, isIntersecting: true }]);
    observer?.deliver([{ target: element, isIntersecting: true }]);

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(observer?.targets.size).toBe(0);
  });

  it("never calls back after the caller unsubscribes or the port is disposed", () => {
    install();
    const first = document.createElement("p");
    const second = document.createElement("p");
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const viewport = createIntersectionAgentMarkdownViewport(() => null);
    const stop = viewport?.observe(first, onFirst);
    viewport?.observe(second, onSecond);
    const observer = created[0];

    stop?.();
    observer?.deliver([{ target: first, isIntersecting: true }]);
    expect(onFirst).not.toHaveBeenCalled();

    viewport?.dispose();
    observer?.deliver([{ target: second, isIntersecting: true }]);

    expect(onSecond).not.toHaveBeenCalled();
    expect(observer?.disconnects).toBe(1);
  });

  it("remeasures the waiting set and enters only what the band now covers", () => {
    install();
    const root = document.createElement("div");
    const near = document.createElement("p");
    const far = document.createElement("p");
    const onNear = vi.fn();
    const onFar = vi.fn();
    stubRect(root, { top: 0, bottom: 100 });
    stubRect(near, { top: 4_000, bottom: 4_100 });
    stubRect(far, { top: 9_000, bottom: 9_100 });
    const viewport = createIntersectionAgentMarkdownViewport(() => root);
    viewport?.observe(near, onNear);
    viewport?.observe(far, onFar);
    const observer = created[0];

    viewport?.remeasure();
    expect(onNear).not.toHaveBeenCalled();
    expect(onFar).not.toHaveBeenCalled();

    stubRect(near, { top: 50, bottom: 150 });
    viewport?.remeasure();

    expect(onNear).toHaveBeenCalledTimes(1);
    expect(onFar).not.toHaveBeenCalled();
    expect(observer?.targets.has(near)).toBe(false);
    expect(observer?.targets.has(far)).toBe(true);

    viewport?.remeasure();
    expect(onNear).toHaveBeenCalledTimes(1);
  });

  it("enters a visible element in the band at once and leaves once when the observer disagrees", () => {
    install();
    const root = mounted("div");
    const picture = mounted("button");
    stubRect(root, { top: 0, bottom: 800 });
    stubRect(picture, { top: 100, bottom: 200 });
    stubVisibility(picture, () => true);
    const events: string[] = [];
    const viewport = createIntersectionAgentMarkdownViewport(() => root);

    viewport?.watch(picture, {
      enter: () => events.push("enter"),
      leave: () => events.push("leave"),
    });
    expect(events).toEqual(["enter"]);
    const presence = created[0];
    expect(presence?.options.rootMargin).toBe(AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN);
    expect(presence?.options.root).toBe(root);

    presence?.deliver([{ target: picture, isIntersecting: true }]);
    presence?.deliver([{ target: picture, isIntersecting: false }]);
    presence?.deliver([{ target: picture, isIntersecting: false }]);
    viewport?.remeasure();
    viewport?.remeasure();

    expect(events).toEqual(["enter", "leave"]);

    presence?.deliver([{ target: picture, isIntersecting: true }]);
    expect(events).toEqual(["enter", "leave", "enter"]);
    expect(presence?.targets.has(picture)).toBe(true);
  });

  it("never overrides the observer's verdict when remeasuring", () => {
    install();
    const root = mounted("div");
    const clipped = mounted("button");
    stubRect(root, { top: 0, bottom: 800 });
    stubRect(clipped, { top: 4_000, bottom: 4_100 });
    stubVisibility(clipped, () => true);
    const watcher = { enter: vi.fn(), leave: vi.fn() };
    const viewport = createIntersectionAgentMarkdownViewport(() => root);
    viewport?.watch(clipped, watcher);

    created[0]?.deliver([{ target: clipped, isIntersecting: false }]);
    stubRect(clipped, { top: 100, bottom: 200 });
    viewport?.remeasure();
    viewport?.remeasure();

    expect(watcher.enter).not.toHaveBeenCalled();
    expect(watcher.leave).not.toHaveBeenCalled();

    created[0]?.deliver([{ target: clipped, isIntersecting: true }]);
    expect(watcher.enter).toHaveBeenCalledTimes(1);
  });

  it("resolves an element the observer has not reported yet exactly once when remeasured", () => {
    install();
    const root = mounted("div");
    const picture = mounted("button");
    stubRect(root, { top: 0, bottom: 800 });
    stubRect(picture, { top: 4_000, bottom: 4_100 });
    stubVisibility(picture, () => true);
    const watcher = { enter: vi.fn(), leave: vi.fn() };
    const viewport = createIntersectionAgentMarkdownViewport(() => root);
    viewport?.watch(picture, watcher);

    viewport?.remeasure();
    expect(watcher.enter).not.toHaveBeenCalled();

    stubRect(picture, { top: 100, bottom: 200 });
    viewport?.remeasure();
    viewport?.remeasure();
    created[0]?.deliver([{ target: picture, isIntersecting: true }]);

    expect(watcher.enter).toHaveBeenCalledTimes(1);
    expect(watcher.leave).not.toHaveBeenCalled();
  });

  it("waits for the observer when an element is hidden, detached or cannot be checked", () => {
    install();
    const root = mounted("div");
    const hidden = mounted("button");
    const unchecked = mounted("button");
    const detached = document.createElement("button");
    stubRect(root, { top: 0, bottom: 800 });
    for (const element of [hidden, unchecked, detached]) stubRect(element, { top: 0, bottom: 0 });
    let visible = false;
    stubVisibility(hidden, () => visible);
    stubVisibility(detached, () => true);
    const enters: string[] = [];
    const watcher = (name: string) => ({ enter: () => enters.push(name), leave: () => undefined });
    const viewport = createIntersectionAgentMarkdownViewport(() => root);
    viewport?.watch(hidden, watcher("hidden"));
    viewport?.watch(unchecked, watcher("unchecked"));
    viewport?.watch(detached, watcher("detached"));

    viewport?.remeasure();
    expect(enters).toEqual([]);

    created[0]?.deliver([{ target: hidden, isIntersecting: false }]);
    visible = true;
    viewport?.remeasure();
    expect(enters).toEqual([]);

    created[0]?.deliver([
      { target: hidden, isIntersecting: true },
      { target: unchecked, isIntersecting: true },
    ]);
    expect(enters).toEqual(["hidden", "unchecked"]);
  });

  it("keeps the one-shot observer and the watcher apart", () => {
    install();
    const body = document.createElement("div");
    const picture = document.createElement("button");
    const onEnter = vi.fn();
    const enter = vi.fn();
    const viewport = createIntersectionAgentMarkdownViewport(() => null);
    viewport?.observe(body, onEnter);
    viewport?.watch(picture, { enter, leave: () => undefined });
    expect(created).toHaveLength(2);

    created[0]?.deliver([{ target: body, isIntersecting: true }]);
    created[1]?.deliver([{ target: picture, isIntersecting: true }]);
    created[1]?.deliver([{ target: body, isIntersecting: true }]);

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(created[0]?.targets.size).toBe(0);
    expect(created[1]?.targets.has(picture)).toBe(true);
  });

  it("never calls a watcher back after it stops or the port is disposed", () => {
    install();
    const first = mounted("button");
    const second = mounted("button");
    for (const element of [first, second]) {
      stubRect(element, { top: 9_000, bottom: 9_100 });
      stubVisibility(element, () => true);
    }
    const watcher = { enter: vi.fn(), leave: vi.fn() };
    const viewport = createIntersectionAgentMarkdownViewport(() => null);
    const stop = viewport?.watch(first, watcher);
    viewport?.watch(second, watcher);
    const presence = created[0];

    stop?.();
    expect(presence?.targets.has(first)).toBe(false);
    presence?.deliver([{ target: first, isIntersecting: true }]);
    viewport?.dispose();
    presence?.deliver([{ target: second, isIntersecting: true }]);
    stubRect(second, { top: 0, bottom: 10 });
    viewport?.remeasure();

    expect(watcher.enter).not.toHaveBeenCalled();
    expect(watcher.leave).not.toHaveBeenCalled();
    expect(presence?.disconnects).toBe(1);
  });

  it("remeasures nothing once every element has entered", () => {
    install();
    const element = document.createElement("p");
    const onEnter = vi.fn();
    stubRect(element, { top: 0, bottom: 10 });
    const viewport = createIntersectionAgentMarkdownViewport(() => null);
    const stop = viewport?.observe(element, onEnter);
    stop?.();

    viewport?.remeasure();

    expect(onEnter).not.toHaveBeenCalled();
  });
});
