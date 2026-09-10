// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import { sharedAgentMarkdownDocumentCache } from "../../application/agentMarkdownDocumentCache";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { MAX_AGENT_MARKDOWN_CHARS } from "../../domain/agentMarkdown/agentMarkdownTree";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { findInThread, type AgentThreadFindHit } from "../../domain/agentThreadSearch";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const STYLES = parseAllStyleSheets();

const OWNER_TABLE = [
  "Výsledky kontroly:",
  "",
  "| kontrola | výsledok |",
  "|---|---|",
  "| lint | ok |",
  "| typecheck | ok |",
].join("\n");

const RICH = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "Some **bold**, _emphasis_ and `inline code`.",
  "",
  "- first item",
  "- second item",
  "",
  "```ts",
  "const parser = createParser();",
  "```",
].join("\n");

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

const MESSAGE_HEIGHT = 100;
const VIEW_HEIGHT = 250;

interface ScrollDrivenViewport {
  readonly port: AgentMarkdownViewport;
  observed(): ReadonlyArray<Element>;
}

function scrollDrivenViewport(scrollTop: () => number): ScrollDrivenViewport {
  const waiting = new Map<Element, () => void>();
  const within = (element: Element): boolean => {
    const bodies = [...document.querySelectorAll("[data-agent-event]")];
    const top = bodies.indexOf(element) * MESSAGE_HEIGHT;
    return top + MESSAGE_HEIGHT >= scrollTop() && top <= scrollTop() + VIEW_HEIGHT;
  };
  return {
    port: {
      contains: within,
      observe(element, onEnter) {
        waiting.set(element, onEnter);
        return () => {
          waiting.delete(element);
        };
      },
      remeasure() {
        for (const [element, onEnter] of [...waiting]) {
          if (!within(element)) continue;
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

describe("imported conversation history", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    sharedAgentMarkdownDocumentCache().clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("renders the owner's GitHub table in an imported answer instead of literal pipes", () => {
    render({ thread: imported([user("Ako to dopadlo?"), assistant(OWNER_TABLE)]) });

    const body = importedMessage(1);
    expect(body.getAttribute("data-agent-markdown")).toBe("rendered");
    expect(body.textContent).not.toContain("|");
    expect(
      body.querySelector("table.agent-md__table")?.closest(".agent-md__table-scroll"),
    ).not.toBe(null);
    expect([...body.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "kontrola",
      "výsledok",
    ]);
    expect([...body.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "lint",
      "ok",
      "typecheck",
      "ok",
    ]);
  });

  it("renders headings, emphasis, inline code, lists and fenced code in imported answers", () => {
    render({ thread: imported([user("Zhrň to"), assistant(RICH)]) });
    const body = importedMessage(1);

    expect(body.querySelector("h1.agent-md__heading")?.textContent).toBe("Heading one");
    expect(body.querySelector("h2.agent-md__heading")?.textContent).toBe("Heading two");
    expect(body.querySelector("strong")?.textContent).toBe("bold");
    expect(body.querySelector("em")?.textContent).toBe("emphasis");
    expect(body.querySelector("code.agent-md__inline-code")?.textContent).toBe("inline code");
    expect(
      [...body.querySelectorAll("ul.agent-md__list > li")].map((li) => li.textContent),
    ).toEqual(["first item", "second item"]);
    expect(body.querySelector(".agent-md__code")?.getAttribute("data-language")).toBe("ts");
    expect(body.querySelector("pre.agent-md__code-body > code")?.textContent).toBe(
      "const parser = createParser();",
    );
  });

  it("escapes raw HTML and strips javascript links and non-http images in imported answers", () => {
    render({
      thread: imported([
        user("Skús toto"),
        assistant(
          '<img src="x" onerror="alert(1)"><script>globalThis.pwned = true</script>\n\n[go](javascript:alert(1)) [ok](https://example.com) ![pic](data:image/png;base64,AAAA)',
        ),
      ]),
    });
    const body = importedMessage(1);

    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain('<img src="x" onerror="alert(1)">');
    const links = [...body.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([null, "https://example.com"]);
    expect(body.querySelector(".agent-md__image")?.getAttribute("href")).toBeNull();
  });

  it("copies the original markdown source of an imported answer, not the rendered text", async () => {
    const writeText = vi.fn(async () => undefined);
    render({
      thread: imported([user("Ako to dopadlo?"), assistant(OWNER_TABLE)]),
      textClipboard: { canWriteText: () => true, writeText },
    });

    const copy = importedMessage(1).querySelector<HTMLButtonElement>(
      'button[aria-label="Copy AI response"]',
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(OWNER_TABLE);
  });

  it("falls back to plain paragraphs without throwing when imported markdown cannot be parsed", () => {
    const broken: AgentMarkdownRenderer = {
      lexBlocks() {
        throw new Error("malformed");
      },
      renderBlock() {
        throw new Error("malformed");
      },
      renderDocument() {
        throw new Error("malformed");
      },
    };

    render({
      thread: imported([user("Skús"), assistant("First **unclosed\n\nSecond paragraph")]),
      markdownRenderer: broken,
    });

    const body = importedMessage(1);
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect([...body.querySelectorAll("p.agent-text__paragraph")].map((p) => p.textContent)).toEqual(
      ["First **unclosed", "Second paragraph"],
    );
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      "Shown as plain text: the response could not be formatted.",
    );
  });

  it("keeps the bounded state truthful for an oversized imported answer", () => {
    const text = `# Title\n\n${"x".repeat(MAX_AGENT_MARKDOWN_CHARS)}`;
    render({ thread: imported([user("Vypíš to"), assistant(text)]) });

    const body = importedMessage(1);
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect(body.querySelector("h1")).toBeNull();
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      `Shown as plain text: the response is longer than ${MAX_AGENT_MARKDOWN_CHARS.toLocaleString("en-US")} characters, the limit for formatting.`,
    );
  });

  it("parses an on-screen imported answer in the first commit and defers an off-screen one", () => {
    const near = viewportPort(true);
    render({
      thread: imported([user("Ako to dopadlo?"), assistant(OWNER_TABLE)]),
      markdownViewport: near.port,
    });
    expect(importedMessage(1).getAttribute("data-agent-markdown")).toBe("rendered");
    expect(importedMessage(1).textContent).not.toContain("| kontrola |");
    expect(near.observed()).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    const far = viewportPort(false);
    render({
      thread: imported([user("Ako to dopadlo?"), assistant(OWNER_TABLE)]),
      markdownViewport: far.port,
    });

    const deferred = importedMessage(1);
    expect(deferred.getAttribute("data-agent-markdown")).toBe("deferred");
    expect(deferred.querySelector("table")).toBeNull();
    expect(far.observed()).toEqual([deferred]);
    expect(host.querySelector(".agent-session__scroll")?.contains(deferred)).toBe(true);
  });

  it("parses the visible tail in the first painted commit after a freshly loaded history scrolls", () => {
    const exchanges = [
      ...Array.from({ length: 7 }, (_, index) => [
        user(`Question ${index}`),
        assistant(`Answer ${index}`),
      ]).flat(),
      user("Ako to dopadlo?"),
      assistant(OWNER_TABLE),
    ];
    let top = 0;
    const viewport = scrollDrivenViewport(() => top);

    render({
      thread: imported(null, []),
      externalHistoryState: "loading",
      markdownViewport: viewport.port,
    });

    const scroll = host.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: VIEW_HEIGHT },
      scrollHeight: {
        configurable: true,
        get: () => document.querySelectorAll("[data-agent-event]").length * MESSAGE_HEIGHT,
      },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          const element = scroll as HTMLDivElement;
          top = Math.max(0, Math.min(value, element.scrollHeight - VIEW_HEIGHT));
        },
      },
    });

    render({
      thread: imported(exchanges, []),
      externalHistoryState: "ready",
      markdownViewport: viewport.port,
    });

    expect(top).toBe(8 * MESSAGE_HEIGHT - VIEW_HEIGHT);
    const tail = importedMessage(15);
    expect(tail.getAttribute("data-agent-markdown")).toBe("rendered");
    expect(tail.textContent).not.toContain("| kontrola |");
    expect(tail.querySelector("table.agent-md__table")).not.toBeNull();
    expect(viewport.observed()).not.toContain(tail);

    const offScreen = importedMessage(9);
    expect(offScreen.getAttribute("data-agent-markdown")).toBe("deferred");
    expect(viewport.observed()).toContain(offScreen);
  });

  it("finds a match inside an imported answer and reveals it with a centred scroll", () => {
    const options: unknown[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element, argument: unknown): void {
        options.push(argument);
      },
      writable: true,
    });
    const thread = imported([user("Kde je parser?"), assistant("The parser lives in src.")]);
    const hits = hitsFor(thread, "parser");
    expect(hits.map((hit) => hit.scope)).toEqual(["imported", "imported"]);

    render({
      thread,
      findQuery: "parser",
      findHits: hits,
      findHitIndex: 1,
      markdownViewport: viewportPort(false).port,
    });

    const current = host.querySelectorAll<HTMLElement>("mark.agent-find__hit--current");
    expect(current).toHaveLength(1);
    expect(current[0]?.closest('[data-agent-event="x1"]')).not.toBeNull();
    expect(importedMessage(1).getAttribute("data-agent-markdown")).toBe("rendered");
    expect(options).toEqual([{ block: "center" }]);
    expect(declaration(".agent-find__hit", "scroll-margin-top")).toBeNull();
    expect(host.querySelector(".agent-session__reveal-slack")).toBeNull();
  });

  it("highlights a match inside an imported prompt bubble", () => {
    const thread = imported([user("Where does the parser live"), assistant("It lives in src.")]);
    const hits = hitsFor(thread, "parser");

    render({ thread, findQuery: "parser", findHits: hits, findHitIndex: 0 });

    const prompt = host.querySelector<HTMLElement>(".agent-prompt__body");
    expect(prompt?.querySelector("mark.agent-find__hit--current")).not.toBeNull();
    expect(prompt?.textContent).toBe("Where does the parser live");
  });

  it("degrades an imported answer to plain text when a match sits inside markdown syntax", () => {
    const thread = imported([user("Tabuľka"), assistant(OWNER_TABLE)]);
    const hits = hitsFor(thread, "|---");
    expect(hits).toHaveLength(2);

    render({ thread, findQuery: "|---", findHits: hits, findHitIndex: 1 });

    const body = importedMessage(1);
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      "Shown as plain text while searching: some matches sit inside Markdown formatting.",
    );
    expect(body.querySelector("mark.agent-find__hit--current")?.textContent).toBe("|---");
    expect(body.querySelectorAll("mark.agent-find__hit")).toHaveLength(2);
    expect(body.querySelector("table")).toBeNull();
  });

  it("gives each imported exchange its own turn with a bubble and a head", () => {
    render({
      thread: imported([
        user("First imported"),
        assistant("alpha"),
        user("Second imported"),
        assistant("beta"),
      ]),
    });

    const turns = [...host.querySelectorAll<HTMLElement>(".agent-imported-history > .agent-turn")];
    expect(turns).toHaveLength(2);
    for (const section of turns) {
      expect([...section.children].map((child) => child.className)).toEqual([
        "agent-prompt",
        "agent-answer",
      ]);
      expect(section.querySelectorAll("header.agent-turn__head")).toHaveLength(1);
    }
    expect(turns[0]?.nextElementSibling).toBe(turns[1]);
    expect(promptTexts()).toEqual(["First imported", "Second imported"]);
  });

  it("labels an imported answer on an element that honours aria-label", () => {
    render({ thread: imported([user("Ako to dopadlo?"), assistant(OWNER_TABLE)]) });

    const body = importedMessage(1);
    expect(body.getAttribute("role")).toBe("article");
    expect(body.getAttribute("aria-label")).toBe("Imported AI response");
    expect(host.querySelector('[aria-label="Imported AI response"]')).toBe(body);
  });

  it("leaves a live answer unlabelled and role-less", () => {
    render({ thread: native([liveTurn("t1", "First live")]) });

    const body = host.querySelector<HTMLElement>('[data-agent-event="e0"]');
    expect(body?.getAttribute("role")).toBeNull();
    expect(body?.getAttribute("aria-label")).toBeNull();
  });

  it("keeps one turn-gap rhythm at the seam and inside the imported history", () => {
    expect(declaration(".agent-session__body", "gap")).toBe("var(--agent-turn-gap)");
    expect(declaration(".agent-imported-history", "gap")).toBe("var(--agent-turn-gap)");
    expect(declaration(".agent-turn-list", "gap")).toBe("var(--agent-turn-gap)");
    expect(declaration(".agent-answer", "padding-bottom")).toBeNull();
  });

  it("renders imported and live turns with the same bubble and head structure", () => {
    render({
      thread: imported(
        [user("First imported"), assistant("alpha"), user("Second imported"), assistant("beta")],
        [liveTurn("t1", "First live"), liveTurn("t2", "Second live")],
      ),
    });

    expect(promptTexts()).toEqual([
      "First imported",
      "Second imported",
      "First live",
      "Second live",
    ]);
    expect(
      [...host.querySelectorAll<HTMLElement>("article.agent-turn")].map((section) =>
        [...section.children].map((child) => child.className),
      ),
    ).toEqual([
      ["agent-prompt", "agent-answer"],
      ["agent-prompt", "agent-answer"],
      ["agent-prompt", "agent-answer"],
      ["agent-prompt", "agent-answer"],
    ]);
    expect(
      [...host.querySelectorAll(".agent-turn__agent")].map((element) => element.textContent),
    ).toEqual(["Claude Code", "Claude Code", "Claude Code", "Claude Code"]);
  });

  it("keeps both truncation notices while every prompt still renders", () => {
    render({
      thread: imported(
        [user("First imported"), assistant("alpha")],
        [liveTurn("t1", "First live")],
        { exchangesTruncated: true },
      ),
    });

    expect(promptTexts()).toEqual(["First imported", "First live"]);
    expect(host.textContent).toContain("Only part of the original conversation is available.");

    render({
      thread: imported(
        [user("First imported"), assistant("alpha")],
        [liveTurn("t1", "First live")],
        { turnsTruncated: true },
      ),
    });

    expect(promptTexts()).toEqual(["First imported", "First live"]);
    expect(host.textContent).toContain("Earlier turns were dropped to bound memory.");
  });

  it("states while the imported history has not loaded yet", () => {
    render({
      thread: imported(null, [liveTurn("t1", "First live")]),
      externalHistoryState: "loading",
    });

    expect(host.textContent).toContain("Loading original conversation…");
    expect(promptTexts()).toEqual(["First live"]);
  });

  it("states when the imported session held no messages at all", () => {
    render({ thread: imported([]) });

    expect(host.textContent).toContain("No user or assistant messages were found in this session.");
    expect(host.querySelectorAll(".agent-imported-history > .agent-turn")).toHaveLength(0);
  });

  function promptTexts(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-prompt__body")].map(
      (element) => element.textContent ?? "",
    );
  }

  function importedMessage(exchangeIndex: number): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-agent-event="x${exchangeIndex}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
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

