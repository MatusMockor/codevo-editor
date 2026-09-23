// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { AgentQueuedPrompt } from "./AgentQueuedPrompt";
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
    expect(prompt?.querySelector(".agent-prompt__bubble p.agent-prompt__body")).not.toBeNull();
    expect(declaration(".agent-prompt__bubble", "max-width")).toBe("85%");
    expect(declaration(".agent-prompt", "justify-content")).toBe("flex-end");
    expect(declaration(".agent-prompt__bubble", "border-radius")).toBe("var(--agent-radius-xl)");
    expect(declaration(".agent-prompt__bubble", "background")).toBe("var(--agent-raised)");
    expect(declaration(".agent-prompt__bubble", "box-shadow")).toBe("var(--agent-shadow-raised)");
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

  it("renders a steered user message in its own prompt bubble between the answers", () => {
    render({
      thread: threadView([
        turn("t1", "First question", SETTLED, [
          text("alpha"),
          { kind: "userMessage", text: "also run the tests" },
          text("beta"),
        ]),
      ]),
    });

    expect(promptTexts()).toEqual(["First question", "also run the tests"]);
    const events = [...(host.querySelector(".agent-turn__events")?.children ?? [])];
    expect(events.map((child) => child.className)).toEqual([
      "agent-text",
      "agent-prompt agent-prompt--steered",
      "agent-text",
    ]);
    expect(events[1]?.querySelector(".agent-prompt__body")?.textContent).toBe("also run the tests");
    expect(events[1]?.getAttribute("data-agent-event")).toBe("e1");
  });

  it("keeps app-server subagent output in a collapsible group with latest thread usage", () => {
    render({
      thread: threadView([
        turn("t1", "Delegate", RUNNING, [
          {
            kind: "subagentActivity",
            agentThreadId: "child",
            agentPath: "tests",
            activity: "started",
          },
          {
            kind: "subagentEvent",
            agentThreadId: "child",
            event: { kind: "assistantText", text: "Child-only response" },
          },
          {
            kind: "subagentUsage",
            agentThreadId: "child",
            usage: { inputTokens: 10, outputTokens: 5, contextTokens: null },
          },
          {
            kind: "subagentUsage",
            agentThreadId: "child",
            usage: {
              inputTokens: 20,
              outputTokens: 8,
              cachedInputTokens: 3,
              reasoningOutputTokens: 2,
              contextTokens: null,
            },
          },
          { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 4200, isError: false },
          text("Parent response"),
        ]),
      ]),
    });
    const group = Array.from(
      host.querySelectorAll<HTMLDetailsElement>("details.agent-reasoning"),
    ).find((entry) => entry.querySelector("summary")?.textContent?.includes("tests"));
    expect(group?.open).toBe(false);
    expect(group?.textContent).toContain("Child-only response");
    expect(group?.textContent).not.toContain("Parent response");
    expect(group?.querySelector("summary")?.textContent).toContain("4s · 28 tok");
    expect(group?.textContent).not.toContain("Subagent total");
    expect(group?.textContent).not.toContain("20 in");
    act(() => host.querySelector<HTMLButtonElement>(".agent-spawn__row")?.click());
    const member = host.querySelector<HTMLElement>(".agent-spawn-member");
    expect(member?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(member?.textContent).toContain("28 tok");
    expect(member?.textContent).toContain("Child-only response");
    expect(member?.textContent).not.toContain("Parent response");
  });

  it("keeps thread and per-turn token usage out of the transcript", () => {
    render({
      thread: threadView([
        turn("t1", "Prompt", RUNNING, [
          {
            kind: "result",
            text: "Done",
            isError: false,
            usage: {
              scope: "thread",
              inputTokens: 120,
              outputTokens: 35,
              cachedInputTokens: 40,
              reasoningOutputTokens: 8,
              contextTokens: null,
            },
          },
        ]),
        turn("t2", "Follow up", RUNNING, [
          {
            kind: "result",
            text: "Done again",
            isError: false,
            usage: { inputTokens: 4, outputTokens: 230, contextTokens: 4 },
          },
        ]),
      ]),
    });
    const transcript = host.textContent ?? "";
    expect(transcript).toContain("Done again");
    expect(transcript).not.toContain("Thread total");
    expect(transcript).not.toContain("This turn");
    expect(transcript).not.toContain("120 in");
    expect(transcript).not.toContain("230 out");
    expect(host.querySelector("[title*='Tokens used']")).toBeNull();
  });

  it("shows a queue notice only when the provider reports accepted queueing", () => {
    render({
      thread: threadView([
        turn("t1", "Prompt", RUNNING, [
          { kind: "queued", threadId: "root", clientUserMessageId: null },
        ]),
      ]),
    });
    expect(host.querySelector(".agent-prompt__chip--queued")?.textContent).toBe("Queued");
  });

  it("shows an attachment count with the screenshot name in its tooltip for a deferred follow-up", () => {
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [])]),
      deferredFollowUps: [
        {
          id: "deferred-image",
          queuedAtEpochMs: NOW,
          request: {
            threadId: "agt-1",
            prompt: "",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
            attachments: [
              {
                kind: "staged",
                attachmentId: "image-1",
                name: "screenshot.png",
                bytes: 42,
                mime: "image/png",
                width: 1,
                height: 1,
              },
            ],
          },
        },
      ],
    });
    expect(host.querySelector(".agent-prompt--queued")?.textContent).toContain("1 attachment");
    expect(host.querySelector(".agent-prompt__queue-attachments")?.getAttribute("title")).toBe(
      "screenshot.png",
    );
  });

  it.each([
    ["Image attachment", 1],
    ["Review screenshots", 2],
  ] as const)(
    "renders remote pending attachments for %s without staged attachment recipes",
    (prompt, displayAttachmentCount) => {
      render({
        thread: threadView([turn("t1", "First question", RUNNING, [])]),
        deferredFollowUps: [
          {
            id: "remote-image",
            queuedAtEpochMs: NOW,
            displayAttachmentCount,
            request: {
              threadId: "agt-1",
              prompt,
              launch: { provider: "codex", model: "default", mode: "default" },
            },
          },
        ],
      });
      const bubble = host.querySelector(".agent-prompt--queued");
      expect(bubble?.textContent).toContain(prompt);
      expect(bubble?.querySelector(".agent-prompt__queue-attachments")?.textContent).toBe(
        `${displayAttachmentCount} ${displayAttachmentCount === 1 ? "attachment" : "attachments"}`,
      );
    },
  );

  it.each([
    [1, "1 attachment"],
    [2, "2 attachments"],
    [8, "8 attachments"],
    [9, "8+ attachments"],
    [Number.MAX_SAFE_INTEGER, "8+ attachments"],
    [-1, null],
    [1.5, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
  ])("bounds display-only queued attachment count %s", (count, label) => {
    act(() =>
      root.render(
        <AgentQueuedPrompt
          id="remote-image"
          prompt=""
          displayAttachmentCount={count}
          onRemove={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector(".agent-prompt__queue-attachments")?.textContent ?? null).toBe(label);
    expect(
      host.querySelector(".agent-prompt__queue-attachments")?.getAttribute("title") ?? null,
    ).toBeNull();
  });

  it("queues deferred follow-ups under the last turn with a chip and a remove control", () => {
    const onRemoveDeferredFollowUp = vi.fn();
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]),
      deferredFollowUps: [
        {
          id: "deferred-1",
          request: {
            threadId: "agt-1",
            prompt: "and then ship it",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
          },
          queuedAtEpochMs: NOW,
        },
      ],
      onRemoveDeferredFollowUp,
    });

    const queued = host.querySelector<HTMLElement>(".agent-prompt--queued");
    expect(queued?.querySelector(".agent-prompt__body")?.textContent).toBe("and then ship it");
    expect(queued?.querySelector(".agent-prompt__queue-status")?.textContent).toBe("Queued");
    expect(host.querySelector(".agent-turn-list")?.nextElementSibling).toBe(queued?.parentElement);

    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove queued message"]',
    );
    act(() => remove?.click());
    expect(onRemoveDeferredFollowUp).toHaveBeenCalledWith("agt-1", "deferred-1");
  });

  it("offers a pencil on a queued bubble and reports the edit to the owner", () => {
    const onEditDeferredFollowUp = vi.fn();
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]),
      deferredFollowUps: [
        {
          id: "deferred-1",
          request: {
            threadId: "agt-1",
            prompt: "and then ship it",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
          },
          queuedAtEpochMs: NOW,
        },
      ],
      onEditDeferredFollowUp,
    });

    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit queued message"]');
    expect(edit?.className).toBe("agent-prompt__queue-action agent-prompt__queue-action--edit");
    expect(edit?.disabled).toBe(false);
    act(() => edit?.click());
    expect(onEditDeferredFollowUp).toHaveBeenCalledWith("agt-1", "deferred-1");
  });

  it("lets a queued message with attachments be edited", () => {
    const onEditDeferredFollowUp = vi.fn();
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]),
      deferredFollowUps: [
        {
          id: "deferred-image",
          request: {
            threadId: "agt-1",
            prompt: "compare these",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
            attachments: [
              {
                kind: "staged",
                attachmentId: "image-1",
                name: "screenshot.png",
                bytes: 42,
                mime: "image/png",
                width: 1,
                height: 1,
              },
            ],
          },
          queuedAtEpochMs: NOW,
        },
      ],
      onEditDeferredFollowUp,
    });

    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit queued message"]');
    expect(edit?.disabled).toBe(false);
    expect(host.querySelector(".agent-prompt__queue-note")).toBeNull();
    expect(host.querySelector(".agent-prompt__queue-attachments")?.textContent).toBe(
      "1 attachment",
    );
    act(() => edit?.click());
    expect(onEditDeferredFollowUp).toHaveBeenCalledWith("agt-1", "deferred-image");
  });

  it("marks a queued message under edit and withholds edit and send now", () => {
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]),
      deferredFollowUps: [
        {
          id: "deferred-1",
          request: {
            threadId: "agt-1",
            prompt: "and then ship it",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
          },
          queuedAtEpochMs: NOW,
          editLease: 3,
        },
      ],
      onEditDeferredFollowUp: vi.fn(),
      onSendDeferredFollowUpNow: vi.fn(),
    });

    expect(host.querySelector(".agent-prompt__queue-status")?.textContent).toBe("Editing");
    expect(host.querySelector('button[aria-label="Edit queued message"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Send queued message now"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Remove queued message"]')).not.toBeNull();
  });

  it("hides the pencil when the surface cannot edit queued messages", () => {
    render({
      thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]),
      deferredFollowUps: [
        {
          id: "deferred-1",
          request: {
            threadId: "agt-1",
            prompt: "and then ship it",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
          },
          queuedAtEpochMs: NOW,
        },
      ],
    });

    expect(host.querySelector('button[aria-label="Edit queued message"]')).toBeNull();
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
    expect(declaration(".agent-md__table", "width")).toBe("100%");
    expect(declaration(".agent-md__table", "max-width")).toBe("100%");
    expect(declaration(".agent-md__th", "white-space")).toBe("normal");
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
      ".agent-activity-group",
      ".agent-tool-row",
      ".agent-spawn",
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

  it("names a finished bash row by its program and shows the command in mono", () => {
    render({
      thread: threadView([
        turn("t1", "Find it", SETTLED, [
          { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "grep -rn needle src" },
          { kind: "toolResult", toolId: "t-1", outputSummary: "3 matches", isError: false },
          text("Found it."),
        ]),
      ]),
    });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    expect(row?.querySelector(".agent-tool-row__label")?.textContent).toBe("Ran grep");
    expect(row?.querySelector(".agent-tool-row__argument")?.textContent).toBe(
      "grep -rn needle src",
    );
    expect(row?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.getAttribute("type")).toBe("button");
    expect(row?.className).toBe("agent-tool-row");
  });

  it("shows the Claude bash description as the subject and the command as the argument", () => {
    render({
      thread: threadView([
        turn("t1", "Lint it", SETTLED, [
          {
            kind: "toolCall",
            toolId: "t-1",
            name: "Bash",
            inputSummary: "npm run lint -- --max-warnings 0",
            description: "Run the linter",
          },
          { kind: "toolResult", toolId: "t-1", outputSummary: "0 problems", isError: false },
          text("Clean."),
        ]),
      ]),
    });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    expect(row?.querySelector(".agent-tool-row__label")?.textContent).toBe("Run the linter");
    expect(row?.querySelector(".agent-tool-row__argument")?.textContent).toBe(
      "npm run lint -- --max-warnings 0",
    );

    act(() => row?.click());

    expect(host.querySelector(".agent-tool-row__command")?.textContent).toBe(
      "$ npm run lint -- --max-warnings 0",
    );
    expect(host.querySelector(".agent-tool-row__empty")).toBeNull();
  });

  it("keeps the verb on a command row that reports no description", () => {
    render({
      thread: threadView([
        turn("t1", "Lint it", SETTLED, [
          { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm run lint" },
          { kind: "toolResult", toolId: "t-1", outputSummary: "", isError: false },
          text("Clean."),
        ]),
      ]),
    });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    expect(row?.querySelector(".agent-tool-row__label")?.textContent).toBe("Ran npm run lint");

    act(() => row?.click());

    expect(host.querySelector(".agent-tool-row__empty")?.textContent).toBe("No output");
    expect(host.querySelector(".agent-tool-row__output")).toBeNull();
  });

  it("marks a failed row with the danger modifier and the failed verb", () => {
    render({
      thread: threadView([
        turn("t1", "Run it", SETTLED, [
          { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
          { kind: "toolResult", toolId: "t-1", outputSummary: "exit 1", isError: true },
          text("It failed."),
        ]),
      ]),
    });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    expect(row?.className).toBe("agent-tool-row agent-tool-row--failed");
    expect(row?.querySelector(".agent-tool-row__label")?.textContent).toBe("Failed npm test");
    expect(declaration(".agent-tool-row--failed .agent-tool-row__label", "color")).toBe(
      "var(--agent-danger)",
    );
  });

  it("discloses the command and the output when the row is clicked", () => {
    render({
      thread: threadView([
        turn("t1", "Run it", SETTLED, [
          { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm run lint" },
          { kind: "toolResult", toolId: "t-1", outputSummary: "0 problems", isError: false },
          text("Clean."),
        ]),
      ]),
    });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    const detail = host.querySelector<HTMLElement>(".agent-tool-row__detail");
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.getAttribute("aria-controls")).toBe(detail?.id);
    expect(detail?.hidden).toBe(true);

    act(() => row?.click());

    expect(row?.getAttribute("aria-expanded")).toBe("true");
    expect(detail?.hidden).toBe(false);
    expect(detail?.querySelector(".agent-tool-row__command")?.textContent).toBe("$ npm run lint");
    expect(detail?.querySelector(".agent-tool-row__output")?.textContent).toBe("0 problems");

    act(() => row?.click());

    expect(host.querySelector<HTMLElement>(".agent-tool-row__detail")?.hidden).toBe(true);
  });

  it("never animates a call left unresolved by a stopped or finished turn", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
    ];
    render({ thread: threadView([turn("t1", "Run it", { kind: "stopped" }, events)]) });

    expect(host.querySelector("button.agent-tool-row")?.className).toBe(
      "agent-tool-row agent-tool-row--stopped",
    );
    expect(host.querySelector(".agent-tool-row__label")?.textContent).toBe("Stopped npm test");

    render({
      thread: threadView([turn("t1", "Run it", { kind: "failed", message: "boom" }, events)]),
    });

    expect(host.querySelector("button.agent-tool-row")?.className).toBe(
      "agent-tool-row agent-tool-row--interrupted",
    );
    expect(host.querySelector(".agent-tool-row__label")?.textContent).toBe("Interrupted npm test");
    expect(host.querySelector(".agent-tool-row--running")).toBeNull();

    render({
      thread: threadView([turn("t1", "Run it", { kind: "exited", exitCode: 0 }, events)]),
    });

    expect(host.querySelector("button.agent-tool-row")?.className).toBe("agent-tool-row");
    expect(host.querySelector(".agent-tool-row__label")?.textContent).toBe("Ran npm test");
  });

  it("keeps a row expanded when the turn settles and the work fold remounts", () => {
    const call: AgentTurnEvent = {
      kind: "toolCall",
      toolId: "t-1",
      name: "Bash",
      inputSummary: "npm test",
    };
    const result: AgentTurnEvent = {
      kind: "toolResult",
      toolId: "t-1",
      outputSummary: "ok",
      isError: false,
    };
    render({ thread: threadView([turn("t1", "Run it", RUNNING, [call, result])]) });

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row");
    expect(host.querySelector(".agent-tool-row__output")).toBeNull();

    act(() => row?.click());

    expect(host.querySelector(".agent-tool-row__output")?.textContent).toBe("ok");

    render({ thread: threadView([turn("t1", "Run it", SETTLED, [call, result])]) });

    expect(host.querySelector("button.agent-tool-row")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-tool-row__output")?.textContent).toBe("ok");
  });

  it("shows only the first Codex patch path with a count of the rest", () => {
    render({
      thread: threadView([
        turn("t1", "Patch it", SETTLED, [
          {
            kind: "toolCall",
            toolId: "t-1",
            name: "apply_patch",
            inputSummary: `${ROOT}/src/a.ts, ${ROOT}/src/b.ts`,
          },
          { kind: "toolResult", toolId: "t-1", outputSummary: "done", isError: false },
          text("Patched."),
        ]),
      ]),
    });

    expect(host.querySelector(".agent-tool-row__label")?.textContent).toBe(
      "Edited src/a.ts +1 more",
    );
  });

  it("shows a shimmering working row while the turn runs and drops it once settled", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "toolCall", toolId: "t-1", name: "Read", inputSummary: `${ROOT}/src/app.ts` },
      { kind: "toolResult", toolId: "t-1", outputSummary: "12 lines", isError: false },
    ];
    render({ thread: threadView([turn("t1", "Look", RUNNING, events)]) });

    const working = host.querySelector<HTMLElement>(".agent-tool-row--working");
    expect(working?.textContent).toBe("Working\u2026");
    expect(working?.getAttribute("role")).toBe("status");
    expect(working?.parentElement?.className).toBe("agent-work__events");
    expect(working?.previousElementSibling?.className).toContain("agent-tool-row__detail");
    expect(host.querySelector("button.agent-tool-row")?.textContent).toContain("Read src/app.ts");

    render({ thread: threadView([turn("t1", "Look", SETTLED, events)]) });

    expect(host.querySelector(".agent-tool-row--working")).toBeNull();
  });

  it("announces the live activity through one persistent status element", () => {
    const call: AgentTurnEvent = {
      kind: "toolCall",
      toolId: "t-1",
      name: "Bash",
      inputSummary: "npm test",
    };
    render({ thread: threadView([turn("t1", "Run it", RUNNING, [call])]) });

    const live = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toBe("Running npm test");
    expect(live?.className).toBe("agent-tool-row-live");
    expect(host.querySelector(".agent-tool-row--working")).toBeNull();

    render({
      thread: threadView([
        turn("t1", "Run it", RUNNING, [
          call,
          { kind: "toolResult", toolId: "t-1", outputSummary: "ok", isError: false },
        ]),
      ]),
    });

    const after = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    expect(after).toBe(live);
    expect(after?.textContent).toBe("Working\u2026");
    expect(after?.className).toBe("agent-tool-row agent-tool-row--working");
    expect(host.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    expect(host.querySelector("button.agent-tool-row")?.getAttribute("aria-live")).toBe("off");
  });

  it("keeps the in-flight tool row shimmering instead of adding a working row", () => {
    render({
      thread: threadView([
        turn("t1", "Look", RUNNING, [
          { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
        ]),
      ]),
    });

    expect(host.querySelector(".agent-tool-row--working")).toBeNull();
    expect(host.querySelector("button.agent-tool-row")?.className).toBe(
      "agent-tool-row agent-tool-row--running",
    );
    expect(declaration(".agent-tool-row--running .agent-tool-row__label", "animation")).toBe(
      "agent-tool-row-shimmer 1800ms linear infinite",
    );
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
