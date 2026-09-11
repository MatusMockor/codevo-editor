// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentThreadExternalOrigin,
  type AgentTurn,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { findInThread } from "../../domain/agentThreadSearch";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";
import { AgentClockProvider } from "./agentClock";
import {
  AGENT_FIND_REVEAL_INSET,
  AgentThreadSession,
  type AgentThreadSessionProps,
} from "./AgentThreadSession";
import { AGENT_MINIMAP_RAIL_WIDTH } from "./AgentThreadMinimap";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };
const CONTAINING_BLOCK_PROPERTIES = [
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-block",
  "overflow-inline",
  "transform",
  "translate",
  "rotate",
  "scale",
  "filter",
  "backdrop-filter",
  "perspective",
  "contain",
  "content-visibility",
  "will-change",
  "position",
] as const;

const STYLES = parseAllStyleSheets();

interface FakeObserver {
  readonly root: Element | null;
  readonly rootMargin: string;
  readonly targets: Element[];
  disconnected: boolean;
  enter(target: Element): void;
  leave(target: Element): void;
}

describe("agent thread session minimap and find pill", () => {
  let host: HTMLDivElement;
  let root: Root;
  let observers: FakeObserver[];
  let originalObserver: PropertyDescriptor | undefined;
  let originalScrollIntoView: PropertyDescriptor | undefined;
  let scrolled: Array<{ readonly element: Element; readonly block: unknown }>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    observers = [];
    scrolled = [];
    originalObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element, argument: unknown): void {
        scrolled.push({ element: this, block: argument });
      },
    });
    installIntersectionObserver(observers);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restore(globalThis, "IntersectionObserver", originalObserver);
    restore(Element.prototype, "scrollIntoView", originalScrollIntoView);
    window.innerWidth = 1024;
  });

  it("draws one dash per user turn beside the reading column", () => {
    render({ thread: threadView(turns(3)) });

    const rail = host.querySelector('nav[aria-label="Your turns"]');
    expect(rail?.className).toContain("agent-minimap--rail");
    expect(host.querySelectorAll(".agent-minimap__dash")).toHaveLength(3);
    expect(host.querySelector(".agent-session")?.contains(rail as Node)).toBe(true);
    expect(host.querySelector(".agent-session__scroll")?.contains(rail as Node)).toBe(false);
  });

  it("watches every turn with one observer rooted on the scroller", () => {
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 400,
    });
    try {
      render({ thread: threadView(turns(4)) });
    } finally {
      restore(HTMLElement.prototype, "clientHeight", originalHeight);
    }

    expect(observers).toHaveLength(1);
    const observer = observers[0];
    expect(observer?.root).toBe(host.querySelector(".agent-session__scroll"));
    expect(observer?.targets).toHaveLength(4);
    expect(observer?.rootMargin).toBe("-60px 0px -280px 0px");
  });

  it("marks the turn in view without re-rendering the transcript on scroll or repeat reports", () => {
    const renders: string[] = [];
    render({ thread: threadView(turns(4)), turnRenderProbe: (turnId) => renders.push(turnId) });

    const observer = observers[0];
    const targets = observer?.targets ?? [];
    act(() => observer?.enter(targets[1] as Element));
    expect(currentDashLabel()).toBe("Turn 2 of 4: prompt 2");

    act(() => observer?.enter(targets[0] as Element));
    expect(currentDashLabel()).toBe("Turn 1 of 4: prompt 1");

    const before = renders.length;
    const scroller = host.querySelector(".agent-session__scroll");
    act(() => {
      for (let tick = 0; tick < 20; tick += 1) {
        scroller?.dispatchEvent(new Event("scroll"));
      }
    });
    expect(renders.length).toBe(before);

    act(() => {
      for (let tick = 0; tick < 20; tick += 1) {
        observer?.enter(targets[0] as Element);
      }
    });

    expect(renders.length).toBe(before);
    expect(currentDashLabel()).toBe("Turn 1 of 4: prompt 1");
  });

  it("ignores a late callback from an observer the thread already replaced", () => {
    render({ thread: threadView(turns(3)) });

    const stale = observers[0];
    act(() => stale?.enter(stale.targets[2] as Element));
    expect(currentDashLabel()).toBe("Turn 3 of 3: prompt 3");

    render({ thread: threadView(turns(4)) });
    expect(observers).toHaveLength(2);
    expect(stale?.disconnected).toBe(true);

    act(() => stale?.enter(stale.targets[0] as Element));
    expect(currentDashLabel()).toBe("Turn 3 of 4: prompt 3");
  });

  it("forgets the turn in view when a different thread takes the surface", () => {
    render({ thread: threadView(turns(3)) });

    const first = observers[0];
    act(() => first?.enter(first.targets[2] as Element));
    expect(currentDashLabel()).toBe("Turn 3 of 3: prompt 3");

    render({ thread: threadView(turns(3), "agt-2") });

    expect(currentDashLabel()).toBeNull();
    expect(first?.disconnected).toBe(true);
  });

  it("scrolls the chosen turn into view and moves focus to its prompt", () => {
    render({ thread: threadView(turns(3)) });

    const dash = host.querySelectorAll<HTMLButtonElement>(".agent-minimap__dash")[2];
    act(() => dash?.click());

    const third = host.querySelector<HTMLElement>('[data-agent-turn="agt-1-t3"]');
    expect(lastScroll()?.element).toBe(third);
    expect(lastScroll()?.block).toEqual({ block: "start" });
    expect(document.activeElement).toBe(third?.querySelector(".agent-prompt__body"));
  });

  it("lists imported exchanges and live turns as one column in document order", () => {
    render({
      thread: threadView(
        turns(2),
        "agt-1",
        imported([user("why does it hang"), assistant("it waits"), user("and now")]),
      ),
    });

    const dashes = [...host.querySelectorAll<HTMLElement>(".agent-minimap__dash")];
    expect(dashes.map((dash) => dash.getAttribute("aria-label"))).toEqual([
      "Turn 1 of 4: why does it hang",
      "Turn 2 of 4: and now",
      "Turn 3 of 4: prompt 1",
      "Turn 4 of 4: prompt 2",
    ]);

    const articles = [...host.querySelectorAll<HTMLElement>("[data-agent-column]")];
    expect(articles.map((article) => article.dataset.agentColumn)).toEqual([
      "imported:0",
      "imported:2",
      "turn:agt-1-t1",
      "turn:agt-1-t2",
    ]);
  });

  it("jumps to an imported prompt and moves focus to it", () => {
    render({
      thread: threadView(
        turns(2),
        "agt-1",
        imported([user("why does it hang"), assistant("it waits"), user("and now")]),
      ),
    });

    const second = host.querySelectorAll<HTMLButtonElement>(".agent-minimap__dash")[1];
    act(() => second?.click());

    const article = host.querySelector<HTMLElement>('[data-agent-column="imported:2"]');
    expect(article).not.toBeNull();
    expect(lastScroll()?.element).toBe(article);
    expect(lastScroll()?.block).toEqual({ block: "start" });
    expect(document.activeElement).toBe(article?.querySelector(".agent-prompt__body"));
  });

  it("draws a populated rail for a thread that has only imported exchanges", () => {
    render({
      thread: threadView(
        [],
        "agt-1",
        imported([user("first"), assistant("alpha"), user("second")]),
      ),
    });

    const rail = host.querySelector('nav[aria-label="Your turns"]');
    expect(rail?.className).toContain("agent-minimap--rail");
    expect(host.querySelectorAll(".agent-minimap__dash")).toHaveLength(2);
    expect(host.querySelector(".agent-session__scroll")?.contains(rail as Node)).toBe(false);
  });

  it("watches the whole column with the one observer rooted on the scroller", () => {
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 400,
    });
    try {
      render({
        thread: threadView(turns(2), "agt-1", imported([user("first"), user("second")])),
      });
    } finally {
      restore(HTMLElement.prototype, "clientHeight", originalHeight);
    }

    expect(observers).toHaveLength(1);
    const observer = observers[0];
    expect(observer?.root).toBe(host.querySelector(".agent-session__scroll"));
    expect(observer?.targets).toHaveLength(4);

    const targets = observer?.targets ?? [];
    act(() => observer?.enter(targets[1] as Element));
    expect(currentDashLabel()).toBe("Turn 2 of 4: second");
  });

  it("stops observing and swaps to the turn list when the column is narrow", () => {
    window.innerWidth = 700;
    render({ thread: threadView(turns(3)) });

    expect(host.querySelector(".agent-minimap--rail")).toBeNull();
    expect(host.querySelector(".agent-minimap__toggle")?.textContent).toBe("Turns · 3");
    expect(observers.every((observer) => observer.disconnected)).toBe(true);

    act(() => host.querySelector<HTMLButtonElement>(".agent-minimap__toggle")?.click());

    expect(observers.some((observer) => !observer.disconnected)).toBe(true);
    expect(host.querySelectorAll('nav[aria-label="Your turns"] ol > li > button')).toHaveLength(3);
  });

  it("keeps the streaming turn's dash busy while the answer arrives", () => {
    render({ thread: threadView([...turns(2), turn("t3", "prompt 3", RUNNING)]) });

    const dashes = [...host.querySelectorAll(".agent-minimap__dash")];
    expect(dashes.map((dash) => dash.getAttribute("aria-busy"))).toEqual([null, null, "true"]);

    render({ thread: threadView([...turns(2), turn("t3", "prompt 3", SETTLED)]) });
    expect(
      [...host.querySelectorAll(".agent-minimap__dash")].map((dash) =>
        dash.getAttribute("aria-busy"),
      ),
    ).toEqual([null, null, null]);
  });

  it("opens the find pill without moving a transcript the reader scrolled", () => {
    const view = threadView(turns(3));
    render({ thread: view });

    const scroller = scrollContainer({ scrollHeight: 2000, clientHeight: 400, scrollTop: 900 });
    act(() => scroller.dispatchEvent(new Event("scroll")));

    render({ thread: view, findBar: <div className="agent-find" />, findOpen: true });

    expect(host.querySelector('.agent-session[data-find="open"]')).not.toBeNull();
    expect(host.querySelector(".agent-session")?.firstElementChild?.className).toBe("agent-find");
    expect(scroller.scrollTop).toBe(900 + AGENT_FIND_REVEAL_INSET);

    render({ thread: view });
    expect(scroller.scrollTop).toBe(900);
    expect(host.querySelector('.agent-session[data-find="open"]')).toBeNull();
  });

  it("keeps a reader who is following the newest answer pinned when find opens and closes", () => {
    const view = threadView(turns(3));
    render({ thread: view });

    const scroller = scrollContainer({ scrollHeight: 2000, clientHeight: 400, scrollTop: 1600 });
    act(() => scroller.dispatchEvent(new Event("scroll")));

    render({ thread: view, findBar: <div className="agent-find" />, findOpen: true });
    expect(scroller.scrollTop).toBe(2000);

    render({ thread: view });
    expect(scroller.scrollTop).toBe(2000);

    scroller.scrollTop = 1900;
    render({ thread: threadView([...turns(2), streaming("t3", "prompt 3")]) });

    expect(scroller.scrollTop).toBe(2000);
  });

  it("reveals a hit on the first line clear of the open pill", () => {
    const view = threadView([turn("t1", "Where does the parser live", SETTLED)]);
    const hits = findInThread(view.thread, "parser", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    expect(hits).toHaveLength(1);

    render({
      thread: view,
      findBar: <div className="agent-find" />,
      findHitIndex: 0,
      findHits: hits,
      findOpen: true,
      findQuery: "parser",
    });

    const current = host.querySelector<HTMLElement>(".agent-find__hit--current");
    expect(current).not.toBeNull();
    expect(lastScroll()?.element).toBe(current);
    expect(current?.style.scrollMarginTop).toBe(`${AGENT_FIND_REVEAL_INSET}px`);
  });

  it("keeps the headroom, the scroll margin and the pill geometry in one arithmetic", () => {
    const inset = pixels(cssValue('.agent-session[data-find="open"] .agent-session__body'));
    expect(declaration(".agent-session", "position")).toBe("relative");
    expect(inset).toBe(AGENT_FIND_REVEAL_INSET);

    const sessionPadding = pixels(sessionPaddingTop());
    const pillTop = pixels(tokenValue("--agent-find-pill-top"));
    const pillHeight = pixels(tokenValue("--agent-find-pill-height"));
    expect(sessionPadding + inset).toBeGreaterThanOrEqual(pillTop + pillHeight);
    expect(tokenValue("--agent-thread-column")).toBe(
      declaration(".agent-session__body", "max-width"),
    );
    expect(AGENT_MINIMAP_RAIL_WIDTH).toBe(
      pixels(tokenValue("--agent-thread-column")) +
        2 * pixels(tokenValue("--agent-session-gutter")) +
        pixels(tokenValue("--agent-minimap-gutter")) +
        pixels(tokenValue("--agent-minimap-rail")),
    );
  });

  it("adds nothing to the scroller's ancestor chain but a positioned session", () => {
    render({ thread: threadView(turns(3)) });

    const scroll = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();

    const chain: HTMLElement[] = [];
    for (
      let ancestor = scroll?.parentElement ?? null;
      ancestor !== null && ancestor !== host;
      ancestor = ancestor.parentElement
    ) {
      chain.push(ancestor);
    }

    expect(chain.map((element) => element.className)).toEqual(["agent-session"]);
    expect(chain.flatMap((element) => containingBlockDeclarations(element))).toEqual([
      "components/agentMode/agentThread.css .agent-session position",
    ]);
    expect(declaration(".agent-minimap--rail", "position")).toBe("absolute");
    expect(declaration(".agent-find", "position")).toBe("absolute");
    expect(declaration(".agent-minimap--rail", "transform")).toBeNull();
    for (const property of CONTAINING_BLOCK_PROPERTIES) {
      if (property === "position") continue;
      expect(declaration(".agent-session", property), property).toBeNull();
    }
    expect(declaration(".agent-mode__center", "container-type")).toBe("inline-size");
    expect(declaration(".agent-mode__center", "overflow")).toBeNull();
    expect(declaration(".agent-mode__center", "transform")).toBeNull();
  });

  function lastScroll(): { readonly element: Element; readonly block: unknown } | undefined {
    return scrolled[scrolled.length - 1];
  }

  function currentDashLabel(): string | null {
    const dash = host.querySelector('.agent-minimap__dash[aria-current="true"]');
    return dash === null ? null : dash.getAttribute("aria-label");
  }

  function scrollContainer(dimensions: {
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly scrollTop: number;
  }): HTMLDivElement {
    const scroll = host.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: dimensions.scrollHeight },
      clientHeight: { configurable: true, value: dimensions.clientHeight },
      scrollTop: { configurable: true, value: dimensions.scrollTop, writable: true },
    });
    return scroll as HTMLDivElement;
  }

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={600_000}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            markdownViewport={null}
            onReviewInDiff={() => undefined}
            thread={null}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }
});

