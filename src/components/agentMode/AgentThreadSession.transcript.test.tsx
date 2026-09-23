// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { AGENT_CODE_COLORIZE_DELAY_MS, type AgentCodeColorizer } from "./agentCodeColorizer";
import type { AgentLocalFileLinkPort } from "./agentMarkdownLinks";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;

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
    const open = vi.fn();
    const reject = vi.fn();
    const port: AgentLocalFileLinkPort = { open, reject };
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
    expect(open).toHaveBeenCalledWith({ path: `${ROOT}/src/app.ts`, line: 12, column: null });
    act(() => links[1]?.click());
    expect(open).toHaveBeenLastCalledWith({
      path: `${ROOT}/package.json`,
      line: null,
      column: null,
    });
    expect(reject).not.toHaveBeenCalled();
  });

  it("does not link paths for remote threads", () => {
    render({
      localFileLinks: { open: vi.fn(), reject: vi.fn() },
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
