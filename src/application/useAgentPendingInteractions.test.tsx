// @vitest-environment jsdom
import { act, useEffect, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import type { RemoteRunnerReachability } from "../domain/remoteRunnerReachability";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
  type AgentThreadRequestFeedFake,
} from "../test/agentThreadRequestFeedFake";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending,
  remoteAgentThreadRequestResolved,
  remoteAgentThreadRequestScopeOf,
  remoteAgentThreadRequestTurnOf,
  type RemoteAgentThreadRequestGatewayFake,
} from "../test/remoteAgentThreadRequestGatewayFake";
import type { AgentThreadRequestFeed, AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD,
  AGENT_THREAD_REQUEST_RETRY_BASE_MS,
} from "./agentThreadRequestStore";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestFeed,
} from "./remoteAgentThreadRequestFeed";
import { REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS } from "./remoteAgentThreadRequestWatch";
import {
  createUnifiedAgentThreadRequestFeed,
  type UnifiedAgentThreadRequestFeed,
} from "./unifiedAgentThreadRequestFeed";
import {
  MAX_AGENT_PENDING_INTERACTION_DESCRIBED_LEGACY_THREADS,
  MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS,
  MAX_AGENT_PENDING_INTERACTION_THREADS,
  useAgentPendingInteractionObservations,
  type AgentPendingInteractionObservations,
} from "./useAgentPendingInteractions";

const WORKSPACE = "ws";
const ROOT = "/r";
const STARTED_AT = 1_760_000_000_000;
const RUNNER = "runner-1";
const UNAVAILABLE_AFTER_MS =
  AGENT_THREAD_REQUEST_RETRY_BASE_MS *
  (2 ** (AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD - 1) - 1);
const REACHABLE: RemoteRunnerReachability = { kind: "reachable" };
const RECONNECTING: RemoteRunnerReachability = { kind: "reconnecting" };

interface ViewOptions {
  readonly provider?: "claudeCode" | "codex";
  readonly workspaceId?: string;
}

function runningView(
  threadId: string,
  turnId: string,
  updatedAtEpochMs: number,
  options: ViewOptions = {},
): AgentThreadView {
  return {
    lifecycle: "running",
    thread: {
      threadId,
      updatedAtEpochMs,
      provider: { kind: options.provider ?? "claudeCode" },
      owner: { rootKey: ROOT, ownerId: options.workspaceId ?? WORKSPACE, repositoryRoot: ROOT },
      turns: [
        {
          turnId,
          status: { kind: "running" },
          codexTransport: undefined,
          startedAtEpochMs: STARTED_AT,
        },
      ],
    },
  } as unknown as AgentThreadView;
}

function settledView(threadId: string, turnId: string): AgentThreadView {
  const view = runningView(threadId, turnId, 1);
  return {
    ...view,
    lifecycle: "settled",
    thread: {
      ...view.thread,
      turns: [{ ...view.thread.turns[0]!, status: { kind: "exited", exitCode: 0 } }],
    },
  } as AgentThreadView;
}

interface RemoteViewOptions {
  readonly serverId?: string;
  readonly source?: "snapshot" | "legacy";
  readonly sequence?: number | null;
  readonly reachability?: RemoteRunnerReachability;
  readonly interactiveQuestions?: boolean;
}

function remoteView(
  conversationId: string,
  turnId: string,
  updatedAtEpochMs: number,
  options: RemoteViewOptions = {},
): AgentThreadView {
  const serverId = options.serverId ?? "srv-a";
  const sequence = options.sequence ?? null;
  return {
    ...runningView(
      `remote-thread:${serverId}:${RUNNER}:${conversationId}`,
      turnId,
      updatedAtEpochMs,
    ),
    execution: {
      kind: "remote",
      interactiveQuestions: options.interactiveQuestions ?? true,
      serverId,
      runnerId: RUNNER,
      projectId: "project-1",
      conversationId,
      latestTaskId: turnId,
      resume: null,
      reachability: options.reachability ?? REACHABLE,
      requests: {
        source: options.source ?? "snapshot",
        approvals: true,
        sequences: sequence === null ? {} : { [turnId]: sequence },
        awaitingApproval: [],
      },
    },
  } as unknown as AgentThreadView;
}

function remoteThreadId(conversationId: string, serverId = "srv-a"): string {
  return `remote-thread:${serverId}:${RUNNER}:${conversationId}`;
}

