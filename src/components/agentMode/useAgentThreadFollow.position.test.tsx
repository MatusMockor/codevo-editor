// @vitest-environment jsdom

import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentTranscriptPositionMemory,
  type AgentTranscriptPositionMemory,
} from "../../application/agentTranscriptPositionMemory";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentTranscriptPositionProvider } from "./AgentTranscriptPositionContext";
import { useAgentThreadFollow, type AgentThreadFollow } from "./useAgentThreadFollow";
import { AGENT_TRANSCRIPT_RESTORE_SETTLE_MS } from "./useAgentTranscriptPositionSync";

const VIEW_TOP = 100;
const VIEW_HEIGHT = 300;
const TURN_HEIGHT = 100;

class TurnLayout {
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

  turns(prefix: string, count: number): HTMLElement[] {
    this.body.replaceChildren();
    this.clamp();
    return Array.from({ length: count }, (_, index) => this.turn(`${prefix}${index}`));
  }

  turn(turnId: string, height: number = TURN_HEIGHT): HTMLElement {
    const article = document.createElement("article");
    article.setAttribute("data-agent-turn", turnId);
    this.heights.set(article, height);
    this.body.append(article);
    this.measure(article);
    return article;
  }

  resize(element: Element, height: number): void {
    this.heights.set(element, height);
    this.clamp();
  }

  hide(): void {
    this.viewHeight = 0;
    this.clamp();
  }

  show(): void {
    this.viewHeight = VIEW_HEIGHT;
    this.clamp();
  }

  userScrollTo(top: number): void {
    this.container.scrollTop = top;
    this.frame();
  }

  viewportTop(turnId: string): number {
    const element = this.body.querySelector(`[data-agent-turn="${turnId}"]`);
    expect(element).not.toBeNull();
    return (element as Element).getBoundingClientRect().top - VIEW_TOP;
  }

  maxTop(): number {
    return Math.max(0, this.height(this.body) - this.viewHeight);
  }

  frame(): void {
    act(() => {
      if (this.top !== this.reportedTop) {
        this.reportedTop = this.top;
        this.container.dispatchEvent(new Event("scroll"));
      }
      observers.forEach((callback) => callback());
      this.reportedTop = this.top;
    });
  }

  private clamp(): void {
    this.top = Math.max(0, Math.min(this.top, this.maxTop()));
  }

  private measure(element: Element): void {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        if (this.viewHeight === 0) return rect(0, 0, 0);
        return rect(VIEW_TOP + this.offset(element) - this.top, this.height(element));
      },
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

function rect(top: number, height: number, width: number = 600): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

interface ProbeProps {
  readonly container: HTMLDivElement | null;
  readonly threadId: string;
  readonly pageKey?: string | null;
  readonly revision?: number;
  readonly lastTurn?: AgentTurn | null;
  readonly memory?: AgentTranscriptPositionMemory | null;
}

let observers: Array<() => void> = [];
let host: HTMLDivElement;
let root: Root;
let follow: AgentThreadFollow | null = null;
let clock = 0;

function Probe({
  container,
  threadId,
  pageKey = null,
  revision = 0,
  lastTurn = null,
  memory,
}: ProbeProps) {
  const scrollRef = useRef<HTMLDivElement | null>(container);
  scrollRef.current = container;
  follow = useAgentThreadFollow({
    scrollRef,
    threadId,
    pageKey,
    lastTurn,
    contentRevision: revision,
    queuedPrompts: [],
    viewport: null,
    now: () => clock,
    ...(memory === undefined ? {} : { positionMemory: memory }),
  });
  return null;
}

function render(
  layout: TurnLayout | null,
  props: Omit<ProbeProps, "container">,
  wrap?: (child: ReactNode) => ReactNode,
): void {
  const probe = (
    <Probe container={(layout?.container ?? null) as HTMLDivElement | null} {...props} />
  );
  act(() => root.render(wrap === undefined ? probe : wrap(probe)));
  layout?.frame();
}

function remount(): void {
  act(() => root.unmount());
  root = createRoot(host);
}

function runningTurn(turnId: string): AgentTurn {
  return {
    turnId,
    prompt: "keep going",
    status: { kind: "running" },
    events: [],
    startedAtEpochMs: clock,
    endedAtEpochMs: null,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

describe("useAgentThreadFollow with a transcript position memory", () => {
  it("remembers where a scrolled-up reader is and restores it after a remount", () => {
    const memory = createAgentTranscriptPositionMemory();
    const first = new TurnLayout();
    first.turns("t", 10);
    render(first, { threadId: "agt-1", memory });
    expect(first.container.scrollTop).toBe(700);

    first.userScrollTo(250);
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });

    remount();
    const second = new TurnLayout();
    second.turns("t", 10);
    render(second, { threadId: "agt-1", memory });

    expect(second.container.scrollTop).toBe(250);
    expect(second.viewportTop("t2")).toBe(-50);
    expect(follow?.atLatest).toBe(false);
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });
  });

