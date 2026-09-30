// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  createAgentTranscriptPositionMemory,
  type AgentTranscriptPositionMemory,
} from "../../application/agentTranscriptPositionMemory";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentTranscriptPositionProvider } from "./AgentTranscriptPositionContext";

const THREAD_ID = "agt-1-0a1b";
const TURN_COUNT = 10;
const TURN_HEIGHT = 100;
const VIEW_TOP = 50;
const VIEW_HEIGHT = 300;
const MAX_SCROLL = TURN_COUNT * TURN_HEIGHT - VIEW_HEIGHT;
const SCROLL_CLASS = "agent-session__scroll";
const TURN_SELECTOR = "[data-agent-turn]";

interface Descriptors {
  readonly rect: PropertyDescriptor | undefined;
  readonly scrollTop: PropertyDescriptor | undefined;
  readonly scrollHeight: PropertyDescriptor | undefined;
  readonly clientHeight: PropertyDescriptor | undefined;
}

const scrollTops = new WeakMap<Element, number>();
let original: Descriptors;

function box(top: number, height: number): DOMRect {
  const width = height === 0 ? 0 : 600;
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

function scrollContainer(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(`.${SCROLL_CLASS}`);
}

function turnsIn(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(TURN_SELECTOR));
}

function turnTop(container: HTMLElement, turn: Element): number {
  const index = turnsIn(container).indexOf(turn);
  return VIEW_TOP + index * TURN_HEIGHT - (scrollTops.get(container) ?? 0);
}

function layoutRect(this: Element): DOMRect {
  if (this.classList.contains(SCROLL_CLASS)) return box(VIEW_TOP, VIEW_HEIGHT);
  const container = scrollContainer(this);
  if (container === null) return box(0, 0);
  if (this.matches(TURN_SELECTOR)) return box(turnTop(container, this), TURN_HEIGHT);
  const inside = Array.from(this.querySelectorAll(TURN_SELECTOR));
  const first = inside[0];
  if (first === undefined) return box(0, 0);
  return box(turnTop(container, first), inside.length * TURN_HEIGHT);
}

function installLayout(): void {
  original = {
    rect: Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect"),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
  };
  Object.defineProperties(Element.prototype, {
    getBoundingClientRect: { configurable: true, value: layoutRect },
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        const max = this.classList.contains(SCROLL_CLASS) ? MAX_SCROLL : 0;
        scrollTops.set(this, Math.max(0, Math.min(value, max)));
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: Element) {
        return this.classList.contains(SCROLL_CLASS) ? TURN_COUNT * TURN_HEIGHT : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: Element) {
        return this.classList.contains(SCROLL_CLASS) ? VIEW_HEIGHT : 0;
      },
    },
  });
}

function restoreLayout(): void {
  for (const [key, descriptor] of Object.entries(original)) {
    const name = key === "rect" ? "getBoundingClientRect" : key;
    if (descriptor === undefined) {
      Reflect.deleteProperty(Element.prototype, name);
      continue;
    }
    Object.defineProperty(Element.prototype, name, descriptor);
  }
}

function turn(index: number): AgentTurn {
  return {
    turnId: `turn-${index}`,
    prompt: `Step ${index}`,
    status: { kind: "exited", exitCode: 0 },
    events: [{ kind: "assistantText", text: `Finished step ${index}.` }],
    startedAtEpochMs: index,
    endedAtEpochMs: index + 1,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function view(): AgentThreadView {
  return {
    thread: {
      threadId: THREAD_ID,
      owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "session" },
      title: "Parser",
      pinned: false,
      archived: false,
      createdAtEpochMs: 0,
      updatedAtEpochMs: 0,
      turns: Array.from({ length: TURN_COUNT }, (_, index) => turn(index)),
      turnsTruncated: false,
      integration: null,
      viewedAtEpochMs: null,
      externalOrigin: null,
    },
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: "settled",
    unread: false,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

describe("the thread session transcript position", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installLayout();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restoreLayout();
  });

  function mount(memory: AgentTranscriptPositionMemory | null): HTMLElement {
    act(() =>
      root.render(
        <AgentTranscriptPositionProvider value={memory}>
          <AgentThreadSession
            thread={view()}
            composerRepositoryLabel="app"
            onReviewInDiff={() => {}}
            turnLog={null}
          />
        </AgentTranscriptPositionProvider>,
      ),
    );
    const container = host.querySelector<HTMLElement>(`.${SCROLL_CLASS}`);
    expect(container).not.toBeNull();
    return container as HTMLElement;
  }

  function remount(memory: AgentTranscriptPositionMemory | null): HTMLElement {
    act(() => root.unmount());
    root = createRoot(host);
    return mount(memory);
  }

  function userScrollTo(container: HTMLElement, top: number): void {
    act(() => {
      container.scrollTop = top;
      container.dispatchEvent(new Event("scroll"));
    });
  }

  it("reopens a scrolled-up thread at the same turn", () => {
    const memory = createAgentTranscriptPositionMemory();
    const first = mount(memory);
    expect(first.scrollTop).toBe(MAX_SCROLL);

    userScrollTo(first, 250);
    expect(memory.read(THREAD_ID)).toEqual({ kind: "turn", turnId: "turn-2", offsetPx: -50 });

    expect(remount(memory).scrollTop).toBe(250);
  });

  it("reopens a thread that was following at the latest", () => {
    const memory = createAgentTranscriptPositionMemory();
    const first = mount(memory);
    userScrollTo(first, 250);
    userScrollTo(first, MAX_SCROLL);
    expect(memory.read(THREAD_ID)).toBeNull();

    expect(remount(memory).scrollTop).toBe(MAX_SCROLL);
  });

  it("opens at the latest without a position memory", () => {
    const first = mount(null);
    userScrollTo(first, 250);

    expect(remount(null).scrollTop).toBe(MAX_SCROLL);
  });
});
