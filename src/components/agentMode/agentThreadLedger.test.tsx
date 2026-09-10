// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentBandPin, AgentBandPinObserver } from "../../application/agentBandPin";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import { sharedAgentMarkdownDocumentCache } from "../../application/agentMarkdownDocumentCache";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { findInThread } from "../../domain/agentThreadSearch";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
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
] as const;

const STYLES = parseAllStyleSheets();
const REVEAL_INSET = 68;
const CONTENT_HEIGHT = 900;
const VIEWPORT_HEIGHT = 300;

interface PinPort {
  readonly port: AgentBandPinObserver;
  sentinels(): ReadonlyArray<Element>;
  set(sentinel: Element, pin: AgentBandPin): void;
}

function pinPort(): PinPort {
  const listeners = new Map<Element, (pin: AgentBandPin) => void>();
  return {
    port: {
      observe(sentinel, onChange) {
        listeners.set(sentinel, onChange);
        return () => {
          listeners.delete(sentinel);
        };
      },
      dispose() {
        listeners.clear();
      },
    },
    sentinels: () => [...listeners.keys()],
    set(sentinel, pin) {
      const onChange = listeners.get(sentinel);
      expect(onChange).toBeDefined();
      act(() => onChange?.(pin));
    },
  };
}

interface ViewportPort {
  readonly port: AgentMarkdownViewport;
  observed(): ReadonlyArray<Element>;
}

function viewportPort(near: boolean): ViewportPort {
  const waiting = new Map<Element, () => void>();
  return {
    port: {
      contains: () => near,
      observe(element, onEnter) {
        waiting.set(element, onEnter);
        return () => {
          waiting.delete(element);
        };
      },
      remeasure() {
        if (!near) return;
        for (const [element, onEnter] of [...waiting]) {
          waiting.delete(element);
          onEnter();
        }
      },
      dispose() {
        waiting.clear();
      },
    },
    observed: () => [...waiting.keys()],
  };
}

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
        .filter((declaration) =>
          (CONTAINING_BLOCK_PROPERTIES as readonly string[]).includes(declaration.property),
        )
        .map((declaration) => `${rule.sheet} ${rule.selector} ${declaration.property}`),
    );
}

