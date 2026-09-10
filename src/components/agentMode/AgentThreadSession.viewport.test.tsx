// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { sharedAgentMarkdownDocumentCache } from "../../application/agentMarkdownDocumentCache";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import { findInThread, type AgentThreadFindHit } from "../../domain/agentThreadSearch";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };

interface TestViewport {
  readonly port: AgentMarkdownViewport;
  observed(): ReadonlyArray<Element>;
  enter(element: Element): void;
  disposals(): number;
  measurements(): number;
}

function testViewport(near: (element: Element) => boolean = () => false): TestViewport {
  const waiting = new Map<Element, () => void>();
  let disposed = 0;
  let measured = 0;
  return {
    port: {
      contains(element) {
        measured += 1;
        return near(element);
      },
      observe(element, onEnter) {
        waiting.set(element, onEnter);
        return () => {
          waiting.delete(element);
        };
      },
      dispose() {
        disposed += 1;
        waiting.clear();
      },
    },
    observed: () => [...waiting.keys()],
    enter(element) {
      const onEnter = waiting.get(element);
      expect(onEnter).toBeDefined();
      waiting.delete(element);
      act(() => onEnter?.());
    },
    disposals: () => disposed,
    measurements: () => measured,
  };
}

interface CountingRenderer {
  readonly renderer: AgentMarkdownRenderer;
  documents(): number;
}

function countingRenderer(base: AgentMarkdownRenderer): CountingRenderer {
  let documents = 0;
  return {
    renderer: {
      lexBlocks: (markdown) => base.lexBlocks(markdown),
      renderBlock: (block) => base.renderBlock(block),
      renderDocument: (markdown) => {
        documents += 1;
        return base.renderDocument(markdown);
      },
    },
    documents: () => documents,
  };
}

function message(text: string): string {
  return `## ${text}\n\nA paragraph about **${text}** written in markdown.`;
}

const TOOL_WORK: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: "tool-1", name: "Read", inputSummary: "src/app.ts" },
  { kind: "toolResult", toolId: "tool-1", outputSummary: "12 lines", isError: false },
];

function thread(status: AgentTurnStatus, ...texts: ReadonlyArray<string>): AgentThreadView {
  return threadWithWork(status, [], texts);
}

