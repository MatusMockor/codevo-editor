// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { MAX_AGENT_MARKDOWN_CHARS } from "../../domain/agentMarkdown/agentMarkdownTree";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { findInThread, type AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };

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
  "  - nested item",
  "",
  "1. ordered one",
  "2. ordered two",
  "",
  "> a quoted line",
  "",
  "```ts",
  "const parser = createParser();",
  "```",
  "",
  "| col | value |",
  "|---|---|",
  "| parser | ready |",
].join("\n");

const FIND_TEXT = [
  "The parser starts here.",
  "",
  "- list parser item",
  "",
  "| name | state |",
  "|---|---|",
  "| parser | ready |",
  "",
  "```js",
  "const parser = 1;",
  "```",
].join("\n");

describe("AgentThreadSession markdown", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            onReviewInDiff={() => undefined}
            thread={null}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }

  function message(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-agent-event="e0"]');
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function currentHit(): HTMLElement {
    const marks = host.querySelectorAll<HTMLElement>("mark.agent-find__hit--current");
    expect(marks).toHaveLength(1);
    return marks[0] as HTMLElement;
  }

  it("renders the exact table the owner reported instead of literal pipes", () => {
    render({ thread: view(SETTLED, OWNER_TABLE) });

    const body = message();
    expect(body.getAttribute("data-agent-markdown")).toBe("rendered");
    expect(body.textContent).not.toContain("|");
    const table = body.querySelector("table.agent-md__table");
    expect(table?.closest(".agent-md__table-scroll")).not.toBeNull();
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

  it("renders headings, emphasis, inline code, lists, nested lists, quotes and fences", () => {
    render({ thread: view(SETTLED, RICH) });
    const body = message();

    expect(body.querySelector("h1.agent-md__heading")?.textContent).toBe("Heading one");
    expect(body.querySelector("h2.agent-md__heading")?.textContent).toBe("Heading two");
    expect(body.querySelector("strong")?.textContent).toBe("bold");
    expect(body.querySelector("em")?.textContent).toBe("emphasis");
    expect(body.querySelector("code.agent-md__inline-code")?.textContent).toBe("inline code");
    expect(body.querySelector("ul.agent-md__list > li > ul.agent-md__list > li")?.textContent).toBe(
      "nested item",
    );
    expect(
      [...body.querySelectorAll("ol.agent-md__list > li")].map((li) => li.textContent),
    ).toEqual(["ordered one", "ordered two"]);
    expect(body.querySelector("blockquote.agent-md__quote")?.textContent).toBe("a quoted line");
    const code = body.querySelector(".agent-md__code");
    expect(code?.getAttribute("data-language")).toBe("ts");
    expect(code?.querySelector(".agent-md__code-lang")?.textContent).toBe("ts");
    expect(code?.querySelector("pre.agent-md__code-body > code")?.textContent).toBe(
      "const parser = createParser();",
    );
    expect(body.querySelectorAll(":scope > p.agent-text__paragraph")).toHaveLength(1);
    expect(body.querySelectorAll("blockquote > p.agent-text__paragraph")).toHaveLength(1);
  });

  it("escapes raw HTML and strips javascript links and non-http images", () => {
    render({
      thread: view(
        SETTLED,
        '<img src="x" onerror="alert(1)"><script>globalThis.pwned = true</script>\n\n[go](javascript:alert(1)) [ok](https://example.com) ![pic](data:image/png;base64,AAAA)',
      ),
    });
    const body = message();

    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain('<img src="x" onerror="alert(1)">');
    const links = [...body.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([null, "https://example.com"]);
    expect(links[1]?.getAttribute("rel")).toBe("noopener");
    expect(body.querySelector(".agent-md__image")?.textContent).toBe("pic");
    expect(body.querySelector(".agent-md__image")?.getAttribute("href")).toBeNull();
  });

  it("copies the original markdown source, not the rendered text", async () => {
    const writeText = vi.fn(async () => undefined);
    render({ thread: view(SETTLED, OWNER_TABLE), textClipboard: clipboard(writeText) });

    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy AI response"]');
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(OWNER_TABLE);
  });

  it("offers a per-block copy that puts only that code on the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    render({ thread: view(SETTLED, RICH), textClipboard: clipboard(writeText) });

    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy ts code block"]');
    expect(copy?.closest(".agent-md__code")).not.toBeNull();
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith("const parser = createParser();");
  });

  it("finds and highlights matches in a paragraph, a list item, a table cell and a code block", () => {
    const thread = view(SETTLED, FIND_TEXT);
    const hits = hitsFor(thread, "parser");
    expect(hits).toHaveLength(4);

    const owners: string[] = [];
    for (let index = 0; index < hits.length; index += 1) {
      render({ thread, findQuery: "parser", findHits: hits, findHitIndex: index });
      const current = currentHit();
      expect(current.getAttribute("data-hit-index")).toBe(String(index));
      expect(host.querySelectorAll("mark.agent-find__hit")).toHaveLength(4);
      owners.push(owner(current));
    }

    expect(owners).toEqual(["p", "li", "td", "code"]);
    expect(message().getAttribute("data-agent-markdown")).toBe("rendered");
  });

  it("wraps from the last match back to the first when cycling", () => {
    const thread = view(SETTLED, FIND_TEXT);
    const hits = hitsFor(thread, "parser");

    render({ thread, findQuery: "parser", findHits: hits, findHitIndex: 3 });
    expect(owner(currentHit())).toBe("code");
    render({ thread, findQuery: "parser", findHits: hits, findHitIndex: 0 });
    expect(owner(currentHit())).toBe("p");
  });

  it("scrolls the current match inside a code block into view", () => {
    const scrolled: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    const thread = view(SETTLED, FIND_TEXT);

    render({ thread, findQuery: "parser", findHits: hitsFor(thread, "parser"), findHitIndex: 3 });

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.closest("pre.agent-md__code-body")).not.toBeNull();
  });

  it("degrades visibly to plain text when a match sits inside markdown syntax", () => {
    const thread = view(SETTLED, FIND_TEXT);
    const hits = hitsFor(thread, "|---");
    expect(hits).toHaveLength(2);

    render({ thread, findQuery: "|---", findHits: hits, findHitIndex: 1 });

    const body = message();
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      "Shown as plain text while searching: some matches sit inside Markdown formatting.",
    );
    expect(currentHit().textContent).toBe("|---");
    expect(currentHit().getAttribute("data-hit-index")).toBe("1");
    expect(body.querySelectorAll("mark.agent-find__hit")).toHaveLength(2);
    expect(body.querySelector("table")).toBeNull();

    render({ thread, findQuery: "", findHits: [], findHitIndex: undefined });
    expect(message().getAttribute("data-agent-markdown")).toBe("rendered");
    expect(message().querySelector("table")).not.toBeNull();
  });

  it("keeps an unterminated fence sane while streaming and settles to the one-shot render", () => {
    const live = (text: string): void => render({ thread: view(RUNNING, text) });
    const full = "Intro line.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter the code.";

    live("Intro line.\n\n```ts\nconst a");
    expect(message().querySelectorAll("p.agent-text__paragraph")).toHaveLength(1);
    expect(message().querySelector("pre.agent-md__code-body > code")?.textContent).toBe("const a");

    live("Intro line.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter");
    expect(message().querySelector("pre.agent-md__code-body > code")?.textContent).toBe(
      "const a = 1;\nconst b = 2;",
    );
    expect(message().querySelectorAll("p.agent-text__paragraph")).toHaveLength(2);

    live(full);
    render({ thread: view(SETTLED, full) });
    const streamed = message().innerHTML;

    act(() => root.unmount());
    root = createRoot(host);
    render({ thread: view(SETTLED, full) });

    expect(message().innerHTML).toBe(streamed);
  });

  it("shows a streaming pipe row as a table header before the delimiter row arrives", () => {
    const texts = ["Výsledky:\n\n| kontrola | výsledok |", "Výsledky:\n| kontrola | výsledok |"];
    for (const text of texts) {
      render({ thread: view(RUNNING, text) });

      expect(message().querySelectorAll("th")).toHaveLength(2);
      expect(message().textContent).not.toContain("|");
    }
  });

  it("falls back to plain paragraphs with a reason when the renderer throws", () => {
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
    const text = "First paragraph **unclosed\n\nSecond paragraph";

    render({ thread: view(SETTLED, text), markdownRenderer: broken });

    const body = message();
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect([...body.querySelectorAll("p.agent-text__paragraph")].map((p) => p.textContent)).toEqual(
      ["First paragraph **unclosed", "Second paragraph"],
    );
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      "Shown as plain text: the response could not be formatted.",
    );
  });

  it("shows the bounded state truthfully for an oversized response", async () => {
    const text = `# Title\n\n${"x".repeat(MAX_AGENT_MARKDOWN_CHARS)}`;
    const writeText = vi.fn(async () => undefined);
    render({ thread: view(SETTLED, text), textClipboard: clipboard(writeText) });

    const body = message();
    expect(body.getAttribute("data-agent-markdown")).toBe("plain");
    expect(body.querySelector("h1")).toBeNull();
    expect(body.querySelector("p.agent-text__paragraph")?.textContent).toBe("# Title");
    expect(body.querySelector(".agent-md__note")?.textContent).toBe(
      `Shown as plain text: the response is longer than ${MAX_AGENT_MARKDOWN_CHARS.toLocaleString("en-US")} characters, the limit for formatting.`,
    );
    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy AI response"]');
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith(text);
  });

  it("opens http links through the injected opener instead of navigating", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({
      thread: view(SETTLED, "[docs](https://example.com/docs) [bad](javascript:alert(1))"),
      openExternalLink,
    });

    const [safe, unsafe] = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__link")];
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      safe?.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(openExternalLink).toHaveBeenCalledWith("https://example.com/docs");

    const unsafeClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      unsafe?.dispatchEvent(unsafeClick);
    });
    expect(openExternalLink).toHaveBeenCalledTimes(1);
  });

  it("re-renders only the streaming message when a chunk arrives", () => {
    const first = "Settled **answer**.";
    const stream = (text: string): void =>
      render({
        thread: view(RUNNING, first, text),
      });
    stream("Live");
    const settledNode = host.querySelector('[data-agent-event="e0"] strong');

    stream("Live and more");

    expect(host.querySelector('[data-agent-event="e0"] strong')).toBe(settledNode);
    expect(host.querySelector('[data-agent-event="e1"]')?.textContent).toBe("Live and more");
  });
});

function clipboard(writeText: TextClipboardGateway["writeText"]): TextClipboardGateway {
  return { canWriteText: () => true, writeText };
}

function owner(mark: HTMLElement): string {
  const element = mark.closest("p, li, td, th, pre > code");
  expect(element).not.toBeNull();
  return (element as Element).tagName.toLowerCase();
}

function hitsFor(thread: AgentThreadView, query: string): ReadonlyArray<AgentThreadFindHit> {
  return findInThread(thread.thread, query, { maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN });
}

function view(status: AgentTurnStatus, ...texts: ReadonlyArray<string>): AgentThreadView {
  const turn: AgentTurn = {
    turnId: "agt-1-t1",
    prompt: "Check the project",
    status,
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: null,
    events: texts.map((text) => ({ kind: "assistantText", text })),
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  const running = status.kind === "running";
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [turn],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
