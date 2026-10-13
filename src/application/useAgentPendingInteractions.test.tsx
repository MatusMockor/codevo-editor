// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
import {
  agentInteractionFeedFake,
  agentInteractionSnapshotOf,
} from "../test/agentInteractionFeedFake";
import type { AgentInteractionFeed, AgentInteractionOwner } from "./agentInteractionPorts";
import {
  AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD,
  AGENT_INTERACTION_RETRY_BASE_MS,
} from "./agentInteractionStore";
import type { AgentQuestionGateway } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  MAX_AGENT_PENDING_INTERACTION_THREADS,
  useAgentPendingInteractionObservations,
  type AgentPendingInteractionObservations,
} from "./useAgentPendingInteractions";

const WORKSPACE = "ws";
const RETRY_AFTER_UNAVAILABLE_MS =
  AGENT_INTERACTION_RETRY_BASE_MS * 2 ** (AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD - 1);
const UNAVAILABLE_AFTER_MS = RETRY_AFTER_UNAVAILABLE_MS - AGENT_INTERACTION_RETRY_BASE_MS;

function runningView(
  threadId: string,
  turnId: string,
  updatedAtEpochMs: number,
  options: { readonly provider?: "claudeCode" | "codex"; readonly workspaceId?: string } = {},
): AgentThreadView {
  return {
    lifecycle: "running",
    thread: {
      threadId,
      updatedAtEpochMs,
      provider: { kind: options.provider ?? "claudeCode" },
      owner: { rootKey: "/r", ownerId: options.workspaceId ?? WORKSPACE, repositoryRoot: "/r" },
      turns: [{ turnId, status: { kind: "running" }, codexTransport: undefined }],
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

interface PendingRequests {
  readonly approval?: string;
  readonly question?: string;
}

class FakeFeed implements AgentQuestionGateway, AgentInteractionFeed {
  readonly unreadable = new Set<string>();
  readonly listed: string[] = [];
  hold: Promise<void> | null = null;
  private readonly feed = agentInteractionFeedFake();
  private sequence = 0;
  readonly subscribeInteractions = this.feed.subscribeInteractions;

  get subscriptions(): number {
    return this.feed.subscribeInteractions.mock.calls.length;
  }

  get subscribers(): number {
    return this.feed.subscribers();
  }

  get reads(): readonly string[] {
    return this.feed.currentInteractions.mock.calls.map(
      ([owner]) => `${owner.workspaceId}:${owner.taskId}`,
    );
  }

  async list(owner: { readonly taskId: string }): Promise<readonly AgentQuestionRequest[]> {
    this.listed.push(owner.taskId);
    return [];
  }

  answer(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }

  async currentInteractions(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot> {
    const recorded = this.feed.currentInteractions(owner);
    if (this.hold !== null) await this.hold;
    if (this.unreadable.has(owner.taskId)) return Promise.reject(new Error("offline"));
    return recorded;
  }

  seed(taskId: string, pending: PendingRequests, workspaceId = WORKSPACE): void {
    this.feed.record(this.next({ workspaceId, taskId }, pending));
  }

  push(taskId: string, pending: PendingRequests, workspaceId = WORKSPACE): void {
    this.feed.publish(this.next({ workspaceId, taskId }, pending));
  }

  readsOf(taskId: string, workspaceId = WORKSPACE): number {
    return this.reads.filter((read) => read === `${workspaceId}:${taskId}`).length;
  }

  private next(owner: AgentInteractionOwner, pending: PendingRequests): AgentInteractionSnapshot {
    this.sequence += 1;
    return agentInteractionSnapshotOf(owner, this.sequence, {
      approvals: requestsOf<AgentApprovalRequest>(owner, pending.approval),
      questions: requestsOf<AgentQuestionRequest>(owner, pending.question),
    });
  }
}

function requestsOf<Request>(owner: AgentInteractionOwner, id: string | undefined): Request[] {
  if (id === undefined) return [];
  return [{ id, taskId: owner.taskId, status: "pending" } as Request];
}

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let observations: AgentPendingInteractionObservations;
let renders = 0;

function Probe({
  gateway,
  pinned = null,
  views,
}: {
  readonly gateway: AgentQuestionGateway | null;
  readonly pinned?: string | null;
  readonly views: ReadonlyArray<AgentThreadView>;
}) {
  observations = useAgentPendingInteractionObservations(gateway, views, pinned);
  renders += 1;
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
      await Promise.resolve();
    });
  }
}

async function elapse(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function push(
  feed: FakeFeed,
  taskId: string,
  pending: PendingRequests,
  workspaceId?: string,
) {
  await act(async () => {
    feed.push(taskId, pending, workspaceId);
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

describe("useAgentPendingInteractionObservations", () => {
  it("reports a pushed approval and a pushed question without any timer", async () => {
    const feed = new FakeFeed();
    render(
      <Probe
        gateway={feed}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.get("b")).toBeNull();

    await push(feed, "turn-a", { approval: "req-1" });
    await push(feed, "turn-b", { question: "q-1" });

    expect(pending("a")).toBe("approval");
    expect(pending("b")).toBe("input");
    expect(observations.observed.get("a")).toEqual({ kind: "approval", id: "req-1" });
    expect(observations.observed.get("b")).toEqual({ kind: "input", id: "q-1" });
    expect(feed.listed).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports what is already pending when the thread starts being watched", async () => {
    const feed = new FakeFeed();
    feed.seed("turn-a", { question: "q-1" });
    render(<Probe gateway={feed} views={[runningView("a", "turn-a", 1)]} />);
    await settle();

    expect(pending("a")).toBe("input");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending interaction once it is resolved", async () => {
    const feed = new FakeFeed();
    render(<Probe gateway={feed} views={[runningView("a", "turn-a", 1)]} />);
    await settle();
    await push(feed, "turn-a", { approval: "req-1" });
    expect(pending("a")).toBe("approval");

    await push(feed, "turn-a", {});

    expect(observations.pending.size).toBe(0);
    expect(observations.observed.get("a")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("prefers the approval while a question is pending too", async () => {
    const feed = new FakeFeed();
    render(<Probe gateway={feed} views={[runningView("a", "turn-a", 1)]} />);
    await settle();

    await push(feed, "turn-a", { approval: "req-1", question: "q-1" });

    expect(observations.observed.get("a")).toEqual({ kind: "approval", id: "req-1" });
  });

  it("does not report a thread while its interactions cannot be read and reports it once they can", async () => {
    const feed = new FakeFeed();
    feed.unreadable.add("turn-b");
    render(
      <Probe
        gateway={feed}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.has("b")).toBe(false);

    await elapse(UNAVAILABLE_AFTER_MS);
    expect(feed.readsOf("turn-b")).toBe(AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD);
    expect(observations.observed.get("a")).toBeNull();
    expect(observations.observed.has("b")).toBe(false);
    expect(observations.pending.has("b")).toBe(false);

    feed.unreadable.delete("turn-b");
    feed.seed("turn-b", { approval: "req-b" });
    await elapse(RETRY_AFTER_UNAVAILABLE_MS);

    expect(observations.observed.get("b")).toEqual({ kind: "approval", id: "req-b" });
    expect(feed.readsOf("turn-a")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reporting a removed thread and ignores what is pushed for it afterwards", async () => {
    const feed = new FakeFeed();
    const a = runningView("a", "turn-a", 2);
    const b = runningView("b", "turn-b", 1);
    render(<Probe gateway={feed} views={[a, b]} />);
    await settle();
    await push(feed, "turn-b", { approval: "req-b" });
    expect(pending("b")).toBe("approval");

    render(<Probe gateway={feed} views={[a]} />);
    expect(observations.observed.has("b")).toBe(false);
    await settle();
    const settled = observations;
    const rendersBefore = renders;
    await push(feed, "turn-b", { approval: "req-b2" });

    expect(observations).toBe(settled);
    expect(renders).toBe(rendersBefore);
    expect(feed.readsOf("turn-a")).toBe(1);
  });

  it("watches a returning thread afresh instead of replaying what it saw before", async () => {
    const feed = new FakeFeed();
    const a = runningView("a", "turn-a", 2);
    const b = runningView("b", "turn-b", 1);
    render(<Probe gateway={feed} views={[a, b]} />);
    await settle();
    await push(feed, "turn-b", { approval: "req-b" });
    render(<Probe gateway={feed} views={[a]} />);
    await settle();
    feed.seed("turn-b", {});

    render(<Probe gateway={feed} views={[a, b]} />);
    expect(observations.observed.has("b")).toBe(false);
    await settle();

    expect(observations.observed.get("b")).toBeNull();
    expect(feed.readsOf("turn-b")).toBe(2);
    expect(feed.readsOf("turn-a")).toBe(1);
  });

  it("drops the previous turn at once and reports only the new turn of a thread", async () => {
    const feed = new FakeFeed();
    render(<Probe gateway={feed} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    await push(feed, "turn-1", { approval: "req-1" });
    expect(pending("a")).toBe("approval");

    render(<Probe gateway={feed} views={[runningView("a", "turn-2", 2)]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    expect(feed.readsOf("turn-2")).toBe(1);

    await push(feed, "turn-1", { approval: "req-late" });
    expect(observations.observed.get("a")).toBeNull();

    await push(feed, "turn-2", { question: "q-2" });
    expect(observations.observed.get("a")).toEqual({ kind: "input", id: "q-2" });
  });

  it("never publishes a read that settles after its turn was replaced", async () => {
    const feed = new FakeFeed();
    feed.seed("turn-1", { approval: "req-1" });
    let release: () => void = () => undefined;
    feed.hold = new Promise<void>((done) => {
      release = done;
    });
    render(<Probe gateway={feed} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(feed.readsOf("turn-1")).toBe(1);

    render(<Probe gateway={feed} views={[runningView("a", "turn-2", 2)]} />);
    feed.hold = null;
    await act(async () => {
      release();
    });
    await settle();

    expect(pending("a")).toBeUndefined();
    expect(observations.observed.get("a")).toBeNull();
  });

  it("treats workspace A, B and A again as separate owners of the same turn", async () => {
    const feed = new FakeFeed();
    const inA = runningView("a", "turn-1", 1, { workspaceId: "ws-a" });
    const inB = runningView("a", "turn-1", 1, { workspaceId: "ws-b" });
    render(<Probe gateway={feed} views={[inA]} />);
    await settle();
    await push(feed, "turn-1", { approval: "req-a" }, "ws-a");
    expect(pending("a")).toBe("approval");

    render(<Probe gateway={feed} views={[inB]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();
    expect(observations.observed.get("a")).toBeNull();
    await push(feed, "turn-1", { approval: "req-a2" }, "ws-a");
    expect(observations.observed.get("a")).toBeNull();

    feed.seed("turn-1", {}, "ws-a");
    render(<Probe gateway={feed} views={[inA]} />);
    expect(observations.observed.has("a")).toBe(false);
    await settle();

    expect(observations.observed.get("a")).toBeNull();
    expect(feed.readsOf("turn-1", "ws-a")).toBe(2);
    expect(feed.readsOf("turn-1", "ws-b")).toBe(1);
  });

  it("keeps the result identity while nothing observable changes", async () => {
    const feed = new FakeFeed();
    render(<Probe gateway={feed} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    await push(feed, "turn-1", { approval: "req-1" });
    const first = observations;
    expect(first.pending.get("a")).toBe("approval");

    render(<Probe gateway={feed} views={[runningView("a", "turn-1", 5)]} />);
    expect(observations).toBe(first);
    expect(observations.pending).toBe(first.pending);

    await push(feed, "turn-1", { approval: "req-1" });
    const rendersBefore = renders;
    await push(feed, "turn-1", { approval: "req-1" });
    expect(observations).toBe(first);
    expect(renders).toBe(rendersBefore);

    await push(feed, "turn-1", { question: "q-1" });
    expect(observations).not.toBe(first);
    expect(pending("a")).toBe("input");
  });

  it("keeps its watches when running threads only swap recency order", async () => {
    const feed = new FakeFeed();
    render(
      <Probe
        gateway={feed}
        views={[runningView("t1", "turn-1", 1), runningView("t2", "turn-2", 2)]}
      />,
    );
    await settle();
    await push(feed, "turn-1", { approval: "req-1" });
    const before = observations;
    expect(feed.reads).toHaveLength(2);

    render(
      <Probe
        gateway={feed}
        views={[runningView("t1", "turn-1", 3), runningView("t2", "turn-2", 2)]}
      />,
    );
    await settle();

    expect(feed.reads).toHaveLength(2);
    expect(observations).toBe(before);
  });

  it("watches at most the newest 8 running threads", async () => {
    const feed = new FakeFeed();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe gateway={feed} views={views} />);
    await settle();

    expect(feed.reads).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(feed.readsOf("turn-3")).toBe(0);
    expect(feed.readsOf("turn-4")).toBe(1);
    expect(observations.observed.size).toBe(MAX_AGENT_PENDING_INTERACTION_THREADS);

    await push(feed, "turn-0", { approval: "req-0" });
    expect(observations.observed.has("t0")).toBe(false);
    expect(observations.pending.size).toBe(0);
  });

  it("always watches the open thread even when it is older than the newest 8", async () => {
    const feed = new FakeFeed();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe gateway={feed} pinned="t0" views={views} />);
    await settle();

    expect(feed.reads).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(feed.readsOf("turn-0")).toBe(1);
    expect(feed.readsOf("turn-4")).toBe(0);

    await push(feed, "turn-0", { question: "q-0" });
    expect(pending("t0")).toBe("input");
  });

  it("clears a pending interaction once the thread stops running", async () => {
    const feed = new FakeFeed();
    feed.seed("turn-1", { question: "q-1" });
    render(<Probe gateway={feed} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(pending("a")).toBe("input");

    render(<Probe gateway={feed} views={[settledView("a", "turn-1")]} />);

    expect(observations.pending.size).toBe(0);
    expect(observations.observed.size).toBe(0);
  });

  it("skips remote threads and Codex exec turns that cannot hold interactions", async () => {
    const feed = new FakeFeed();
    const remote = {
      ...runningView("remote", "turn-r", 3),
      execution: { kind: "remote", interactiveQuestions: true },
    } as unknown as AgentThreadView;
    render(
      <Probe
        gateway={feed}
        views={[remote, runningView("exec", "turn-x", 2, { provider: "codex" })]}
      />,
    );
    await settle();

    expect(feed.reads).toEqual([]);
    expect(feed.listed).toEqual([]);
    expect(feed.subscriptions).toBe(0);
    expect(observations.observed.size).toBe(0);
  });

  it("observes nothing without a gateway, without a feed or without running threads", async () => {
    render(<Probe gateway={null} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(observations.observed.size).toBe(0);

    const list = vi.fn<AgentQuestionGateway["list"]>().mockResolvedValue([]);
    const pollOnly: AgentQuestionGateway = { list, answer: vi.fn() };
    render(<Probe gateway={pollOnly} views={[runningView("a", "turn-1", 1)]} />);
    await settle();
    expect(observations.observed.size).toBe(0);
    expect(list).not.toHaveBeenCalled();

    const feed = new FakeFeed();
    render(<Probe gateway={feed} views={[settledView("a", "turn-1")]} />);
    await settle();
    expect(feed.reads).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases every watch on unmount and schedules nothing afterwards", async () => {
    const feed = new FakeFeed();
    render(
      <Probe
        gateway={feed}
        views={[runningView("a", "turn-a", 2), runningView("b", "turn-b", 1)]}
      />,
    );
    await settle();
    expect(feed.subscriptions).toBe(1);
    expect(feed.subscribers).toBe(1);
    const reads = feed.reads.length;
    const rendersBefore = renders;

    unmount();
    await settle();
    feed.push("turn-a", { approval: "req-1" });
    await settle();

    expect(feed.subscribers).toBe(0);
    expect(feed.reads).toHaveLength(reads);
    expect(renders).toBe(rendersBefore);
    expect(vi.getTimerCount()).toBe(0);
  });
});
