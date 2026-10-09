// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sharedAgentMarkdownDocumentCache } from "../../application/agentMarkdownDocumentCache";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { DeferredFollowUp } from "../../application/agentDeferredFollowUps";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import { findInThread } from "../../domain/agentThreadSearch";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { AGENT_CODE_COLORIZE_DELAY_MS, type AgentCodeColorizer } from "./agentCodeColorizer";
import type { AgentLocalFileLinkPort } from "./agentMarkdownLinks";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RECOVERED_ANSWER = [
  "**Done** with `parser.ts`.",
  "",
  "- first step",
  "- all done",
  "",
  "| File | Lines |",
  "|---|---|",
  "| a.ts | 12 |",
].join("\n");
const OFF_SCREEN: AgentMarkdownViewport = {
  contains: () => false,
  observe: () => () => undefined,
  watch: () => () => undefined,
  remeasure: () => undefined,
  dispose: () => undefined,
};

describe("AgentThreadSession transcript", () => {
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

  describe("following the latest output", () => {
    it("keeps a reader's position when a turn they did not just send starts, and offers a jump", () => {
      const first = turn("t1", "First", { kind: "exited", exitCode: 0 }, []);
      render({ thread: view([first]) });
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
      act(() => scroll.dispatchEvent(new Event("scroll")));
      expect(jumpButton()?.textContent).toBe("Jump to latest");

      const old = {
        ...turn("t2", "Queued earlier", { kind: "running" }, []),
        startedAtEpochMs: NOW - 60_000,
      };
      render({ thread: view([first, old]) });

      expect(scroll.scrollTop).toBe(100);
      expect(jumpButton()?.textContent).toBe("New activity");
      expect(jumpButton()?.getAttribute("data-unseen")).toBe("true");

      act(() => jumpButton()?.click());
      expect(scroll.scrollTop).toBe(900);
      expect(jumpButton()).toBeNull();
    });

    it("follows a turn the user has just sent even while reading above", () => {
      const first = turn("t1", "First", { kind: "exited", exitCode: 0 }, []);
      render({ thread: view([first]) });
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
      act(() => scroll.dispatchEvent(new Event("scroll")));

      const sent = {
        ...turn("t2", "Now this", { kind: "pending" }, []),
        startedAtEpochMs: NOW - 500,
      };
      render({ thread: view([first, sent]) });

      expect(scroll.scrollTop).toBe(900);
      expect(jumpButton()).toBeNull();
    });

    it("does not treat a dispatched queued message as the user's fresh send", () => {
      const first = turn("t1", "First", { kind: "running" }, []);
      render({ thread: view([first]), deferredFollowUps: [queued("Later task")] });
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
      act(() => scroll.dispatchEvent(new Event("scroll")));

      const dispatched = {
        ...turn("t2", "Later task", { kind: "pending" }, []),
        startedAtEpochMs: NOW,
      };
      render({
        thread: view([{ ...first, status: { kind: "exited", exitCode: 0 } }, dispatched]),
        deferredFollowUps: [],
      });

      expect(scroll.scrollTop).toBe(100);
      expect(jumpButton()?.textContent).toBe("New activity");
    });
  });

  it("stays pinned to the latest output when the viewport or content resizes", () => {
    const callbacks: Array<() => void> = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {
          disconnect();
        }
      },
    );
    try {
      render({ thread: view([turn("t1", "First", { kind: "running" }, [])]) });
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
      act(() => scroll.dispatchEvent(new Event("scroll")));
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_200 });
      act(() => callbacks.forEach((callback) => callback()));
      expect(scroll.scrollTop).toBe(1_200);

      scroll.scrollTop = 100;
      act(() => scroll.dispatchEvent(new Event("scroll")));
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_500 });
      act(() => callbacks.forEach((callback) => callback()));
      expect(scroll.scrollTop).toBe(100);

      act(() => root.unmount());
      expect(disconnect).toHaveBeenCalled();
      root = createRoot(host);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes a stopped turn with a neutral compact end marker", () => {
    render({ thread: view([turn("t1", "Go", { kind: "stopped" }, [])]) });
    const marker = host.querySelector(".agent-turn-end");
    expect(marker?.getAttribute("data-kind")).toBe("stopped");
    expect(marker?.textContent).toBe("Stopped");
    expect(host.querySelector(".agent-finale--bad")).toBeNull();
  });

  it("marks a non-zero exit without a failure block", () => {
    render({ thread: view([turn("t1", "Go", { kind: "exited", exitCode: 3 }, [])]) });
    expect(host.querySelector(".agent-turn-end")?.textContent).toContain("Exited with code 3");
  });

  it("opens workspace-relative paths mentioned in prose and inline code", () => {
    const open = vi.fn<AgentLocalFileLinkPort["open"]>(async () => "opened");
    const report = vi.fn<AgentLocalFileLinkPort["report"]>();
    const port: AgentLocalFileLinkPort = { open, report };
    render({
      localFileLinks: port,
      thread: view([
        turn("t1", "Where?", { kind: "exited", exitCode: 0 }, [
          { kind: "assistantText", text: "Look at src/app.ts:12 and `package.json`, not ../x.ts." },
        ]),
      ]),
    });
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__path-link")];
    expect(links.map((link) => link.textContent)).toEqual(["src/app.ts:12", "package.json"]);

    act(() => links[0]?.click());
    expect(open).toHaveBeenCalledWith({
      location: { path: `${ROOT}/src/app.ts`, line: 12, column: null },
      root: ROOT,
    });
    act(() => links[1]?.click());
    expect(open).toHaveBeenLastCalledWith({
      location: { path: `${ROOT}/package.json`, line: null, column: null },
      root: ROOT,
    });
    expect(report).not.toHaveBeenCalled();
  });

  it("does not link paths for remote threads", () => {
    render({
      localFileLinks: { open: vi.fn(), report: vi.fn() },
      thread: view(
        [
          turn("t1", "Where?", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "Look at src/app.ts:12." },
          ]),
        ],
        true,
      ),
    });
    expect(host.querySelector("a.agent-md__path-link")).toBeNull();
  });

  it("colorizes a fenced block through the colorizer port and keeps plain text while searching", async () => {
    vi.useRealTimers();
    const colorize = vi.fn<AgentCodeColorizer["colorize"]>(async (code) => [
      [{ text: code, color: "#ff0000", italic: false, bold: false }],
    ]);
    const thread = view([
      turn("t1", "Code?", { kind: "exited", exitCode: 0 }, [
        { kind: "assistantText", text: "```ts\nconst a = 1;\n```" },
      ]),
    ]);
    render({ codeColorizer: { colorize }, thread });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AGENT_CODE_COLORIZE_DELAY_MS + 20));
    });

    expect(colorize).toHaveBeenCalledWith("const a = 1;", "ts");
    const token = host.querySelector<HTMLElement>(".agent-md__code-colorized span span");
    expect(token?.textContent).toBe("const a = 1;");
    expect(token?.style.color).toBe("rgb(255, 0, 0)");

    render({
      codeColorizer: { colorize },
      thread,
      findQuery: "const",
      findHits: [{ scope: "turn", turnId: "t1", eventIndex: 0, start: 8, end: 13 }],
      findHitIndex: 0,
    });
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.querySelector(".agent-md__code-body mark")?.textContent).toBe("const");
  });

  describe("a final answer that survives only in the result", () => {
    const recovered: ReadonlyArray<AgentTurnEvent> = [
      { kind: "toolCall", toolId: "t-1", name: "Read", inputSummary: "src/parser.ts" },
      { kind: "toolResult", toolId: "t-1", outputSummary: "42 lines", isError: false },
      { kind: "result", text: RECOVERED_ANSWER, isError: false, usage: null },
    ];

    it("renders it as formatted markdown that reads like a normal answer", () => {
      render({
        textClipboard: { canWriteText: () => true, writeText: async () => undefined },
        thread: view([turn("t1", "Fix it", SETTLED, recovered)]),
      });

      const answers = [...host.querySelectorAll<HTMLElement>(".agent-text")];
      expect(answers).toHaveLength(1);
      const answer = answers[0];
      expect(answer?.getAttribute("data-agent-markdown")).toBe("rendered");
      expect(answer?.querySelector("strong")?.textContent).toBe("Done");
      expect(answer?.querySelector("code")?.textContent).toBe("parser.ts");
      expect([...(answer?.querySelectorAll("li") ?? [])].map((item) => item.textContent)).toEqual([
        "first step",
        "all done",
      ]);
      expect(answer?.querySelector("table td")?.textContent).toBe("a.ts");
      expect(answer?.textContent).not.toContain("**");
      expect(answer?.textContent).not.toContain("|---|");
      expect(host.querySelector(".agent-finale")).toBeNull();
      expect(host.querySelector(".agent-microlabel")).toBeNull();
      expect(host.querySelectorAll('[data-agent-event="e2"]')).toHaveLength(1);
      expect(answer?.getAttribute("data-agent-event")).toBe("e2");
      expect(host.querySelectorAll('button[aria-label="Copy AI response"]')).toHaveLength(1);
    });

    it("lands the current find hit on the occurrence the thread search counted", () => {
      const thread = view([turn("t1", "Fix it", SETTLED, recovered)]);
      const findHits = findInThread(thread.thread, "done");
      expect(findHits.map((hit) => (hit.scope === "turn" ? hit.eventIndex : null))).toEqual([2, 2]);

      render({ thread, findQuery: "done", findHits, findHitIndex: 1 });

      const answer = host.querySelector<HTMLElement>(".agent-text");
      expect(answer?.getAttribute("data-agent-markdown")).toBe("rendered");
      const marks = [...(answer?.querySelectorAll("mark") ?? [])];
      expect(marks.map((mark) => mark.textContent)).toEqual(["Done", "done"]);
      expect(marks[0]?.closest("strong")).not.toBeNull();
      const current = [...host.querySelectorAll(".agent-find__hit--current")];
      expect(current).toHaveLength(1);
      expect(current[0]).toBe(marks[1]);
      expect(current[0]?.closest("li")?.textContent).toBe("all done");
    });

    it("parses a result of a running turn at once as a settled document", () => {
      sharedAgentMarkdownDocumentCache().clear();
      render({
        markdownViewport: OFF_SCREEN,
        thread: view([turn("t1", "Fix it", { kind: "running" }, recovered)]),
      });

      const answer = host.querySelector<HTMLElement>(".agent-text");
      expect(answer?.getAttribute("data-agent-markdown")).toBe("rendered");
      expect(answer?.querySelector("table")).not.toBeNull();
      expect(sharedAgentMarkdownDocumentCache().sourceBytes()).toBeGreaterThan(0);
    });

    it("defers an off-screen result of a reopened thread like any other answer", () => {
      render({
        markdownViewport: OFF_SCREEN,
        thread: view([turn("t1", "Fix it", SETTLED, recovered)]),
      });

      const answer = host.querySelector<HTMLElement>(".agent-text");
      expect(answer?.getAttribute("data-agent-markdown")).toBe("deferred");
      expect(answer?.querySelector("table")).toBeNull();
    });

    it("renders a result that repeats the visible answer only once", () => {
      render({
        thread: view([
          turn("t1", "Fix it", SETTLED, [
            { kind: "assistantText", text: RECOVERED_ANSWER },
            { kind: "result", text: `${RECOVERED_ANSWER}\n`, isError: false, usage: null },
          ]),
        ]),
      });

      expect(host.querySelectorAll(".agent-text")).toHaveLength(1);
      expect(host.querySelectorAll("table")).toHaveLength(1);
      expect(host.querySelector(".agent-finale")).toBeNull();
    });

    it("keeps a failed result as plain text in the failed presentation", () => {
      const failure = "**Build failed** in `parser.ts`";
      render({
        thread: view([
          turn("t1", "Fix it", { kind: "exited", exitCode: 1 }, [
            { kind: "result", text: failure, isError: true, usage: null },
          ]),
        ]),
      });

      const block = host.querySelector<HTMLElement>("[data-agent-event].agent-finale--bad");
      expect(block?.querySelector(".agent-microlabel--bad")?.textContent).toBe("run failed");
      expect(block?.querySelector(".agent-finale__body")?.textContent).toBe(failure);
      expect(block?.querySelector("strong")).toBeNull();
      expect(block?.querySelector("code")).toBeNull();
      expect(host.querySelector(".agent-text")).toBeNull();
    });
  });

  function jumpButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(".agent-jump-latest__button");
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
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession
            codeColorizer={null}
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

function queued(prompt: string): DeferredFollowUp {
  return {
    id: `queued-${prompt}`,
    queuedAtEpochMs: NOW,
    request: { threadId: "agt-1", prompt, attachments: [] },
    state: "queued",
  } as unknown as DeferredFollowUp;
}

function turn(
  turnId: string,
  prompt: string,
  status: AgentTurnStatus,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: NOW - 5 * 60_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function view(turns: ReadonlyArray<AgentTurn>, remote = false): AgentThreadView {
  const last = turns[turns.length - 1];
  const running = last?.status.kind === "pending" || last?.status.kind === "running";
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Transcript",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000 + turns.length,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ...(remote
      ? {
          execution: {
            kind: "remote" as const,
            serverId: "linux",
            runnerId: "runner",
            projectId: "project",
            conversationId: "conversation",
            latestTaskId: "task",
            resume: null,
            reachability: REMOTE_RUNNER_REACHABLE,
          },
        }
      : {}),
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