function localScope(threadId: string, workspaceId = WORKSPACE): AgentThreadRequestScope {
  return { rootKey: ROOT, ownerId: agentRootOwnerId(ROOT), threadId, workspaceId };
}

function approval(turnId: string, id: string, version = 1): AgentRuntimeRequest {
  return remoteAgentThreadRequestPending(turnId, id, version);
}

function question(turnId: string, id: string, version = 1): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingQuestion", { turnId, id, version, order: 1 });
}

function resolved(turnId: string, id: string, version = 3): AgentRuntimeRequest {
  return remoteAgentThreadRequestResolved(turnId, id, version);
}

class LocalFeed {
  readonly fake: AgentThreadRequestFeedFake = agentThreadRequestFeedFake();
  readonly unreadable = new Set<string>();
  hold: Promise<void> | null = null;

  constructor() {
    const read = this.fake.currentThreadRequests.getMockImplementation();
    this.fake.currentThreadRequests.mockImplementation(async (scope, turnIds, cursor) => {
      if (this.hold !== null) await this.hold;
      if (this.unreadable.has(scope.threadId)) return Promise.reject(new Error("offline"));
      expect(read).toBeDefined();
      return read!(scope, turnIds, cursor);
    });
  }

  get reads(): readonly string[] {
    return this.fake.currentThreadRequests.mock.calls.map(
      ([scope, turnIds]) => `${scope.workspaceId}:${scope.threadId}:${turnIds.join(",")}`,
    );
  }

  readsOf(threadId: string, turnId: string, workspaceId = WORKSPACE): number {
    return this.reads.filter((read) => read === `${workspaceId}:${threadId}:${turnId}`).length;
  }

  seed(threadId: string, requests: readonly AgentRuntimeRequest[], workspaceId = WORKSPACE) {
    this.fake.record(agentThreadRequestsOf(localScope(threadId, workspaceId), requests));
  }

  push(threadId: string, requests: readonly AgentRuntimeRequest[], workspaceId = WORKSPACE) {
    this.fake.publish(agentThreadRequestsOf(localScope(threadId, workspaceId), requests));
  }
}

interface RemoteHarness {
  readonly gateway: RemoteAgentThreadRequestGatewayFake;
  readonly remote: RemoteAgentThreadRequestFeed;
  readonly feed: UnifiedAgentThreadRequestFeed;
}

function remoteHarness(): RemoteHarness {
  const gateway = remoteAgentThreadRequestGatewayFake();
  const remote = createRemoteAgentThreadRequestFeed(gateway);
  const feed = createUnifiedAgentThreadRequestFeed({ local: agentThreadRequestFeedFake(), remote });
  return { gateway, remote, feed };
}

function target(conversationId: string, serverId = "srv-a") {
  return { serverId, threadId: conversationId };
}

function recordedScopeOperations(remote: RemoteAgentThreadRequestFeed) {
  const operations: Array<readonly [string, "describe" | "release"]> = [];
  const describe = remote.describe.bind(remote);
  const release = remote.release.bind(remote);
  vi.spyOn(remote, "describe").mockImplementation((scope, description) => {
    operations.push([scope.threadId, "describe"]);
    return describe(scope, description);
  });
  vi.spyOn(remote, "release").mockImplementation((scope) => {
    operations.push([scope.threadId, "release"]);
    release(scope);
  });
  return {
    last: (threadId: string) =>
      operations.filter(([scoped]) => scoped === threadId).slice(-1)[0]?.[1] ?? null,
  };
}

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let observations: AgentPendingInteractionObservations;
let renders = 0;

function Probe({
  children = null,
  feed,
  pinned = null,
  views,
}: {
  readonly children?: ReactNode;
  readonly feed: AgentThreadRequestFeed | null;
  readonly pinned?: string | null;
  readonly views: ReadonlyArray<AgentThreadView>;
}) {
  observations = useAgentPendingInteractionObservations(feed, views, pinned);
  renders += 1;
  return children;
}