describe("agent thread ledger", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    sharedAgentMarkdownDocumentCache().clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("sticks the question band to a scroll chain that creates no containing block", () => {
    render({ thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])]) });

    const band = host.querySelector<HTMLElement>("header.agent-band");
    const scroll = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(band).not.toBeNull();
    expect(scroll).not.toBeNull();

    const chain: HTMLElement[] = [];
    for (
      let ancestor = band?.parentElement ?? null;
      ancestor !== null && ancestor !== scroll;
      ancestor = ancestor.parentElement
    ) {
      chain.push(ancestor);
    }

    expect(chain.map((element) => element.className)).toEqual([
      "agent-turn",
      "agent-turn-list",
      "agent-session__body",
    ]);
    expect(scroll?.contains(band as Node)).toBe(true);

    const offenders = chain.flatMap((element) => containingBlockDeclarations(element));
    expect(offenders).toEqual([]);
    expect(containingBlockDeclarations(scroll as Element)).toEqual([
      "components/agentMode/agentThread.css .agent-session__scroll overflow-x",
      "components/agentMode/agentThread.css .agent-session__scroll overflow-y",
    ]);
  });

  it("sticks an imported question band to the same containing-block-free chain", () => {
    render({
      thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])], {
        exchanges: [
          { role: "user", text: "Original question" },
          { role: "assistant", text: "Original answer" },
        ],
      }),
    });

    const band = host.querySelector<HTMLElement>(".agent-imported-history header.agent-band");
    const scroll = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(band).not.toBeNull();
    expect(scroll?.contains(band as Node)).toBe(true);

    const chain: HTMLElement[] = [];
    for (
      let ancestor = band?.parentElement ?? null;
      ancestor !== null && ancestor !== scroll;
      ancestor = ancestor.parentElement
    ) {
      chain.push(ancestor);
    }

    expect(chain.map((element) => element.className)).toEqual([
      "agent-turn",
      "agent-imported-history",
      "agent-session__body",
    ]);
    expect(chain.flatMap((element) => containingBlockDeclarations(element))).toEqual([]);
    expect(host.querySelectorAll("header.agent-band")).toHaveLength(2);
  });

  it("gives every turn its own band so the next band pushes the previous one out", () => {
    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text("beta")]),
      ]),
    });

    const turns = [...host.querySelectorAll<HTMLElement>(".agent-turn")];
    expect(turns).toHaveLength(2);
    for (const section of turns) {
      expect(section.querySelectorAll("header.agent-band")).toHaveLength(1);
      const band = section.querySelector("header.agent-band");
      expect(band?.parentElement).toBe(section);
    }
    expect(turns[0]?.nextElementSibling).toBe(turns[1]);
    expect(turns[0]?.parentElement?.className).toBe("agent-turn-list");

    expect(declaration(".agent-turn-list", "gap")).toBe("0");
    expect(declaration(".agent-turn", "margin")).toBeNull();
    expect(declaration(".agent-turn", "padding")).toBeNull();
    expect(declaration(".agent-turn", "padding-bottom")).toBeNull();
    expect(declaration(".agent-answer", "padding-bottom")).toBe("var(--agent-turn-gap)");
  });

  it("numbers the bands per turn and keeps the numbering stable when a turn is added", () => {
    const first = turn("t1", "First question", SETTLED, [text("alpha")]);
    const second = turn("t2", "Second question", SETTLED, [text("beta")]);
    render({ thread: threadView([first, second]) });
    expect(numbers()).toEqual(["1.", "2."]);

    render({
      thread: threadView([first, second, turn("t3", "Third question", RUNNING, [text("gamma")])]),
    });

    expect(numbers()).toEqual(["1.", "2.", "3."]);
    expect(bandTexts()).toEqual(["First question", "Second question", "Third question"]);
  });

  it("clamps and shadows only the band whose turn is pinned", () => {
    const pin = pinPort();
    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text("beta")]),
      ]),
      bandPin: pin.port,
    });

    const sentinels = pin.sentinels();
    expect(sentinels).toHaveLength(2);
    expect(bandClasses()).toEqual(["agent-band", "agent-band"]);

    pin.set(sentinels[0] as Element, "pinned");
    expect(bandClasses()).toEqual(["agent-band agent-band--pinned", "agent-band"]);

    pin.set(sentinels[0] as Element, "released");
    pin.set(sentinels[1] as Element, "pinned");
    expect(bandClasses()).toEqual(["agent-band", "agent-band agent-band--pinned"]);
  });

  it("shows no ordinal at all when earlier turns were dropped", () => {
    const turns = [
      turn("t8", "Eighth question", SETTLED, [text("alpha")]),
      turn("t9", "Ninth question", SETTLED, [text("beta")]),
    ];
    render({ thread: threadView(turns) });
    expect(numbers()).toEqual(["1.", "2."]);

    render({ thread: threadView(turns, { turnsTruncated: true }) });

    expect(numbers()).toEqual([]);
    expect(host.querySelectorAll(".agent-band")).toHaveLength(2);
    expect(host.textContent).toContain("Earlier turns were dropped to bound memory.");
  });

  it("never changes what the band clamps when the pin state changes", () => {
    const pin = pinPort();
    render({
      thread: threadView([
        turn("t1", "A prompt\nthat runs\nacross\nmany separate lines", SETTLED, [text("alpha")]),
      ]),
      bandPin: pin.port,
    });

    const band = host.querySelector<HTMLElement>("header.agent-band");
    expect(band?.className).toBe("agent-band");

    pin.set(pin.sentinels()[0] as Element, "pinned");
    expect(band?.className).toBe("agent-band agent-band--pinned");

    pin.set(pin.sentinels()[0] as Element, "released");
    expect(band?.className).toBe("agent-band");
  });

  it("expands the prompt only when the reader asks for it", () => {
    const pin = pinPort();
    render({
      thread: threadView([turn("t1", "A very long prompt", SETTLED, [text("alpha")])]),
      bandPin: pin.port,
    });

    const band = host.querySelector<HTMLElement>("header.agent-band");
    const expand = host.querySelector<HTMLButtonElement>("button.agent-band__expand");
    expect(expand?.getAttribute("aria-expanded")).toBe("false");

    act(() => expand?.click());
    expect(band?.className).toContain("agent-band--expanded");
    expect(expand?.getAttribute("aria-expanded")).toBe("true");

    pin.set(pin.sentinels()[0] as Element, "pinned");
    expect(band?.className).toBe("agent-band agent-band--pinned agent-band--expanded");

    act(() => expand?.click());
    expect(band?.className).toBe("agent-band agent-band--pinned");
  });

  it("un-clamps the band while it hosts the current find hit", () => {
    const pin = pinPort();
    const view = threadView([
      turn("t1", "Where does the parser live and why", SETTLED, [text("alpha")]),
    ]);
    const hits = findInThread(view.thread, "parser", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    const first = hits[0];
    expect(first?.scope).toBe("turn");
    expect(first?.scope === "turn" ? first.eventIndex : undefined).toBeNull();

    render({ thread: view, bandPin: pin.port, findQuery: "parser", findHits: hits });
    expect(host.querySelector("header.agent-band")?.className).toBe("agent-band");

    render({
      thread: view,
      bandPin: pin.port,
      findQuery: "parser",
      findHits: hits,
      findHitIndex: 0,
    });

    const band = host.querySelector<HTMLElement>("header.agent-band");
    expect(band?.className).toContain("agent-band--expanded");
    expect(band?.querySelector("mark.agent-find__hit--current")).not.toBeNull();

    pin.set(pin.sentinels()[0] as Element, "pinned");
    expect(band?.className).toBe("agent-band agent-band--pinned agent-band--expanded");
  });

  it("jumps to the end of the answer that the pinned band belongs to", () => {
    const scrolled: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text("beta")]),
      ]),
    });

    const jump = host.querySelectorAll<HTMLButtonElement>("button.agent-band__jump");
    expect(jump).toHaveLength(2);
    act(() => jump[0]?.click());

    const ends = [...host.querySelectorAll<HTMLElement>(".agent-answer__end")];
    expect(scrolled).toEqual([ends[0]]);
    expect(ends[0]?.closest(".agent-turn")).toBe(host.querySelector(".agent-turn"));
  });

  it("reveals a find hit below the pinned band instead of underneath it", () => {
    const options: unknown[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element, argument: unknown): void {
        options.push(argument);
      },
      writable: true,
    });
    const view = threadView([turn("t1", "First question", SETTLED, [text("alpha beta")])]);
    const hits = findInThread(view.thread, "beta", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    expect(hits.length).toBeGreaterThan(0);

    render({ thread: view, findQuery: "beta", findHits: hits, findHitIndex: 0 });

    expect(options).toEqual([{ block: "start" }]);
    expect(host.querySelector("mark.agent-find__hit--current")).not.toBeNull();
    expect(declaration(".agent-find__hit", "scroll-margin-top")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(declaration(".agent-answer [data-agent-event]", "scroll-margin-top")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(host.querySelector(".agent-session__reveal-slack")).not.toBeNull();
    expect(declaration(".agent-session__reveal-slack", "height")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(declaration(".agent-session__reveal-slack", "margin-top")).toBe(
      "calc(var(--agent-turn-gap) * -1)",
    );
  });

  it("carries the reveal slack only while a live query has something to reveal", () => {
    const view = threadView([turn("t1", "First question", SETTLED, [text("alpha beta")])]);
    const hits = findInThread(view.thread, "beta", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    const slack = (): Element | null => host.querySelector(".agent-session__reveal-slack");

    render({ thread: view });
    expect(slack()).toBeNull();

    render({ thread: view, findQuery: "nothingmatchesthis", findHits: [] });
    expect(slack()).toBeNull();

    render({ thread: view, findQuery: "beta", findHits: hits });
    expect(slack()).not.toBeNull();

    render({ thread: view });
    expect(slack()).toBeNull();
  });

  it("keeps the reader pinned to the bottom when the query clears the slack away", () => {
    const view = threadView([turn("t1", "First question", SETTLED, [text("alpha beta")])]);
    const hits = findInThread(view.thread, "beta", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });

    const deferred = viewportPort(false).port;

    render({ thread: view, findQuery: "beta", findHits: hits, markdownViewport: deferred });
    const scroll = elasticScrollContainer(CONTENT_HEIGHT, VIEWPORT_HEIGHT);
    expect(scroll.scrollHeight).toBe(CONTENT_HEIGHT + REVEAL_INSET);
    scroll.scrollTop = scroll.scrollHeight;
    act(() => scroll.dispatchEvent(new Event("scroll")));
    expect(scroll.scrollTop).toBe(CONTENT_HEIGHT + REVEAL_INSET - VIEWPORT_HEIGHT);

    render({ thread: view, markdownViewport: deferred });

    expect(scroll.scrollHeight).toBe(CONTENT_HEIGHT);
    expect(scroll.scrollTop).toBe(CONTENT_HEIGHT - VIEWPORT_HEIGHT);
  });

  it("leaves a reader who scrolled away alone when the slack appears or disappears", () => {
    const view = threadView([turn("t1", "First question", SETTLED, [text("alpha beta")])]);
    const hits = findInThread(view.thread, "beta", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });

    render({ thread: view });
    const scroll = elasticScrollContainer(CONTENT_HEIGHT, VIEWPORT_HEIGHT);
    scroll.scrollTop = 120;
    act(() => scroll.dispatchEvent(new Event("scroll")));

    render({ thread: view, findQuery: "beta", findHits: hits });

    expect(scroll.scrollTop).toBe(120);
  });

  it("still parses an on-screen answer in the first commit inside the ledger structure", () => {
    const viewport = viewportPort(true);
    render({
      thread: threadView([turn("t1", "First question", SETTLED, [text(markdown("alpha"))])]),
      markdownViewport: viewport.port,
    });

    const body = host.querySelector<HTMLElement>(".agent-text");
    expect(body?.getAttribute("data-agent-markdown")).toBe("rendered");
    expect(body?.closest(".agent-answer")).not.toBeNull();
    expect(viewport.observed()).toEqual([]);
  });

  it("still defers an off-screen answer and observes it inside the scroll root", () => {
    const viewport = viewportPort(false);
    render({
      thread: threadView([turn("t1", "First question", SETTLED, [text(markdown("alpha"))])]),
      markdownViewport: viewport.port,
    });

    const body = host.querySelector<HTMLElement>(".agent-text");
    expect(body?.getAttribute("data-agent-markdown")).toBe("deferred");
    expect(viewport.observed()).toEqual([body]);
    expect(host.querySelector(".agent-session__scroll")?.contains(body as Node)).toBe(true);
  });

  it("holds the bottom while a banded turn streams and after it settles", () => {
    const streaming = threadView([
      turn("t1", "First question", SETTLED, [text("alpha")]),
      turn("t2", "Second question", RUNNING, [text(markdown("live"))]),
    ]);
    render({ thread: streaming });
    const scroll = scrollContainer({ scrollHeight: 1_400, clientHeight: 300, scrollTop: 0 });

    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", RUNNING, [text(markdown("live")), text("more")]),
      ]),
    });
    expect(scroll.scrollTop).toBe(1_400);

    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text(markdown("live")), text("more")]),
      ]),
    });

    expect(scroll.scrollTop).toBe(1_400);
    expect(
      [...host.querySelectorAll(".agent-text")].map((element) =>
        element.getAttribute("data-agent-markdown"),
      ),
    ).toEqual(["rendered", "rendered", "rendered"]);
    expect(host.querySelector("h2")?.textContent).toBe("live");
    expect(host.textContent).not.toContain("## live");
  });

  it("renders every block type inside the answer of its own turn", () => {
    const events: AgentTurnEvent[] = [
      { kind: "reasoning", text: "Thinking about it" },
      { kind: "toolCall", toolId: "tool-1", name: "Read", inputSummary: "src/app.ts" },
      { kind: "toolResult", toolId: "tool-1", outputSummary: "12 lines", isError: false },
      { kind: "subagent", status: "running", toolId: "tool-2", subagentType: "review" },
      { kind: "assistantText", text: tableAndCode() },
      { kind: "contextCompaction", beforeTokens: 42_100, afterTokens: 9_300 },
      { kind: "error", message: "npm ERR! missing script: debug" },
      { kind: "result", text: "All done", isError: false, usage: null },
    ];
    render({
      thread: threadView([
        { ...turn("t1", "First question", SETTLED, events), eventsTruncated: true },
      ]),
      textClipboard: { canWriteText: () => true, writeText: async () => undefined },
    });

    const answer = host.querySelector<HTMLElement>(".agent-answer");
    expect(answer).not.toBeNull();
    for (const selector of [
      ".agent-reasoning",
      ".agent-tool",
      ".agent-subagents",
      ".agent-text",
      ".agent-md__table-scroll",
      ".agent-md__code-body",
      ".agent-compaction-event",
      ".agent-finale",
      ".agent-note--warning",
      ".agent-answer__end",
    ]) {
      const element = answer?.querySelector(selector);
      expect(element, selector).not.toBeNull();
    }
    expect(host.querySelector(".agent-band__text")?.textContent).toBe("First question");
    expect(host.querySelector(".agent-band__meta")?.textContent).toContain("ago");
  });

  function numbers(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-band__number")].map(
      (element) => element.textContent ?? "",
    );
  }

  function bandTexts(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-band__text")].map(
      (element) => element.textContent ?? "",
    );
  }

  function bandClasses(): ReadonlyArray<string> {
    return [...host.querySelectorAll("header.agent-band")].map((element) => element.className);
  }

  function elasticScrollContainer(content: number, viewport: number): HTMLDivElement {
    const scroll = host.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    let top = 0;
    Object.defineProperties(scroll, {
      scrollHeight: {
        configurable: true,
        get: () =>
          content +
          (host.querySelector(".agent-session__reveal-slack") === null ? 0 : REVEAL_INSET),
      },
      clientHeight: { configurable: true, value: viewport },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          const element = scroll as HTMLDivElement;
          top = Math.max(0, Math.min(value, element.scrollHeight - viewport));
        },
      },
    });
    return scroll as HTMLDivElement;
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