function user(text: string): ExternalSessionExchange {
  return { role: "user", text };
}

function assistant(text: string): ExternalSessionExchange {
  return { role: "assistant", text };
}

function hitsFor(thread: AgentThreadView, query: string): ReadonlyArray<AgentThreadFindHit> {
  return findInThread(thread.thread, query, { maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN });
}

function liveTurn(turnId: string, prompt: string): AgentTurn {
  return {
    turnId: `agt-1-${turnId}`,
    prompt,
    status: SETTLED,
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: NOW - 30_000,
    events: [{ kind: "assistantText", text: "done" }],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function imported(
  exchanges: ReadonlyArray<ExternalSessionExchange> | null,
  turns: ReadonlyArray<AgentTurn> = [],
  overrides: { readonly exchangesTruncated?: boolean; readonly turnsTruncated?: boolean } = {},
): AgentThreadView {
  return threadView(turns, overrides.turnsTruncated ?? false, {
    provider: "claudeCode",
    sessionId: SESSION_ID,
    importedAtEpochMs: NOW - 60_000,
    ...(exchanges === null
      ? {}
      : {
          history: {
            provider: "claudeCode",
            sessionId: SESSION_ID,
            exchanges,
            exchangesTruncated: overrides.exchangesTruncated ?? false,
            totalPreviewBytes: 32,
          },
        }),
  });
}

function native(turns: ReadonlyArray<AgentTurn>): AgentThreadView {
  return threadView(turns, false, null);
}

function threadView(
  turns: ReadonlyArray<AgentTurn>,
  turnsTruncated: boolean,
  externalOrigin: AgentThread["externalOrigin"],
): AgentThreadView {
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
    turnsTruncated,
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
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
