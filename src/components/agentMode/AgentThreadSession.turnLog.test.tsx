// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  createAgentTurnLogFactsStore,
  type AgentTurnLogFactsStore,
} from "../../application/agentTurnLogStatusStore";
import type { AgentTurnLogSlotStatus } from "../../application/agentTurnLogPorts";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";
import {
  AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE,
  AGENT_TURN_WINDOW_NOTICE,
} from "./agentTurnLogNotice";

const TURN_ID = "turn";
const THREAD_ID = "agt-1-0a1b";

function slot(overrides: Partial<AgentTurnLogSlotStatus> = {}): AgentTurnLogSlotStatus {
  return {
    turnId: TURN_ID,
    threadId: THREAD_ID,
    state: { kind: "writing" },
    loss: { kind: "none" },
    pendingOps: 0,
    pendingBytes: 0,
    backpressure: false,
    persistedThroughSeq: 0,
    bounded: false,
    contextWindow: null,
    promptStored: false,
    ...overrides,
  };
}

const answer: AgentTurnEvent = { kind: "assistantText", text: "Done with the parser." };

describe("thread session turn log notices", () => {
  let host: HTMLDivElement;
  let root: Root;
  const renders: string[] = [];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    renders.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(eventsTruncated: boolean, turnLog: AgentTurnLogFactsStore | null, live = false) {
    const turn: AgentTurn = {
      turnId: TURN_ID,
      prompt: "fix the parser",
      status: live ? { kind: "running" } : { kind: "exited", exitCode: 0 },
      events: live ? [{ kind: "result", text: "watching", isError: false, usage: null }] : [answer],
      startedAtEpochMs: 0,
      endedAtEpochMs: live ? null : 1,
      eventsTruncated,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Parser",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [turn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "settled",
      unread: false,
      lifecycle: "settled",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
          turnLog={turnLog}
          turnRenderProbe={(turnId) => renders.push(turnId)}
        />,
      ),
    );
  }

  it("shows the JSON truth when no log fact exists for the turn", () => {
    render(true, null);
    expect(host.textContent).toContain(AGENT_TURN_WINDOW_NOTICE);
  });

  it("hides every loss notice once the window was rebuilt from the whole log", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot({ state: { kind: "stopped", reason: "sealed" } }));
    store.publishHydration(TURN_ID, "complete");
    render(true, store);
    expect(host.textContent).not.toContain(AGENT_TURN_WINDOW_NOTICE);
    expect(host.textContent).not.toContain(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
  });

  it("says the earlier activity is saved but not shown while the window holds less", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot({ state: { kind: "stopped", reason: "sealed" } }));
    render(true, store);
    expect(host.textContent).toContain(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
    expect(host.textContent).not.toContain(AGENT_TURN_WINDOW_NOTICE);
  });

  it("tells the JSON truth when an unsealed log of a turn that is not live cannot vouch", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [
      {
        turnId: TURN_ID,
        eventCount: 3,
        bytes: 30,
        loss: { kind: "none" },
        sealed: false,
        digest: null,
        prompt: null,
        promptOmitted: false,
      },
    ]);
    render(true, store);
    expect(host.textContent).toContain(AGENT_TURN_WINDOW_NOTICE);
  });

  it("words a real loss", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot({ loss: { kind: "turnCeiling" } }));
    render(true, store);
    expect(host.textContent).toContain(
      "This turn reached its recording limit, so later activity was not saved.",
    );
  });

  it("shows the quiet unsaved line once while the writer stays stopped", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot({ state: { kind: "stopped", reason: "failed" } }));
    render(false, store);
    const lines = [...host.querySelectorAll(".agent-note--warning")].filter((node) =>
      node.textContent?.startsWith("Activity is not being saved to disk"),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe(
      "Activity is not being saved to disk: the log could not be written.",
    );
  });

  it("stops forcing a window truncated live turn into background work", () => {
    render(true, null, true);
    expect(host.textContent).toContain("Working in background");
  });

  it("keeps a window truncated live turn out of background work while its writer is live", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot());
    render(true, store, true);
    expect(host.textContent).not.toContain("Working in background");
  });

  it("never re-renders the turn body for a status tick that changes nothing visible", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, slot());
    render(false, store);
    const before = renders.length;
    expect(before).toBeGreaterThan(0);

    act(() => {
      for (let index = 1; index <= 20; index += 1) {
        store.publishSlot(THREAD_ID, slot({ pendingOps: index, persistedThroughSeq: index }));
      }
    });
    expect(renders.length).toBe(before);

    act(() => store.publishSlot(THREAD_ID, slot({ loss: { kind: "supervisorGap" } })));
    expect(renders.length).toBe(before);
    expect(host.textContent).toContain(
      "Some activity from this turn was too large to record and is not shown.",
    );
  });
});