function matchesSelector(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function containingBlockDeclarations(element: Element): ReadonlyArray<string> {
  return STYLES.rules
    .filter((rule) => selectorParts(rule.selector).some((part) => matchesSelector(element, part)))
    .flatMap((rule) =>
      rule.declarations
        .filter((entry) =>
          (CONTAINING_BLOCK_PROPERTIES as readonly string[]).includes(entry.property),
        )
        .map((entry) => `${rule.sheet} ${rule.selector} ${entry.property}`),
    );
}

function declaration(selector: string, property: string): string | null {
  const values = STYLES.rules
    .filter((rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector))
    .flatMap((rule) =>
      rule.declarations.filter((entry) => entry.property === property).map((entry) => entry.value),
    );
  return values[values.length - 1] ?? null;
}

function sessionPaddingTop(): string {
  const padding = declaration(".agent-session", "padding");
  expect(padding, ".agent-session padding").not.toBeNull();
  return (padding ?? "").split(/\s+/)[0] ?? "";
}

function cssValue(selector: string): string {
  const value = declaration(selector, "padding-block-start");
  expect(value, selector).not.toBeNull();
  return value ?? "";
}

function tokenValue(name: string): string {
  const values = STYLES.rules
    .filter((rule) => rule.sheet === "components/agentMode/agentModeTokens.css")
    .flatMap((rule) =>
      rule.declarations.filter((entry) => entry.property === name).map((entry) => entry.value),
    );
  expect(values.length, name).toBeGreaterThan(0);
  return values[values.length - 1] ?? "";
}

function pixels(value: string): number {
  const direct = /^(\d+)px$/.exec(value.trim());
  if (direct !== null) return Number(direct[1]);
  const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
  expect(reference, value).not.toBeNull();
  return pixels(tokenValue(reference?.[1] ?? ""));
}

function installIntersectionObserver(observers: FakeObserver[]): void {
  class FakeIntersectionObserver {
    readonly root: Element | null;
    readonly rootMargin: string;
    readonly targets: Element[] = [];
    disconnected = false;

    constructor(
      private readonly callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      this.root = (options?.root as Element | null) ?? null;
      this.rootMargin = options?.rootMargin ?? "";
      observers.push(this as unknown as FakeObserver);
    }

    observe(target: Element): void {
      this.targets.push(target);
    }

    unobserve(): void {}

    disconnect(): void {
      this.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    enter(target: Element): void {
      this.report(target, true);
    }

    leave(target: Element): void {
      this.report(target, false);
    }

    private report(target: Element, isIntersecting: boolean): void {
      this.callback(
        [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: FakeIntersectionObserver,
    writable: true,
  });
}

function restore(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function turns(count: number): ReadonlyArray<AgentTurn> {
  return Array.from({ length: count }, (_unused, index) =>
    turn(`t${index + 1}`, `prompt ${index + 1}`, SETTLED),
  );
}

function streaming(turnId: string, prompt: string): AgentTurn {
  return {
    ...turn(turnId, prompt, RUNNING),
    events: [{ kind: "assistantText", text: "an answer arriving" }],
  };
}

function turn(turnId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId: `agt-1-${turnId}`,
    prompt,
    status,
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: status.kind === "running" ? null : NOW - 30_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function user(text: string): ExternalSessionExchange {
  return { role: "user", text };
}

function assistant(text: string): ExternalSessionExchange {
  return { role: "assistant", text };
}

function imported(exchanges: ReadonlyArray<ExternalSessionExchange>): AgentThreadExternalOrigin {
  return {
    provider: "claudeCode",
    sessionId: "session-abcdefgh",
    importedAtEpochMs: NOW - 900_000,
    history: {
      provider: "claudeCode",
      sessionId: "session-abcdefgh",
      exchanges,
      exchangesTruncated: false,
      totalPreviewBytes: 0,
    },
  };
}

function threadView(
  turnList: ReadonlyArray<AgentTurn>,
  threadId = "agt-1",
  externalOrigin: AgentThreadExternalOrigin | null = null,
): AgentThreadView {
  const record: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 600_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: turnList,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(record),
    unread: agentThreadUnread(record),
    thread: record,
    lifecycle: turnList.some((entry) => entry.status.kind === "running") ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