function threadWithWork(
  status: AgentTurnStatus,
  work: ReadonlyArray<AgentTurnEvent>,
  texts: ReadonlyArray<string>,
): AgentThreadView {
  const turns: AgentTurn[] = texts.map((text, index) => ({
    turnId: `agt-1-t${index}`,
    prompt: `Prompt ${index}`,
    status,
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: status.kind === "running" ? null : NOW - 30_000,
    events: [...work, { kind: "assistantText", text }],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  }));
  const record: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(record),
    unread: agentThreadUnread(record),
    thread: record,
    lifecycle: status.kind === "running" ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

describe("AgentThreadSession markdown viewport gating", () => {
  let host: HTMLDivElement;
  let root: Root;
  let base: AgentMarkdownRenderer;

  beforeAll(async () => {
    base = await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    sharedAgentMarkdownDocumentCache().clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={600_000}>
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

  function bodies(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(".agent-text")];
  }

  function states(): ReadonlyArray<string | null> {
    return bodies().map((element) => element.getAttribute("data-agent-markdown"));
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

  it("parses nothing off screen and shows the deferred body without a note", () => {
    const counting = countingRenderer(base);
    const viewport = testViewport();

    render({
      thread: thread(SETTLED, message("alpha"), message("beta"), message("gamma")),
      markdownRenderer: counting.renderer,
      markdownViewport: viewport.port,
    });

    expect(counting.documents()).toBe(0);
    expect(states()).toEqual(["deferred", "deferred", "deferred"]);
    expect(host.querySelectorAll(".agent-md__note")).toHaveLength(0);
    expect(host.querySelectorAll("h2")).toHaveLength(0);
    expect(bodies()[0]?.querySelector("p.agent-text__paragraph")?.textContent).toBe("## alpha");
    expect(viewport.observed()).toEqual(bodies());
  });

  it("parses an on-screen message in the first commit without waiting for the observer", () => {
    const counting = countingRenderer(base);
    const viewport = testViewport(() => true);

    render({
      thread: thread(SETTLED, message("alpha"), message("beta")),
      markdownRenderer: counting.renderer,
      markdownViewport: viewport.port,
    });

    expect(states()).toEqual(["rendered", "rendered"]);
    expect(counting.documents()).toBe(2);
    expect(viewport.observed()).toEqual([]);
    expect(viewport.measurements()).toBe(2);
    expect(host.textContent).not.toContain("## alpha");
  });

  it("measures each message once and never measures a parsed message again", () => {
    const viewport = testViewport();
    const view = thread(SETTLED, message("alpha"), message("beta"));
    render({ thread: view, markdownViewport: viewport.port });
    expect(viewport.measurements()).toBe(2);

    const first = bodies()[0];
    expect(first).toBeDefined();
    viewport.enter(first as Element);
    render({ thread: view, markdownViewport: viewport.port, findQuery: "" });

    expect(states()).toEqual(["rendered", "deferred"]);
    expect(viewport.measurements()).toBe(2);
  });

  it("decides the initial gate in a layout effect so nothing paints unparsed first", () => {
    const source = readFileSync(join(import.meta.dirname, "useAgentMarkdown.ts"), "utf8");
    const start = source.indexOf("export function useAgentMarkdownGate");
    const end = source.indexOf("export function useAgentMarkdown(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const gate = source.slice(start, end);
    expect(gate).toContain("useLayoutEffect(() => {");
    expect(gate).toContain("viewport.contains(element)");
    expect(gate.slice(gate.indexOf("viewport.contains(element)"))).not.toContain("useEffect(");
  });

  it("parses only the message that reaches the viewport", () => {
    const counting = countingRenderer(base);
    const viewport = testViewport();
    render({
      thread: thread(SETTLED, message("alpha"), message("beta"), message("gamma")),
      markdownRenderer: counting.renderer,
      markdownViewport: viewport.port,
    });

    const second = bodies()[1];
    expect(second).toBeDefined();
    viewport.enter(second as Element);

    expect(counting.documents()).toBe(1);
    expect(states()).toEqual(["deferred", "rendered", "deferred"]);
    expect(host.querySelectorAll("h2")).toHaveLength(1);
    expect(host.querySelector("h2")?.textContent).toBe("beta");
    expect(viewport.observed()).toEqual([bodies()[0], bodies()[2]]);
  });

  it("parses a streaming message without waiting for the viewport", () => {
    const counting = countingRenderer(base);
    const viewport = testViewport();

    render({
      thread: thread(RUNNING, message("live")),
      markdownRenderer: counting.renderer,
      markdownViewport: viewport.port,
    });

    expect(states()).toEqual(["rendered"]);
    expect(host.querySelector("h2")?.textContent).toBe("live");
    expect(viewport.observed()).toEqual([]);
  });

  it("keeps a message rendered once it settles after streaming", () => {
    const counting = countingRenderer(base);
    const viewport = testViewport();
    const props = {
      markdownRenderer: counting.renderer,
      markdownViewport: viewport.port,
    };

    render({ thread: thread(RUNNING, message("live")), ...props });
    render({ thread: thread(SETTLED, message("live")), ...props });

    expect(states()).toEqual(["rendered"]);
    expect(viewport.observed()).toEqual([]);
  });

  it("keeps the final answer rendered when a turn with tool work settles", () => {
    const viewport = testViewport();
    const props = { markdownViewport: viewport.port };

    render({ thread: threadWithWork(RUNNING, TOOL_WORK, [message("live")]), ...props });
    expect(states()).toEqual(["rendered"]);

    render({ thread: threadWithWork(SETTLED, TOOL_WORK, [message("live")]), ...props });

    expect(states()).toEqual(["rendered"]);
    expect(host.querySelector("h2")?.textContent).toBe("live");
    expect(host.textContent).not.toContain("## live");
    expect(viewport.observed()).toEqual([]);
  });

  it("parses eagerly when no visibility port is available", () => {
    const counting = countingRenderer(base);

    render({
      thread: thread(SETTLED, message("alpha"), message("beta")),
      markdownRenderer: counting.renderer,
      markdownViewport: null,
    });

    expect(counting.documents()).toBe(2);
    expect(states()).toEqual(["rendered", "rendered"]);
  });

  it("highlights a match inside a message that has not parsed yet", () => {
    const viewport = testViewport();
    const view = thread(SETTLED, message("alpha"), message("beta"));
    const hits = hitsFor(view, "beta");

    render({
      thread: view,
      markdownViewport: viewport.port,
      findQuery: "beta",
      findHits: hits,
    });

    expect(states()).toEqual(["deferred", "deferred"]);
    expect(bodies()[1]?.querySelectorAll("mark.agent-find__hit").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".agent-md__note")).toHaveLength(0);
  });

  it("parses and scrolls to a match that lives in a message that has not parsed yet", () => {
    const scrolled: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    const viewport = testViewport();
    const view = thread(SETTLED, message("alpha"), message("beta"));
    const hits = hitsFor(view, "beta");
    expect(hits.length).toBeGreaterThan(0);

    render({
      thread: view,
      markdownViewport: viewport.port,
      findQuery: "beta",
      findHits: hits,
      findHitIndex: 0,
    });

    expect(states()).toEqual(["deferred", "rendered"]);
    const current = host.querySelectorAll<HTMLElement>("mark.agent-find__hit--current");
    expect(current).toHaveLength(1);
    expect(current[0]?.closest(".agent-text")).toBe(bodies()[1]);
    expect(scrolled).toEqual([current[0]]);
  });

  it("keeps the transcript pinned to the newest message when a deferred message parses", () => {
    const viewport = testViewport();
    render({
      thread: thread(SETTLED, message("alpha"), message("beta")),
      markdownViewport: viewport.port,
    });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 });

    const first = bodies()[0];
    expect(first).toBeDefined();
    viewport.enter(first as Element);

    expect(scroll.scrollTop).toBe(900);
  });

  it("leaves the scroll position alone when the reader has scrolled away from the newest message", () => {
    const viewport = testViewport();
    render({
      thread: thread(SETTLED, message("alpha"), message("beta")),
      markdownViewport: viewport.port,
    });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
    act(() => scroll.dispatchEvent(new Event("scroll")));

    const first = bodies()[0];
    expect(first).toBeDefined();
    viewport.enter(first as Element);

    expect(scroll.scrollTop).toBe(100);
  });

  it("keeps a forced match rendered after the current hit moves to another message", () => {
    const viewport = testViewport();
    const view = thread(SETTLED, message("alpha"), message("beta"));
    const hits = hitsFor(view, "paragraph");
    expect(hits.length).toBeGreaterThan(1);
    const props = {
      thread: view,
      markdownViewport: viewport.port,
      findQuery: "paragraph",
      findHits: hits,
    };

    render({ ...props, findHitIndex: 0 });
    const first = states()[0];
    render({ ...props, findHitIndex: hits.length - 1 });

    expect(first).toBe("rendered");
    expect(states()[0]).toBe("rendered");
  });

  it("stops observing messages when the thread changes and never disposes an injected port", () => {
    const viewport = testViewport();
    render({ thread: thread(SETTLED, message("alpha")), markdownViewport: viewport.port });
    expect(viewport.observed()).toHaveLength(1);

    render({
      thread: thread(SETTLED, message("beta"), message("gamma")),
      markdownViewport: viewport.port,
    });
    expect(viewport.observed()).toEqual(bodies());
    expect(viewport.observed()).toHaveLength(2);

    act(() => root.unmount());
    root = createRoot(host);
    expect(viewport.observed()).toHaveLength(0);
    expect(viewport.disposals()).toBe(0);
  });
});

function hitsFor(view: AgentThreadView, query: string): ReadonlyArray<AgentThreadFindHit> {
  return findInThread(view.thread, query, { maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN });
}