  it("restores the latest when the reader was following", () => {
    const memory = createAgentTranscriptPositionMemory();
    const first = new TurnLayout();
    first.turns("t", 10);
    render(first, { threadId: "agt-1", memory });
    first.userScrollTo(250);
    first.userScrollTo(700);
    expect(follow?.atLatest).toBe(true);
    expect(memory.read("agt-1")).toBeNull();

    remount();
    const second = new TurnLayout();
    second.turns("t", 10);
    render(second, { threadId: "agt-1", memory });

    expect(second.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
  });

  it("falls back to the latest and forgets a remembered turn that is not rendered", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "gone", offsetPx: -10 });
    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });

    expect(layout.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
    expect(memory.read("agt-1")).toBeNull();
  });

  it("restores each thread's own place when switching A -> B -> A", () => {
    const memory = createAgentTranscriptPositionMemory();
    const layout = new TurnLayout();
    layout.turns("a", 10);
    render(layout, { threadId: "agt-a", memory });
    layout.userScrollTo(250);

    layout.turns("b", 10);
    render(layout, { threadId: "agt-b", memory });
    expect(layout.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
    layout.userScrollTo(100);
    expect(memory.read("agt-b")).toEqual({ kind: "turn", turnId: "b1", offsetPx: 0 });

    layout.turns("a", 10);
    render(layout, { threadId: "agt-a", memory });
    expect(layout.container.scrollTop).toBe(250);
    expect(layout.viewportTop("a2")).toBe(-50);
    expect(follow?.atLatest).toBe(false);
    expect(follow?.unseenActivity).toBe(false);

    layout.turns("b", 10);
    render(layout, { threadId: "agt-b", memory });
    expect(layout.container.scrollTop).toBe(100);
    expect(memory.read("agt-a")).toEqual({ kind: "turn", turnId: "a2", offsetPx: -50 });
  });

  it("holds the restored turn while earlier content remeasures", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t4", offsetPx: -30 });
    const layout = new TurnLayout();
    const turns = layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });
    expect(layout.viewportTop("t4")).toBe(-30);

    layout.resize(turns[0] as HTMLElement, 340);
    layout.frame();
    layout.resize(turns[2] as HTMLElement, 20);
    layout.frame();

    expect(layout.viewportTop("t4")).toBe(-30);
    expect(follow?.atLatest).toBe(false);
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t4", offsetPx: -30 });
  });

  it("keeps today's behaviour when a history page of the same thread replaces the view", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t2", offsetPx: 0 });
    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });
    expect(layout.container.scrollTop).toBe(200);

    layout.turns("p", 10);
    render(layout, { threadId: "agt-1", memory, pageKey: "agt-1:p0" });

    expect(layout.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
    expect(memory.read("agt-1")).toBeNull();
  });

  it("still follows a turn the user sends after a restore", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t2", offsetPx: 0 });
    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });
    expect(follow?.atLatest).toBe(false);

    clock = 1_000;
    layout.turn("t10");
    render(layout, { threadId: "agt-1", memory, revision: 1, lastTurn: runningTurn("t10") });

    expect(layout.container.scrollTop).toBe(800);
    expect(follow?.atLatest).toBe(true);
    expect(memory.read("agt-1")).toBeNull();
  });

  it("follows the latest when the remembered place is now the bottom", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t9", offsetPx: 200 });
    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });

    expect(layout.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
    expect(memory.read("agt-1")).toBeNull();
  });

  it("waits for lazily loaded turn content before restoring a place deep inside the last turn", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t9", offsetPx: -400 });
    const layout = new TurnLayout();
    const turns = layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t9", offsetPx: -400 });

    const last = turns[9];
    expect(last).toBeDefined();
    layout.resize(last as HTMLElement, 1_000);
    layout.frame();

    expect(layout.viewportTop("t9")).toBe(-400);
    expect(follow?.atLatest).toBe(false);
  });

  it("gives up a restore that is still out of reach after the settle window", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t9", offsetPx: -400 });
    const layout = new TurnLayout();
    const turns = layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });

    clock += AGENT_TRANSCRIPT_RESTORE_SETTLE_MS + 1;
    layout.frame();
    layout.resize(turns[9] as HTMLElement, 1_000);
    layout.frame();

    expect(follow?.atLatest).toBe(true);
    expect(layout.container.scrollTop).toBe(layout.maxTop());
  });

  it("drops a pending restore as soon as the reader scrolls by hand", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t9", offsetPx: -400 });
    const layout = new TurnLayout();
    const turns = layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });

    act(() => {
      layout.container.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }));
    });
    layout.userScrollTo(300);
    layout.resize(turns[9] as HTMLElement, 1_000);
    layout.frame();

    expect(layout.container.scrollTop).toBe(300);
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t3", offsetPx: 0 });
  });

  it("defers the restore while the transcript is hidden and never forgets it meanwhile", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t2", offsetPx: -50 });
    const layout = new TurnLayout();
    layout.turns("t", 10);
    layout.hide();
    render(layout, { threadId: "agt-1", memory });
    layout.frame();
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });

    layout.show();
    layout.frame();

    expect(layout.container.scrollTop).toBe(250);
    expect(follow?.atLatest).toBe(false);
  });

  it("does not record a hidden transcript as a new place", () => {
    const memory = createAgentTranscriptPositionMemory();
    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory });
    layout.userScrollTo(250);
    layout.hide();
    layout.frame();

    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });
  });

  it("reads the memory from context when none is passed and honours an explicit null", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t2", offsetPx: -50 });
    const provide = (child: ReactNode) => (
      <AgentTranscriptPositionProvider value={memory}>{child}</AgentTranscriptPositionProvider>
    );
    const first = new TurnLayout();
    first.turns("t", 10);
    render(first, { threadId: "agt-1" }, provide);
    expect(first.container.scrollTop).toBe(250);

    remount();
    const second = new TurnLayout();
    second.turns("t", 10);
    render(second, { threadId: "agt-1", memory: null }, provide);
    expect(second.container.scrollTop).toBe(700);
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });
  });

  it("keeps today's behaviour without a memory", () => {
    const first = new TurnLayout();
    first.turns("t", 10);
    render(first, { threadId: "agt-1" });
    first.userScrollTo(250);

    remount();
    const second = new TurnLayout();
    second.turns("t", 10);
    render(second, { threadId: "agt-1" });
    expect(second.container.scrollTop).toBe(700);
    expect(follow?.atLatest).toBe(true);
  });

  it("is safe while the scroll container is not mounted yet", () => {
    const memory = createAgentTranscriptPositionMemory();
    memory.remember("agt-1", { kind: "turn", turnId: "t2", offsetPx: -50 });
    render(null, { threadId: "agt-1", memory });
    expect(memory.read("agt-1")).toEqual({ kind: "turn", turnId: "t2", offsetPx: -50 });

    const layout = new TurnLayout();
    layout.turns("t", 10);
    render(layout, { threadId: "agt-1", memory, revision: 1 });
    expect(layout.container.scrollTop).toBe(250);
  });
});