function OpenThreadDescriber({
  feed,
  turnId,
  view,
}: {
  readonly feed: UnifiedAgentThreadRequestFeed;
  readonly turnId: string;
  readonly view: AgentThreadView;
}) {
  const { serverId, conversationId, requests } = view.execution!;
  const sequence = requests?.sequences[turnId] ?? null;
  const scope = useMemo(
    () => remoteAgentThreadRequestScopeOf(serverId, conversationId),
    [conversationId, serverId],
  );
  useEffect(() => () => feed.release(scope), [feed, scope]);
  useEffect(() => {
    feed.describe(scope, {
      source: "snapshot",
      reachable: true,
      turns: [remoteAgentThreadRequestTurnOf(turnId, sequence)],
      awaiting: [],
    });
  }, [feed, scope, sequence, turnId]);
  return null;
}

function render(element: React.ReactElement) {
  act(() => root.render(element));
  mounted = true;
}

function unmount() {
  act(() => root.unmount());
  mounted = false;
}

async function settle() {
  for (let round = 0; round < 20; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

async function elapse(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function push(
  feed: LocalFeed,
  threadId: string,
  requests: readonly AgentRuntimeRequest[],
  workspaceId?: string,
) {
  await act(async () => {
    feed.push(threadId, requests, workspaceId);
  });
}

function pending(threadId: string) {
  return observations.pending.get(threadId);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
  renders = 0;
});

afterEach(() => {
  if (mounted) unmount();
  vi.useRealTimers();
});

describe("useAgentPendingInteractionObservations for local threads", () => {
  it("reports a pushed approval and a pushed question without any timer", async () => {
    const feed = new LocalFeed();
    render(
      <Probe
        feed={feed.fake}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.get("b")).toBeNull();

    await push(feed, "a", [approval("turn-a", "req-1")]);
    await push(feed, "b", [question("turn-b", "q-1")]);

    expect(pending("a")).toBe("approval");
    expect(pending("b")).toBe("input");
    expect(observations.observed.get("a")).toEqual({ kind: "approval", id: "req-1" });
    expect(observations.observed.get("b")).toEqual({ kind: "input", id: "q-1" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports what is already pending when the thread starts being watched", async () => {
    const feed = new LocalFeed();
    feed.seed("a", [question("turn-a", "q-1")]);
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-a", 1)]} />);
    await settle();

    expect(pending("a")).toBe("input");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending interaction once its record settles", async () => {
    const feed = new LocalFeed();
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-a", 1)]} />);
    await settle();
    await push(feed, "a", [approval("turn-a", "req-1")]);
    expect(pending("a")).toBe("approval");

    await push(feed, "a", [resolved("turn-a", "req-1")]);

    expect(observations.pending.size).toBe(0);
    expect(observations.observed.get("a")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("prefers the approval while a question is pending too", async () => {
    const feed = new LocalFeed();
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-a", 1)]} />);
    await settle();

    await push(feed, "a", [question("turn-a", "q-1"), approval("turn-a", "req-1")]);

    expect(observations.observed.get("a")).toEqual({ kind: "approval", id: "req-1" });
  });

  it("ignores pending requests of an earlier turn of the same thread", async () => {
    const feed = new LocalFeed();
    feed.seed("a", [approval("turn-old", "req-old")]);
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-a", 1)]} />);
    await settle();

    expect(observations.observed.get("a")).toBeNull();
  });

  it("does not report a thread while its requests cannot be read and reports it once they can", async () => {
    const feed = new LocalFeed();
    feed.unreadable.add("b");
    render(
      <Probe
        feed={feed.fake}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.has("b")).toBe(false);

    await elapse(UNAVAILABLE_AFTER_MS);
    expect(feed.readsOf("b", "turn-b")).toBe(AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD);
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.has("b")).toBe(false);
    expect(observations.pending.has("b")).toBe(false);

    feed.unreadable.delete("b");
    feed.seed("b", [approval("turn-b", "req-b")]);
    await elapse(
      AGENT_THREAD_REQUEST_RETRY_BASE_MS * 2 ** AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD,
    );
    await settle();

    expect(observations.observed.get("b")).toEqual({ kind: "approval", id: "req-b" });
    expect(feed.readsOf("a", "turn-a")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reporting a removed thread and ignores what is pushed for it afterwards", async () => {
    const feed = new LocalFeed();
    const a = runningView("a", "turn-a", 2);
    const b = runningView("b", "turn-b", 1);
    render(<Probe feed={feed.fake} views={[a, b]} />);
    await settle();
    await push(feed, "b", [approval("turn-b", "req-b")]);
    expect(pending("b")).toBe("approval");

    render(<Probe feed={feed.fake} views={[a]} />);
    expect(observations.observed.has("b")).toBe(false);
    await settle();
    const settled = observations;
    const rendersBefore = renders;
    await push(feed, "b", [approval("turn-b", "req-b2")]);

    expect(observations).toBe(settled);
    expect(renders).toBe(rendersBefore);
    expect(feed.readsOf("a", "turn-a")).toBe(1);
  });

  it("watches a returning thread afresh instead of replaying what it saw before", async () => {
    const feed = new LocalFeed();
    const a = runningView("a", "turn-a", 2);
    const b = runningView("b", "turn-b", 1);
    render(<Probe feed={feed.fake} views={[a, b]} />);
    await settle();
    await push(feed, "b", [approval("turn-b", "req-b")]);
    render(<Probe feed={feed.fake} views={[a]} />);
    await settle();
    feed.seed("b", [resolved("turn-b", "req-b")]);

    render(<Probe feed={feed.fake} views={[a, b]} />);
    expect(observations.observed.has("b")).toBe(false);
    await settle();

    expect(observations.observed.get("b")).toBeNull();
    expect(feed.readsOf("b", "turn-b")).toBe(2);
    expect(feed.readsOf("a", "turn-a")).toBe(1);
  });

  it("drops the previous turn at once and reports only the new turn of a thread", async () => {
    const feed = new LocalFeed();
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    await push(feed, "a", [approval("turn-1", "req-1")]);
    expect(pending("a")).toBe("approval");

    render(<Probe feed={feed.fake} views={[runningView("a", "turn-2", 2)]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(feed.readsOf("a", "turn-2")).toBe(1);

    await push(feed, "a", [approval("turn-1", "req-late")]);
    expect(observations.observed.get("a")).toBeNull();

    await push(feed, "a", [question("turn-2", "q-2")]);
    expect(observations.observed.get("a")).toEqual({ kind: "input", id: "q-2" });
  });

  it("never publishes a read that settles after its turn was replaced", async () => {
    const feed = new LocalFeed();
    feed.seed("a", [approval("turn-1", "req-1")]);
    let release: () => void = () => undefined;
    feed.hold = new Promise<void>((done) => {
      release = done;
    });
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-1", 1)]} />);
    await act(async () => {
      await Promise.resolve();
    });

    render(<Probe feed={feed.fake} views={[runningView("a", "turn-2", 2)]} />);
    feed.hold = null;
    await act(async () => {
      release();
    });
    await settle();

    expect(pending("a")).toBeUndefined();
    expect(observations.observed.get("a")).toBeNull();
  });

  it("treats workspace A, B and A again as separate owners of the same thread", async () => {
    const feed = new LocalFeed();
    const inA = runningView("a", "turn-1", 1, { workspaceId: "ws-a" });
    const inB = runningView("a", "turn-1", 1, { workspaceId: "ws-b" });
    render(<Probe feed={feed.fake} views={[inA]} />);
    await settle();
    await push(feed, "a", [approval("turn-1", "req-a")], "ws-a");
    expect(pending("a")).toBe("approval");
    await push(feed, "a", [resolved("turn-1", "req-a")], "ws-a");
    expect(observations.observed.get("a")).toBeNull();

    render(<Probe feed={feed.fake} views={[inB]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    await push(feed, "a", [approval("turn-1", "req-a2")], "ws-a");
    expect(observations.observed.get("a")).toBeNull();

    render(<Probe feed={feed.fake} views={[inA]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();

    expect(observations.observed.get("a")).toEqual({ kind: "approval", id: "req-a2" });
    expect(feed.readsOf("a", "turn-1", "ws-a")).toBe(2);
    expect(feed.readsOf("a", "turn-1", "ws-b")).toBe(1);
  });

  it("keeps the result identity while nothing observable changes", async () => {
    const feed = new LocalFeed();
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    await push(feed, "a", [approval("turn-1", "req-1")]);
    const first = observations;
    expect(first.pending.get("a")).toBe("approval");

    render(<Probe feed={feed.fake} views={[runningView("a", "turn-1", 5)]} />);
    expect(observations).toBe(first);
    expect(observations.pending).toBe(first.pending);

    await push(feed, "a", [approval("turn-1", "req-1")]);
    const rendersBefore = renders;
    await push(feed, "a", [approval("turn-1", "req-1")]);
    expect(observations).toBe(first);
    expect(renders).toBe(rendersBefore);

    await push(feed, "a", [resolved("turn-1", "req-1"), question("turn-1", "q-1")]);
    expect(observations).not.toBe(first);
    expect(pending("a")).toBe("input");
  });

  it("keeps its watches when running threads only swap recency order", async () => {
    const feed = new LocalFeed();
    render(
      <Probe
        feed={feed.fake}
        views={[runningView("t1", "turn-1", 1), runningView("t2", "turn-2", 2)]}
      />,
    );
    await settle();
    await push(feed, "t1", [approval("turn-1", "req-1")]);
    const before = observations;
    expect(feed.reads).toHaveLength(2);

    render(
      <Probe
        feed={feed.fake}
        views={[runningView("t1", "turn-1", 3), runningView("t2", "turn-2", 2)]}
      />,
    );
    await settle();

    expect(feed.reads).toHaveLength(2);
    expect(observations).toBe(before);
  });

  it("watches at most the newest 8 running threads", async () => {
    const feed = new LocalFeed();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe feed={feed.fake} views={views} />);
    await settle();

    expect(feed.reads).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(feed.readsOf("t3", "turn-3")).toBe(0);
    expect(feed.readsOf("t4", "turn-4")).toBe(1);
    expect(observations.observed.size).toBe(MAX_AGENT_PENDING_INTERACTION_THREADS);

    await push(feed, "t0", [approval("turn-0", "req-0")]);
    expect(observations.observed.has("t0")).toBe(false);
    expect(observations.pending.size).toBe(0);
  });

  it("always watches the open thread even when it is older than the newest 8", async () => {
    const feed = new LocalFeed();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe feed={feed.fake} pinned="t0" views={views} />);
    await settle();

    expect(feed.reads).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(feed.readsOf("t0", "turn-0")).toBe(1);
    expect(feed.readsOf("t4", "turn-4")).toBe(0);

    await push(feed, "t0", [question("turn-0", "q-0")]);
    expect(pending("t0")).toBe("input");
  });

  it("clears a pending interaction once the thread stops running", async () => {
    const feed = new LocalFeed();
    feed.seed("a", [question("turn-1", "q-1")]);
    render(<Probe feed={feed.fake} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(pending("a")).toBe("input");

    render(<Probe feed={feed.fake} views={[settledView("a", "turn-1")]} />);

    expect(observations.pending.size).toBe(0);
    expect(observations.observed.size).toBe(0);
  });

  it("skips Codex exec turns, and remote threads when the feed cannot describe them", async () => {
    const feed = new LocalFeed();
    render(
      <Probe
        feed={feed.fake}
        views={[
          remoteView("conv-r", "turn-r", 3),
          runningView("exec", "turn-x", 2, { provider: "codex" }),
        ]}
      />,
    );
    await settle();

    expect(feed.reads).toEqual([]);
    expect(feed.fake.subscribeThreadRequests).not.toHaveBeenCalled();
    expect(observations.observed.size).toBe(0);
  });

  it("observes nothing without a feed or without running threads", async () => {
    render(<Probe feed={null} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(observations.observed.size).toBe(0);

    const feed = new LocalFeed();
    render(<Probe feed={feed.fake} views={[settledView("a", "turn-1")]} />);
    await settle();
    expect(feed.reads).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases every watch on unmount and schedules nothing afterwards", async () => {
    const feed = new LocalFeed();
    render(
      <Probe
        feed={feed.fake}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(feed.fake.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(feed.fake.subscribers()).toBe(1);
    const reads = feed.reads.length;
    const rendersBefore = renders;

    unmount();
    await settle();
    feed.push("a", [approval("turn-a", "req-1")]);
    await settle();

    expect(feed.fake.subscribers()).toBe(0);
    expect(feed.reads).toHaveLength(reads);
    expect(renders).toBe(rendersBefore);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useAgentPendingInteractionObservations for remote threads", () => {
  it("shows approval and input badges for running remote threads and clears a settled record", async () => {
    const { gateway, feed } = remoteHarness();
    gateway.record(target("conv-1"), [approval("turn-1", "req-1")]);
    gateway.record(target("conv-2"), [question("turn-2", "q-2")]);
    render(
      <Probe
        feed={feed}
        views={[
          remoteView("conv-1", "turn-1", 2, { sequence: 1 }),
          remoteView("conv-2", "turn-2", 1, { sequence: 1 }),
        ]}
      />,
    );
    await settle();

    expect(pending(remoteThreadId("conv-1"))).toBe("approval");
    expect(pending(remoteThreadId("conv-2"))).toBe("input");

    gateway.record(target("conv-1"), [resolved("turn-1", "req-1")]);
    render(
      <Probe
        feed={feed}
        views={[
          remoteView("conv-1", "turn-1", 2, { sequence: 2 }),
          remoteView("conv-2", "turn-2", 1, { sequence: 1 }),
        ]}
      />,
    );
    await settle();
    expect(observations.observed.get(remoteThreadId("conv-1"))).toBeNull();
    expect(pending(remoteThreadId("conv-2"))).toBe("input");
  });

  it("reads a snapshot runner once per sequence move and keeps no timer while idle", async () => {
    const { gateway, feed } = remoteHarness();
    render(<Probe feed={feed} views={[remoteView("conv-1", "turn-1", 1, { sequence: 1 })]} />);
    await settle();
    const reads = gateway.readsOf(target("conv-1")).length;
    expect(observations.observed.get(remoteThreadId("conv-1"))).toBeNull();

    await elapse(30_000);
    expect(gateway.readsOf(target("conv-1"))).toHaveLength(reads);
    expect(vi.getTimerCount()).toBe(0);

    gateway.record(target("conv-1"), [approval("turn-1", "req-1")]);
    render(<Probe feed={feed} views={[remoteView("conv-1", "turn-1", 1, { sequence: 2 })]} />);
    await settle();

    expect(gateway.readsOf(target("conv-1"))).toHaveLength(reads + 1);
    expect(pending(remoteThreadId("conv-1"))).toBe("approval");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a remote thread that stops being a target and stops its legacy ticks", async () => {
    const { gateway, remote, feed } = remoteHarness();
    const release = vi.spyOn(remote, "release");
    const kept = runningView("local", "turn-l", 5);
    const legacy = remoteView("conv-1", "turn-1", 1, { source: "legacy" });
    render(<Probe feed={feed} views={[kept, legacy]} />);
    await settle();
    await elapse(REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS * 2);
    expect(gateway.readsOf(target("conv-1")).length).toBeGreaterThan(1);

    render(<Probe feed={feed} views={[kept]} />);
    await settle();
    const reads = gateway.readsOf(target("conv-1")).length;
    await elapse(REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS * 5);

    expect(release).toHaveBeenCalledWith(remoteAgentThreadRequestScopeOf("srv-a", "conv-1"));
    expect(gateway.readsOf(target("conv-1"))).toHaveLength(reads);
    expect(observations.observed.has(remoteThreadId("conv-1"))).toBe(false);
  });

  it("keeps the last badge of an unreachable remote thread without reading it", async () => {
    const { gateway, feed } = remoteHarness();
    gateway.record(target("conv-1"), [approval("turn-1", "req-1")]);
    render(<Probe feed={feed} views={[remoteView("conv-1", "turn-1", 1, { source: "legacy" })]} />);
    await settle();
    expect(pending(remoteThreadId("conv-1"))).toBe("approval");

    render(
      <Probe
        feed={feed}
        views={[
          remoteView("conv-1", "turn-1", 1, { source: "legacy", reachability: RECONNECTING }),
        ]}
      />,
    );
    await settle();
    const reads = gateway.readsOf(target("conv-1")).length;
    await elapse(REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS * 10);

    expect(gateway.readsOf(target("conv-1"))).toHaveLength(reads);
    expect(pending(remoteThreadId("conv-1"))).toBe("approval");
  });

  it("describes at most the capped number of remote threads and of legacy threads", async () => {
    const { remote, feed } = remoteHarness();
    const describe = vi.spyOn(remote, "describe");
    const snapshots = Array.from({ length: 6 }, (_, index) =>
      remoteView(`conv-s${index}`, `turn-s${index}`, 100 + index),
    );
    const legacies = Array.from({ length: 3 }, (_, index) =>
      remoteView(`conv-l${index}`, `turn-l${index}`, 200 + index, { source: "legacy" }),
    );
    render(<Probe feed={feed} views={[...snapshots, ...legacies]} />);
    await settle();

    const described = new Set(describe.mock.calls.map(([scope]) => scope.threadId));
    expect(described.size).toBe(MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS);
    expect([...described].filter((id) => id.startsWith("conv-l"))).toHaveLength(
      MAX_AGENT_PENDING_INTERACTION_DESCRIBED_LEGACY_THREADS,
    );
    expect(observations.observed.size).toBe(MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS);
  });

  it("leaves the open remote thread to its own describer and still shows its badge", async () => {
    const { gateway, remote, feed } = remoteHarness();
    const describe = vi.spyOn(remote, "describe");
    const release = vi.spyOn(remote, "release");
    gateway.record(target("conv-open"), [approval("turn-o", "req-o")]);
    const open = remoteView("conv-open", "turn-o", 1, { sequence: 1 });
    render(
      <Probe feed={feed} pinned={remoteThreadId("conv-open")} views={[open]}>
        <OpenThreadDescriber feed={feed} turnId="turn-o" view={open} />
      </Probe>,
    );
    await settle();

    expect(pending(remoteThreadId("conv-open"))).toBe("approval");
    expect(describe.mock.calls.map(([scope]) => scope.threadId)).toEqual(["conv-open"]);

    unmount();
    expect(release.mock.calls.map(([scope]) => scope.threadId)).toEqual(["conv-open"]);
  });

  it("keeps both scopes described when the selection swaps between two remote threads", async () => {
    const { gateway, remote, feed } = remoteHarness();
    const operations = recordedScopeOperations(remote);
    const viewsAt = (sequence: number) => [
      remoteView("conv-a", "turn-a", 2, { sequence }),
      remoteView("conv-b", "turn-b", 1, { sequence }),
    ];
    const selected = (pinned: "conv-a" | "conv-b", sequence: number) => {
      const views = viewsAt(sequence);
      const open = pinned === "conv-a" ? views[0]! : views[1]!;
      return (
        <Probe feed={feed} pinned={remoteThreadId(pinned)} views={views}>
          <OpenThreadDescriber
            feed={feed}
            turnId={pinned === "conv-a" ? "turn-a" : "turn-b"}
            view={open}
          />
        </Probe>
      );
    };
    render(selected("conv-a", 1));
    await settle();
    expect(observations.observed.get(remoteThreadId("conv-a"))).toBeNull();
    expect(observations.observed.get(remoteThreadId("conv-b"))).toBeNull();

    render(selected("conv-b", 1));
    await settle();
    expect(operations.last("conv-a")).toBe("describe");
    expect(operations.last("conv-b")).toBe("describe");
    gateway.record(target("conv-a"), [approval("turn-a", "req-a")]);
    gateway.record(target("conv-b"), [question("turn-b", "q-b")]);
    render(selected("conv-b", 2));
    await settle();

    expect(pending(remoteThreadId("conv-a"))).toBe("approval");
    expect(pending(remoteThreadId("conv-b"))).toBe("input");

    render(selected("conv-a", 2));
    await settle();
    expect(operations.last("conv-a")).toBe("describe");
    expect(operations.last("conv-b")).toBe("describe");
    gateway.record(target("conv-a"), [resolved("turn-a", "req-a")]);
    gateway.record(target("conv-b"), [approval("turn-b", "req-b")]);
    render(selected("conv-a", 3));
    await settle();

    expect(observations.observed.get(remoteThreadId("conv-a"))).toBeNull();
    expect(pending(remoteThreadId("conv-b"))).toBe("approval");
  });

  it("does not watch a legacy remote thread whose runner has no interactive questions", async () => {
    const { gateway, feed } = remoteHarness();
    render(
      <Probe
        feed={feed}
        views={[
          remoteView("conv-1", "turn-1", 1, { source: "legacy", interactiveQuestions: false }),
        ]}
      />,
    );
    await settle();
    await elapse(REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS * 3);

    expect(gateway.threadRequests).not.toHaveBeenCalled();
    expect(observations.observed.size).toBe(0);
  });

  it("releases every described remote scope on unmount and schedules nothing afterwards", async () => {
    const { remote, feed } = remoteHarness();
    const release = vi.spyOn(remote, "release");
    render(
      <Probe
        feed={feed}
        views={[
          remoteView("conv-1", "turn-1", 2, { sequence: 1 }),
          remoteView("conv-2", "turn-2", 1, { source: "legacy" }),
        ]}
      />,
    );
    await settle();

    unmount();
    await settle();

    expect(release.mock.calls.map(([scope]) => scope.threadId).sort()).toEqual([
      "conv-1",
      "conv-2",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
