// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadRequestFeed } from "../../application/agentThreadRequestPorts";
import type {
  AgentThreadView,
  RemoteAgentThreadExecution,
} from "../../application/agentThreadPorts";
import { agentRootOwnerId } from "../../domain/agentProject";
import { MAX_AGENT_THREAD_REQUESTS_RETAINED } from "../../domain/agentRuntimeRequest";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { createRemoteAgentThreadRequestFeed } from "../../application/remoteAgentThreadRequestFeed";
import {
  createUnifiedAgentThreadRequestFeed,
  remoteAgentThreadRequestControl,
} from "../../application/unifiedAgentThreadRequestFeed";
import { remoteAgentThreadRequestGatewayFake } from "../../test/remoteAgentThreadRequestGatewayFake";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
} from "../../test/agentThreadRequestFeedFake";
import { waitForReact } from "../../test/reactTestLifecycle";
import { createAgentAppComposition } from "../../agentAppComposition";
import { AgentThreadRequestsScope } from "./AgentThreadRequestsScope";
import { AgentThreadSession } from "./AgentThreadSession";
import {
  AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE,
  AGENT_REQUEST_HISTORY_UNSAVED_NOTE,
} from "./AgentThreadTranscriptRequests";
import { AgentThreadRequestFeedContext } from "./agentThreadRequestFeedContext";

const THREAD = "agt-thread-0001";
const ROOT = "/app";
const WORKSPACE = "workspace-live";
const FIRST_TURN = "agt-turn-0001";
const SECOND_TURN = "agt-turn-0002";
const ASK_TOOL = "toolu_question";
const BASH_TOOL = "toolu_bash";
const INPUT = JSON.stringify({
  questions: [{ question: "Which layout is broken?", header: "Layout", options: [] }],
});
const PROVIDER_ANSWER =
  'Your questions have been answered: "Which layout is broken?"="Sidebar". You can now continue with these answers in mind.';
const QUESTION_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Let me ask first." },
  { kind: "toolCall", toolId: ASK_TOOL, name: "AskUserQuestion", inputSummary: INPUT },
  { kind: "toolResult", toolId: ASK_TOOL, outputSummary: PROVIDER_ANSWER, isError: false },
  { kind: "assistantText", text: "Fixing the sidebar now." },
];
const COMMAND_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Running the tests." },
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "userMessage", text: "Thanks." },
];
const SCOPE = { threadId: THREAD, workspaceId: WORKSPACE };
const REMOTE: RemoteAgentThreadExecution = {
  kind: "remote",
  serverId: "server-1",
  runnerId: "runner-1",
  projectId: "project-1",
  conversationId: "conversation-1",
  latestTaskId: SECOND_TURN,
  resume: null,
  reachability: { kind: "reachable" },
};

