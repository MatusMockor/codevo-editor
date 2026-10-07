// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import type { AgentTurn } from "../../domain/agentThread";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { useAgentThreadPresentationViews } from "./useAgentThreadPresentationViews";

const STARTED_AT = 1_700_000_000_000;

const runningTurn: AgentTurn = {
  turnId: "turn-running",
  prompt: "Run the gates",
  status: { kind: "running" },
  startedAtEpochMs: STARTED_AT,
  endedAtEpochMs: null,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 0,
  streamMetrics: null,
  launch: null,
  cliVersion: null,
};

function background(sinceEpochMs: number): AgentSessionBackground {
  return {
    ownerId: "agent-root:app",
    total: 1,
    agents: 0,
    tasks: [{ taskId: "b7sh0uutx", taskType: "shell", description: "Run the gates" }],
    sinceEpochMs,
    taskSinceEpochMs: new Map([["b7sh0uutx", sinceEpochMs]]),
    reply: { kind: "none" },
  };
}

function view(threadId: string, turns: ReadonlyArray<AgentTurn> = []): AgentThreadView {
  return surfaceThreadView({ thread: { ...surfaceThreadView().thread, threadId, turns } });
}

function without(source: AgentThreadView): AgentThreadView {
  const { sessionBackground: _dropped, ...rest } = source;
  return rest;
}

describe("useAgentThreadPresentationViews", () => {
  let host: HTMLDivElement;
  let root: Root;
  let presented: ReadonlyArray<AgentThreadView>;

  function Harness({ views }: { readonly views: ReadonlyArray<AgentThreadView> }) {
    presented = useAgentThreadPresentationViews(views);
    return null;
  }

  function present(views: ReadonlyArray<AgentThreadView>): ReadonlyArray<AgentThreadView> {
    act(() => root.render(createElement(Harness, { views })));
    return presented;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    presented = [];
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("presents a session background that appears, changes and disappears on an otherwise unchanged thread", () => {
    const gates = view("agt-1");
    const other = view("agt-2");
    const idle = present([gates, other]);
    expect(idle).toEqual([gates, other]);

    const live = { ...gates, sessionBackground: background(STARTED_AT) };
    const withLevel = present([live, other]);
    expect(withLevel[0]).toBe(live);
    expect(withLevel[1]).toBe(other);

    const later = { ...gates, sessionBackground: background(STARTED_AT + 60_000) };
    expect(present([later, other])[0]).toBe(later);

    const drained = without(later);
    const cleared = present([drained, other]);
    expect(cleared[0]).toBe(drained);
    expect(cleared[0]?.sessionBackground).toBeUndefined();
    expect(cleared[1]).toBe(other);
  });

  it("keeps the presented list while the session background is the same object", () => {
    const live = { ...view("agt-1"), sessionBackground: background(STARTED_AT) };
    const first = present([live]);

    expect(present([{ ...live }])).toBe(first);
  });

  it("keeps the presented list while a running turn only streams events", () => {
    const started = {
      ...view("agt-1", [runningTurn]),
      sessionBackground: background(STARTED_AT),
    };
    const first = present([started]);
    const streamed: AgentThreadView = {
      ...started,
      thread: {
        ...started.thread,
        turns: [
          { ...runningTurn, events: [{ kind: "assistantText", text: "Running the gates." }] },
        ],
      },
    };

    expect(present([streamed])).toBe(first);
    expect(presented[0]).toBe(started);
  });
});
