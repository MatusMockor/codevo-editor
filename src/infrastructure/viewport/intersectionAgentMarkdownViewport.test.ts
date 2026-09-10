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

afterEach(() => {
  uninstall();
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
});
