// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThread } from "../../domain/agentThread";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { AgentClockProvider } from "./agentClock";
import { AgentThreadRow } from "./AgentThreadRow";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;

describe("AgentThreadRow", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
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

  const render = (view: AgentThreadView): void => {
    act(() => {
      root.render(
        <AgentClockProvider>
          <ul>
            <AgentThreadRow
              focused={false}
              jumpLabel={null}
              on={false}
              onMenuCommand={() => undefined}
              onSelect={() => undefined}
              onTogglePin={() => undefined}
              projectLabel="app"
              view={view}
            />
          </ul>
        </AgentClockProvider>,
      );
    });
  };

  const line1 = (): HTMLElement => {
    const element = host.querySelector<HTMLElement>(".agent-row__line1");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };

  it("puts the pin glyph before the Done status on a pinned unread thread", () => {
    render(pinnedDone());

    const pin = line1().querySelector(".agent-row__pin");
    const status = line1().querySelector(".agent-row__status--done");
    expect(pin).not.toBeNull();
    expect(status).not.toBeNull();
    if (pin === null || status === null) return;
    expect(status.textContent).toBe("Done");
    expect(pin.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows the relative time instead of Done once the thread has been viewed", () => {
    render(viewedDone());

    expect(host.querySelector(".agent-row__status")).toBeNull();
    expect(line1().querySelector(".agent-row__time")?.textContent).toBe("2m");
  });

  it("keeps the branch left and the provider glyph right on line three", () => {
    render(pinnedDone());

    const line3 = host.querySelector<HTMLElement>(".agent-row__line3");
    expect(line3?.firstElementChild?.classList.contains("agent-row__branch")).toBe(true);
    expect(line3?.querySelector('[aria-label="Claude Code"]')).not.toBeNull();
  });
});

function pinnedDone(): AgentThreadView {
  return threadView({ pinned: true, viewedAtEpochMs: null });
}

function viewedDone(): AgentThreadView {
  return threadView({ pinned: false, viewedAtEpochMs: NOW });
}

function threadView({
  pinned,
  viewedAtEpochMs,
}: {
  readonly pinned: boolean;
  readonly viewedAtEpochMs: number | null;
}): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: `agent-root:${ROOT}`, repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/agt-1` },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Extract the invoice totals",
    pinned,
    archived: false,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs: NOW - 2 * 60_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "Extract the invoice totals",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs: NOW - 2 * 60_000,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    integration: null,
  };

  return {
    thread,
    lifecycle: "settled",
    projectOrigin: "active-tab",
    repositoryLabel: "app",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
  };
}