function declaration(selector: string, property: string): string | null {
  const values = STYLES.rules
    .filter((rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector))
    .flatMap((rule) =>
      rule.declarations
        .filter((entry) => entry.property === property)
        .map((entry) => entry.value.trim()),
    );
  return values[values.length - 1] ?? null;
}

function markdown(title: string): string {
  return `## ${title}\n\nA paragraph about **${title}** written in markdown.`;
}

function tableAndCode(): string {
  return [
    "| file | change |",
    "| --- | --- |",
    "| app.ts | edited |",
    "",
    "```ts",
    "const answer = 42;",
    "```",
  ].join("\n");
}

function text(value: string): AgentTurnEvent {
  return { kind: "assistantText", text: value };
}

function turn(
  turnId: string,
  prompt: string,
  status: AgentTurnStatus,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentTurn {
  return {
    turnId: `agt-1-${turnId}`,
    prompt,
    status,
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: status.kind === "running" ? null : NOW - 30_000,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function threadView(
  turns: ReadonlyArray<AgentTurn>,
  overrides: {
    readonly turnsTruncated?: boolean;
    readonly exchanges?: ReadonlyArray<ExternalSessionExchange>;
  } = {},
): AgentThreadView {
  const exchanges = overrides.exchanges;
  const externalOrigin: AgentThread["externalOrigin"] =
    exchanges === undefined
      ? null
      : {
          provider: "claudeCode",
          sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
          importedAtEpochMs: NOW - 60_000,
          history: {
            provider: "claudeCode",
            sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
            exchanges,
            exchangesTruncated: false,
            totalPreviewBytes: 32,
          },
        };
  const record: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 600_000,
    updatedAtEpochMs: NOW - 60_000,
    turns,
    turnsTruncated: overrides.turnsTruncated ?? false,
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
    lifecycle: turns.some((entry) => entry.status.kind === "running") ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
