// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread } from "../../domain/agentThread";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { findInThread } from "../../domain/agentThreadSearch";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";

describe("imported find reveal before the markdown renderer is ready", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrolled: Element[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    scrolled = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("scrolls to the imported message itself when no highlight has been painted yet", () => {
    const thread = imported([
      { role: "user", text: "Kde je parser" },
      { role: "assistant", text: "The parser lives in src." },
    ]);
    const hits = findInThread(thread.thread, "parser");
    expect(hits[1]).toEqual({ scope: "imported", exchangeIndex: 1, start: 4, end: 10 });

    render({ thread, findQuery: "parser", findHits: hits, findHitIndex: 1 });

    const body = host.querySelector<HTMLElement>('[data-agent-event="x1"]');
    expect(body?.getAttribute("data-agent-markdown")).toBe("pending");
    expect(body?.querySelector("mark.agent-find__hit--current")).toBeNull();
    expect(host.querySelector("mark.agent-find__hit--current")).toBeNull();
    expect(scrolled).toEqual([body]);
  });

  it("scrolls nowhere for an imported hit whose message is no longer rendered", () => {
    const thread = imported([{ role: "user", text: "Kde je parser" }]);

    render({
      thread,
      findQuery: "parser",
      findHits: [{ scope: "imported", exchangeIndex: 9, start: 0, end: 6 }],
      findHitIndex: 0,
    });

    expect(scrolled).toEqual([]);
  });

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

function imported(exchanges: ReadonlyArray<ExternalSessionExchange>): AgentThreadView {
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
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: {
      provider: "claudeCode",
      sessionId: SESSION_ID,
      importedAtEpochMs: NOW - 60_000,
      history: {
        provider: "claudeCode",
        sessionId: SESSION_ID,
        exchanges,
        exchangesTruncated: false,
        totalPreviewBytes: 32,
      },
    },
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