function turnOf(turnId: string, events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId,
    prompt: "Run the loop",
    status: { kind: "exited", exitCode: 0 },
    events,
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 33_000,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function threadView(
  turns: ReadonlyArray<AgentTurn>,
  execution?: RemoteAgentThreadExecution,
): AgentThreadView {
  return {
    ...(execution === undefined ? {} : { execution }),
    thread: {
      threadId: THREAD,
      owner: { rootKey: ROOT, repositoryRoot: ROOT, ownerId: WORKSPACE },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "session" },
      title: "Loop",
      pinned: false,
      archived: false,
      createdAtEpochMs: 0,
      updatedAtEpochMs: 0,
      turns,
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
}

describe("runtime request records in the open thread's transcript", () => {
  let host: HTMLDivElement;
  let root: Root;
  let turnRenders: string[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    turnRenders = [];
  });

  afterEach(async () => {
    act(() => root.unmount());
    await act(async () => Promise.resolve());
    host.remove();
  });

  function session(view: AgentThreadView) {
    return (
      <AgentThreadRequestsScope thread={view}>
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
          turnRenderProbe={(turnId) => turnRenders.push(turnId)}
        />
      </AgentThreadRequestsScope>
    );
  }

  function render(view: AgentThreadView, feed?: AgentThreadRequestFeed) {
    act(() =>
      root.render(
        feed === undefined ? (
          session(view)
        ) : (
          <AgentThreadRequestFeedContext.Provider value={feed}>
            {session(view)}
          </AgentThreadRequestFeedContext.Provider>
        ),
      ),
    );
  }

  function markup(): string {
    return host.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_");
  }

  function requestIds(): ReadonlyArray<string | undefined> {
    return [...host.querySelectorAll<HTMLElement>(".agent-request-row")].map(
      (row) => row.dataset.agentRequest,
    );
  }

  function historyNotes(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>("[data-agent-request-history-note]")];
  }

  function turnElement(turnId: string): Element | null {
    return host.querySelector(`[data-agent-turn="${turnId}"]`);
  }

  it("shows history rows from the records of a local thread", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(
      agentThreadRequestsOf(SCOPE, [
        agentRuntimeRequestOf("resolvedQuestion", {
          turnId: FIRST_TURN,
          anchorToolId: ASK_TOOL,
        }),
      ]),
    );

    render(threadView([turnOf(FIRST_TURN, QUESTION_EVENTS)]), feed);
    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);
    expect(requestIds()).toEqual([]);

    await waitForReact(() => expect(requestIds()).toEqual(["req-0005"]));
    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(turnElement(FIRST_TURN)?.textContent).toContain("Which packages should be updated?");
    expect(feed.currentThreadRequests.mock.calls[0]?.[0]).toEqual({
      rootKey: ROOT,
      ownerId: agentRootOwnerId(ROOT),
      threadId: THREAD,
      workspaceId: WORKSPACE,
    });
    expect(feed.currentThreadRequests.mock.calls[0]?.[1]).toEqual([FIRST_TURN]);
  });

  it("renders exactly as today when the feed rejects", async () => {
    const turns = [turnOf(FIRST_TURN, QUESTION_EVENTS), turnOf(SECOND_TURN, COMMAND_EVENTS)];
    render(threadView(turns));
    const today = markup();
    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);

    const failing = agentThreadRequestFeedFake();
    failing.currentThreadRequests.mockRejectedValue(new Error("unknown command"));
    render(threadView(turns), failing);
    expect(markup()).toBe(today);
    await waitForReact(() => expect(failing.currentThreadRequests).toHaveBeenCalled());
    expect(markup()).toBe(today);

    const closed = agentThreadRequestFeedFake();
    closed.subscribeThreadRequests.mockRejectedValue(new Error("no runtime"));
    render(threadView(turns), closed);
    await waitForReact(() => expect(closed.subscribeThreadRequests).toHaveBeenCalled());
    expect(closed.currentThreadRequests).not.toHaveBeenCalled();
    expect(markup()).toBe(today);
  });

  it("shows a record that arrives by push without remounting or re-rendering other turns", async () => {
    const feed = agentThreadRequestFeedFake();
    const turns = [turnOf(FIRST_TURN, QUESTION_EVENTS), turnOf(SECOND_TURN, COMMAND_EVENTS)];
    feed.record(
      agentThreadRequestsOf(SCOPE, [
        agentRuntimeRequestOf("resolvedQuestion", { turnId: FIRST_TURN, anchorToolId: ASK_TOOL }),
      ]),
    );
    render(threadView(turns), feed);
    await waitForReact(() => expect(requestIds()).toEqual(["req-0005"]));
    const first = turnElement(FIRST_TURN);
    const second = turnElement(SECOND_TURN);
    const firstRow = host.querySelector(".agent-request-row");
    const rendersBefore = turnRenders.length;

    act(() =>
      feed.publish(
        agentThreadRequestsOf(SCOPE, [
          agentRuntimeRequestOf("resolvedApproval", {
            id: "req-pushed",
            turnId: SECOND_TURN,
            anchorToolId: BASH_TOOL,
          }),
        ]),
      ),
    );

    await waitForReact(() => expect(requestIds()).toEqual(["req-0005", "req-pushed"]));
    expect(turnElement(FIRST_TURN)).toBe(first);
    expect(turnElement(SECOND_TURN)).toBe(second);
    expect(host.querySelector(".agent-request-row")).toBe(firstRow);
    expect(second?.contains(host.querySelector('[data-agent-request="req-pushed"]'))).toBe(true);
    expect(turnRenders.slice(rendersBefore)).toEqual([]);
  });

  it("says once that history is incomplete when more records exist than are kept", async () => {
    const feed = agentThreadRequestFeedFake();
    const closed = Array.from(
      { length: MAX_AGENT_THREAD_REQUESTS_RETAINED + 1 },
      (_unused, index) =>
        agentRuntimeRequestOf("timedOutApproval", {
          id: `req-${String(index).padStart(3, "0")}`,
          turnId: SECOND_TURN,
          order: index,
          createdAtEpochMs: 1_760_000_000_000,
          resolvedAtEpochMs: 1_760_000_000_001,
        }),
    );
    feed.record(agentThreadRequestsOf(SCOPE, closed));

    render(
      threadView([turnOf(FIRST_TURN, QUESTION_EVENTS), turnOf(SECOND_TURN, COMMAND_EVENTS)]),
      feed,
    );
    expect(historyNotes()).toEqual([]);

    await waitForReact(() => expect(requestIds().length).toBe(MAX_AGENT_THREAD_REQUESTS_RETAINED));
    const notes = historyNotes();
    expect(notes.map((note) => note.textContent)).toEqual([AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE]);
    expect(notes[0]?.getAttribute("role")).toBe("status");
    expect(notes[0]?.tagName).toBe("P");
    expect(new Set(requestIds()).size).toBe(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(requestIds()).not.toContain("req-000");
    expect(
      (notes[0]?.compareDocumentPosition(turnElement(FIRST_TURN) ?? host) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("says that stored records could not be read and that some could not be saved", async () => {
    const turns = [turnOf(FIRST_TURN, QUESTION_EVENTS)];
    const record = agentRuntimeRequestOf("resolvedQuestion", {
      turnId: FIRST_TURN,
      anchorToolId: ASK_TOOL,
    });
    const unreadable = agentThreadRequestFeedFake();
    unreadable.record(agentThreadRequestsOf(SCOPE, [record], { unreadable: 2 }));
    render(threadView(turns), unreadable);
    await waitForReact(() => expect(requestIds()).toEqual(["req-0005"]));
    expect(historyNotes().map((note) => note.textContent)).toEqual([
      AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE,
    ]);

    const degraded = agentThreadRequestFeedFake();
    degraded.record(agentThreadRequestsOf(SCOPE, [record], { journal: "degraded" }));
    render(threadView(turns), degraded);
    await waitForReact(() =>
      expect(historyNotes().map((note) => note.textContent)).toEqual([
        AGENT_REQUEST_HISTORY_UNSAVED_NOTE,
      ]),
    );
    const first = turnElement(FIRST_TURN);
    const rendersBefore = turnRenders.length;

    act(() =>
      degraded.publish(agentThreadRequestsOf(SCOPE, [], { journal: "degraded", unreadable: 1 })),
    );
    await waitForReact(() =>
      expect(historyNotes().map((note) => note.textContent)).toEqual([
        `${AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE} ${AGENT_REQUEST_HISTORY_UNSAVED_NOTE}`,
      ]),
    );
    expect(turnElement(FIRST_TURN)).toBe(first);
    expect(turnRenders.slice(rendersBefore)).toEqual([]);
  });

  it("shows no note for a clean thread and keeps its DOM identical to today's", async () => {
    const turns = [turnOf(FIRST_TURN, QUESTION_EVENTS), turnOf(SECOND_TURN, COMMAND_EVENTS)];
    render(threadView(turns));
    const today = markup();
    const feed = agentThreadRequestFeedFake();

    render(threadView(turns), feed);
    await waitForReact(() => expect(feed.currentThreadRequests).toHaveBeenCalled());
    await act(async () => Promise.resolve());

    expect(historyNotes()).toEqual([]);
    expect(markup()).toBe(today);
  });

  it("shows no note while the feed is unavailable, even if the journal is degraded", async () => {
    const turns = [turnOf(FIRST_TURN, QUESTION_EVENTS)];
    const failing = agentThreadRequestFeedFake();
    failing.record(agentThreadRequestsOf(SCOPE, [], { journal: "degraded", unreadable: 4 }));
    failing.currentThreadRequests.mockRejectedValue(new Error("unknown command"));

    render(threadView(turns), failing);
    await waitForReact(() => expect(failing.currentThreadRequests).toHaveBeenCalled());

    expect(historyNotes()).toEqual([]);

    const remote = agentThreadRequestFeedFake();
    remote.record(agentThreadRequestsOf(SCOPE, [], { journal: "degraded", unreadable: 4 }));
    render(threadView(turns, REMOTE), remote);
    await act(async () => Promise.resolve());
    expect(historyNotes()).toEqual([]);

    render(threadView(turns));
    expect(historyNotes()).toEqual([]);
  });

  it("shows history rows of a remote thread from the remote feed it describes", async () => {
    const gateway = remoteAgentThreadRequestGatewayFake();
    const remote = createRemoteAgentThreadRequestFeed(gateway);
    const local = agentThreadRequestFeedFake();
    const feed = createUnifiedAgentThreadRequestFeed({ local, remote });
    const describe = vi.spyOn(remote, "describe");
    const target = { serverId: REMOTE.serverId, threadId: REMOTE.conversationId };
    gateway.record(target, [
      agentRuntimeRequestOf("resolvedQuestion", { turnId: FIRST_TURN, anchorToolId: ASK_TOOL }),
    ]);
    const facts = {
      source: "snapshot",
      approvals: true,
      sequences: { [FIRST_TURN]: 4 },
      awaitingApproval: [],
    } as const;

    render(threadView([turnOf(FIRST_TURN, QUESTION_EVENTS)], { ...REMOTE, requests: facts }), feed);

    await waitForReact(() => expect(requestIds()).toEqual(["req-0005"]));
    expect(local.currentThreadRequests).not.toHaveBeenCalled();
    expect(describe.mock.calls[0]?.[1]).toEqual({
      source: "snapshot",
      reachable: true,
      turns: [
        { turnId: FIRST_TURN, startedAtEpochMs: 1_000, interactionSequence: 4, terminal: true },
      ],
      awaiting: [],
    });
    expect(gateway.readsOf(target)[0]?.turns.map((turn) => turn.turnId)).toEqual([FIRST_TURN]);
  });

  it("never shows another thread's records after the open thread changes", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(
      agentThreadRequestsOf(SCOPE, [
        agentRuntimeRequestOf("resolvedQuestion", { turnId: FIRST_TURN, anchorToolId: ASK_TOOL }),
      ]),
    );
    render(threadView([turnOf(FIRST_TURN, QUESTION_EVENTS)]), feed);
    await waitForReact(() => expect(requestIds()).toEqual(["req-0005"]));
    const other = threadView([turnOf(FIRST_TURN, QUESTION_EVENTS)]);

    render({ ...other, thread: { ...other.thread, threadId: "agt-thread-0002" } }, feed);

    expect(requestIds()).toEqual([]);
    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);
    await waitForReact(() =>
      expect(feed.currentThreadRequests.mock.calls.map(([scope]) => scope.threadId)).toContain(
        "agt-thread-0002",
      ),
    );
    expect(requestIds()).toEqual([]);
  });
});

describe("the thread request feed in the app composition", () => {
  it("is one router per app composition, handed to the agent surfaces and the pre-dispatch check", () => {
    vi.stubGlobal("localStorage", window.localStorage);
    const composition = createAgentAppComposition();
    const other = createAgentAppComposition();
    vi.unstubAllGlobals();

    const feed = composition.agentGateways.agentThreadRequestFeed;
    expect(feed).toBeDefined();
    expect(remoteAgentThreadRequestControl(feed!)).toBe(feed);
    expect(other.agentGateways.agentThreadRequestFeed).not.toBe(feed);
  });
});
