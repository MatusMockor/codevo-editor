// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("agent thread turns", () => {
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

  it("gives every turn a right-aligned prompt bubble and an answer under its own head", () => {
    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text("beta")]),
      ]),
    });

    const turns = [...host.querySelectorAll<HTMLElement>(".agent-turn")];
    expect(turns).toHaveLength(2);
    for (const section of turns) {
      expect([...section.children].map((child) => child.className)).toEqual([
        "agent-prompt",
        "agent-answer",
      ]);
      expect(section.querySelectorAll("header.agent-turn__head")).toHaveLength(1);
      expect(section.querySelector("header.agent-turn__head")?.parentElement?.className).toBe(
        "agent-answer",
      );
    }
    expect(turns[0]?.nextElementSibling).toBe(turns[1]);
    expect(turns[0]?.parentElement?.className).toBe("agent-turn-list");
    expect(promptTexts()).toEqual(["First question", "Second question"]);
    expect(declaration(".agent-turn-list", "gap")).toBe("var(--agent-turn-gap)");
    expect(declaration(".agent-turn", "gap")).toBe("var(--agent-turn-gap)");
    expect(declaration(".agent-answer", "gap")).toBe("var(--agent-space-4)");
  });

  it("caps the prompt bubble at 85% of the column and pins it to the right edge", () => {
    render({ thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])]) });

    const prompt = host.querySelector<HTMLElement>(".agent-prompt");
    expect(prompt?.querySelector("p.agent-prompt__body")?.textContent).toBe("First question");
    expect(declaration(".agent-prompt__body", "max-width")).toBe("85%");
    expect(declaration(".agent-prompt", "justify-content")).toBe("flex-end");
    expect(declaration(".agent-prompt__body", "border-radius")).toBe("var(--agent-radius-xl)");
    expect(declaration(".agent-prompt__body", "background")).toBe("var(--agent-raised)");
    expect(declaration(".agent-prompt__body", "box-shadow")).toBe("var(--agent-shadow-raised)");
  });

  it("renders an imported prompt through the same bubble and head as a live turn", () => {
    render({
      thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])], {
        exchanges: [
          { role: "user", text: "Original question" },
          { role: "assistant", text: "Original answer" },
        ],
      }),
    });

    const sections = [...host.querySelectorAll<HTMLElement>("article.agent-turn")];
    expect(sections).toHaveLength(2);
    expect(
      sections.map((section) => [...section.children].map((child) => child.className)),
    ).toEqual([
      ["agent-prompt", "agent-answer"],
      ["agent-prompt", "agent-answer"],
    ]);
    expect(promptTexts()).toEqual(["Original question", "First question"]);
    expect(headNames()).toEqual(["Claude Code", "Claude Code"]);
    expect(sections[0]?.parentElement?.className).toBe("agent-imported-history");
    expect(sections[1]?.parentElement?.className).toBe("agent-turn-list");
  });

  it("shows the accent dot, the provider and the settled duration in the turn head", () => {
    render({ thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])]) });

    const head = host.querySelector<HTMLElement>("header.agent-turn__head");
    expect([...(head?.children ?? [])].map((child) => child.className)).toEqual([
      "agent-turn__spark",
      "agent-turn__agent",
      "agent-turn__time agent-num",
      "agent-turn__duration agent-num",
    ]);
    expect(head?.querySelector(".agent-turn__spark")?.getAttribute("aria-hidden")).toBe("true");
    expect(head?.querySelector(".agent-turn__agent")?.textContent).toBe("Claude Code");
    expect(head?.querySelector("time")?.textContent).toContain("ago");
    expect(head?.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(NOW - 300_000).toISOString(),
    );
    expect(head?.querySelector(".agent-turn__duration")?.textContent).toBe("4m 30s");
  });

  it("drops the machine-readable time rather than throwing on an unusable timestamp", () => {
    render({
      thread: threadView([
        {
          ...turn("t1", "First question", SETTLED, [text("alpha")]),
          startedAtEpochMs: Number.NaN,
          endedAtEpochMs: null,
        },
      ]),
    });

    const time = host.querySelector("header.agent-turn__head time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBeNull();
    expect(host.querySelector(".agent-turn__agent")?.textContent).toBe("Claude Code");
  });

  it("keeps a running head counting and drops the duration when the end is unknown", () => {
    render({ thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]) });
    expect(host.querySelector(".agent-turn__duration")).not.toBeNull();

    render({
      thread: threadView([
        { ...turn("t1", "First question", SETTLED, [text("alpha")]), endedAtEpochMs: null },
      ]),
    });

    expect(host.querySelector(".agent-turn__duration")).toBeNull();
    expect(host.querySelector(".agent-turn__agent")?.textContent).toBe("Claude Code");
    expect(host.querySelector("header.agent-turn__head time")).not.toBeNull();
  });

  it("leaves an imported head without a time or a duration rather than an empty slot", () => {
    render({
      thread: threadView([], {
        exchanges: [
          { role: "user", text: "Original question" },
          { role: "assistant", text: "Original answer" },
        ],
      }),
    });

    const head = host.querySelector<HTMLElement>(".agent-imported-history header.agent-turn__head");
    expect([...(head?.children ?? [])].map((child) => child.className)).toEqual([
      "agent-turn__spark",
      "agent-turn__agent",
    ]);
    expect(head?.textContent).toBe("Claude Code");
  });

  it("keeps every prompt whole with no expand or jump control to chase", () => {
    render({
      thread: threadView([
        turn("t1", "A prompt\nthat runs\nacross\nmany separate lines", SETTLED, [text("alpha")]),
      ]),
    });

    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe(
      "A prompt\nthat runs\nacross\nmany separate lines",
    );
    expect(host.querySelector("button.agent-band__expand")).toBeNull();
    expect(host.querySelector("button.agent-band__jump")).toBeNull();
    expect(host.querySelector(".agent-answer__end")).toBeNull();
    expect(declaration(".agent-prompt__body", "-webkit-line-clamp")).toBeNull();
  });

  it("still warns and still shows every prompt when earlier turns were dropped", () => {
    const turns = [
      turn("t8", "Eighth question", SETTLED, [text("alpha")]),
      turn("t9", "Ninth question", SETTLED, [text("beta")]),
    ];

    render({ thread: threadView(turns, { turnsTruncated: true }) });

    expect(promptTexts()).toEqual(["Eighth question", "Ninth question"]);
    expect(host.textContent).toContain("Earlier turns were dropped to bound memory.");
  });

  it("keeps the table wrapper as the only overflow ancestor of a wide table", () => {
    const viewport = viewportPort(true);
    render({
      thread: threadView([turn("t1", "First question", SETTLED, [text(wideTable())])]),
      markdownViewport: viewport.port,
    });

    const table = host.querySelector<HTMLElement>("table.agent-md__table");
    const scroll = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(table).not.toBeNull();
    expect(scroll?.contains(table as Node)).toBe(true);

    const chain: HTMLElement[] = [];
    for (
      let ancestor = table?.parentElement ?? null;
      ancestor !== null && ancestor !== scroll;
      ancestor = ancestor.parentElement
    ) {
      chain.push(ancestor);
    }

    const overflowing = chain.flatMap((element) =>
      containingBlockDeclarations(element).filter((entry) => entry.includes("overflow")),
    );
    expect(overflowing).toEqual([
      "components/agentMode/agentThread.css .agent-md__table-scroll overflow-x",
    ]);
    expect(declaration(".agent-md__table", "width")).toBeNull();
    expect(declaration(".agent-md__table", "max-width")).toBe("100%");
    expect(declaration(".agent-md__th", "white-space")).toBeNull();
    expect(declaration(".agent-md__td", "overflow-wrap")).toBe("break-word");
    expect(declaration(".agent-md__td .agent-md__inline-code", "overflow-wrap")).toBe("anywhere");
  });

  it("highlights the current find hit inside the prompt bubble", () => {
    const view = threadView([
      turn("t1", "Where does the parser live and why", SETTLED, [text("alpha")]),
    ]);
    const hits = findInThread(view.thread, "parser", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    const first = hits[0];
    expect(first?.scope).toBe("turn");
    expect(first?.scope === "turn" ? first.eventIndex : undefined).toBeNull();

    render({ thread: view, findQuery: "parser", findHits: hits });
    expect(host.querySelector("mark.agent-find__hit--current")).toBeNull();

    render({ thread: view, findQuery: "parser", findHits: hits, findHitIndex: 0 });

    const prompt = host.querySelector<HTMLElement>(".agent-prompt__body");
    expect(prompt?.querySelector("mark.agent-find__hit--current")).not.toBeNull();
    expect(prompt?.textContent).toBe("Where does the parser live and why");
  });

  it("reveals a find hit with a centred scroll and no band inset to clear", () => {
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

    expect(options).toEqual([{ block: "center" }]);
    expect(host.querySelector("mark.agent-find__hit--current")).not.toBeNull();
    expect(declaration(".agent-find__hit", "scroll-margin-top")).toBeNull();
    expect(declaration(".agent-answer [data-agent-event]", "scroll-margin-top")).toBeNull();
    expect(host.querySelector(".agent-session__reveal-slack")).toBeNull();
  });

  it("reveals a whole turn from its top rather than from its middle", () => {
    const revealed: Array<{ readonly element: Element; readonly options: unknown }> = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element, argument: unknown): void {
        revealed.push({ element: this, options: argument });
      },
      writable: true,
    });

    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [text("alpha")]),
        turn("t2", "Second question", SETTLED, [text("beta")]),
      ]),
      reveal: { query: "", turnId: "agt-1-t2", eventIndex: null, start: 0, end: 0 },
    });

    const turns = [...host.querySelectorAll<HTMLElement>("[data-agent-turn]")];
    expect(revealed).toEqual([{ element: turns[1], options: { block: "start" } }]);
  });

  it("leaves a reader who scrolled away alone when a find query arrives", () => {
    const view = threadView([turn("t1", "First question", SETTLED, [text("alpha beta")])]);
    const hits = findInThread(view.thread, "beta", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });

    render({ thread: view });
    const scroll = scrollContainer({ scrollHeight: 1_400, clientHeight: 300, scrollTop: 0 });
    scroll.scrollTop = 120;
    act(() => scroll.dispatchEvent(new Event("scroll")));

    render({ thread: view, findQuery: "beta", findHits: hits });

    expect(scroll.scrollTop).toBe(120);
  });

  it("still parses an on-screen answer in the first commit inside the turn structure", () => {
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

  it("holds the bottom while a turn streams and after it settles", () => {
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
    ]) {
      const element = answer?.querySelector(selector);
      expect(element, selector).not.toBeNull();
    }
    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe("First question");
    expect(host.querySelector("header.agent-turn__head time")?.textContent).toContain("ago");
  });

  function promptTexts(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-prompt__body")].map(
      (element) => element.textContent ?? "",
    );
  }

  function headNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-turn__agent")].map(
      (element) => element.textContent ?? "",
    );
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

function wideTable(): string {
  return [
    "| command | result |",
    "| --- | --- |",
    "| `npm run lint -- --max-warnings 0 && npm run check && npm test -- --run` | passes on src/components/agentMode/AgentThreadSession.markdown.test.tsx |",
    "| `cargo clippy --all-targets -- -D warnings` | passes |",
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
