// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
import type { AgentApprovalGateway } from "./agentApprovalPorts";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  AGENT_PENDING_INTERACTION_POLL_MS,
  MAX_AGENT_PENDING_INTERACTION_THREADS,
  useAgentPendingInteractions,
} from "./useAgentPendingInteractions";

function runningView(
  threadId: string,
  turnId: string,
  updatedAtEpochMs: number,
  provider: "claudeCode" | "codex" = "claudeCode",
): AgentThreadView {
  return {
    lifecycle: "running",
    thread: {
      threadId,
      updatedAtEpochMs,
      provider: { kind: provider },
      owner: { rootKey: "/r", ownerId: "ws", repositoryRoot: "/r" },
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

class FakeGateway implements AgentQuestionGateway, AgentApprovalGateway {
  readonly calls: string[] = [];
  readonly pendingApproval = new Set<string>();
  readonly pendingQuestion = new Set<string>();
  inFlight = 0;
  maxInFlight = 0;
  hold: Promise<void> | null = null;

  private async track<T>(value: T): Promise<T> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.hold !== null) await this.hold;
      return value;
    } finally {
      this.inFlight -= 1;
    }
  }

  async list(owner: AgentQuestionOwner): Promise<readonly AgentQuestionRequest[]> {
    this.calls.push(`q:${owner.taskId}`);
    return this.track(
      this.pendingQuestion.has(owner.taskId) ? [{ status: "pending" } as AgentQuestionRequest] : [],
    );
  }

  async answer(): Promise<never> {
    throw new Error("unused");
  }

  async listApprovals(owner: AgentQuestionOwner): Promise<readonly AgentApprovalRequest[]> {
    this.calls.push(`a:${owner.taskId}`);
    return this.track(
      this.pendingApproval.has(owner.taskId) ? [{ status: "pending" } as AgentApprovalRequest] : [],
    );
  }

  async answerApproval(): Promise<never> {
    throw new Error("unused");
  }
}

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let latest: ReadonlyMap<string, string> = new Map();

function Probe({
  gateway,
  pinned = null,
  views,
}: {
  readonly gateway: FakeGateway | null;
  readonly pinned?: string | null;
  readonly views: ReadonlyArray<AgentThreadView>;
}) {
  latest = useAgentPendingInteractions(gateway, views, pinned);
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

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
  latest = new Map();
});

afterEach(() => {
  if (mounted) unmount();
  vi.useRealTimers();
});

async function flush() {
  for (let round = 0; round < 40; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function questionCalls(gateway: FakeGateway): string[] {
  return gateway.calls.filter((call) => call.startsWith("q:"));
}

describe("useAgentPendingInteractions", () => {
  it("reports approval for the exact running turn and drops it when the turn changes", async () => {
    const gateway = new FakeGateway();
    gateway.pendingApproval.add("turn-1");
    render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 1)]} />);
    await flush();
    expect(latest.get("a")).toBe("approval");
    render(<Probe gateway={gateway} views={[runningView("a", "turn-2", 2)]} />);
    expect(latest.get("a")).toBeUndefined();
    await flush();
    expect(latest.get("a")).toBeUndefined();
  });

  it("keeps the returned map identity while the observed interactions are unchanged", async () => {
    const gateway = new FakeGateway();
    gateway.pendingApproval.add("turn-1");
    render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 1)]} />);
    await flush();
    const first = latest;
    expect(first.get("a")).toBe("approval");
    render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 5)]} />);
    expect(latest).toBe(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS);
    });
    await flush();
    expect(latest).toBe(first);
    gateway.pendingApproval.clear();
    gateway.pendingQuestion.add("turn-1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS);
    });
    await flush();
    expect(latest).not.toBe(first);
    expect(latest.get("a")).toBe("input");
  });

  it("reports input for a pending question and clears it once the thread stops running", async () => {
    const gateway = new FakeGateway();
    gateway.pendingQuestion.add("turn-1");
    render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 1)]} />);
    await flush();
    expect(latest.get("a")).toBe("input");
    render(<Probe gateway={gateway} views={[settledView("a", "turn-1")]} />);
    expect(latest.size).toBe(0);
  });

  it("never publishes a late answer for a turn that was replaced while it was in flight", async () => {
    const gateway = new FakeGateway();
    gateway.pendingApproval.add("turn-1");
    let release: () => void = () => undefined;
    gateway.hold = new Promise<void>((done) => {
      release = done;
    });
    render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 1)]} />);
    await flush();
    expect(gateway.calls).toEqual(["a:turn-1"]);
    render(<Probe gateway={gateway} views={[runningView("a", "turn-2", 2)]} />);
    gateway.hold = null;
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(latest.get("a")).toBeUndefined();
    expect(gateway.calls).toContain("a:turn-2");
    expect(gateway.maxInFlight).toBe(1);
  });

  it("polls at most the newest 8 running threads, one request at a time, every 2 s, and stops on unmount", async () => {
    const gateway = new FakeGateway();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe gateway={gateway} views={views} />);
    await flush();
    const firstRound = questionCalls(gateway);
    expect(firstRound).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(firstRound).not.toContain("q:turn-0");
    expect(gateway.maxInFlight).toBe(1);
    gateway.calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS - 1);
    });
    expect(gateway.calls).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(questionCalls(gateway)).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    unmount();
    gateway.calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS * 3);
    });
    expect(gateway.calls).toEqual([]);
  });

  it("keeps polling on schedule when running threads only swap recency order", async () => {
    const gateway = new FakeGateway();
    render(
      <Probe
        gateway={gateway}
        views={[runningView("t1", "turn-1", 1), runningView("t2", "turn-2", 2)]}
      />,
    );
    await flush();
    expect(questionCalls(gateway)).toHaveLength(2);
    gateway.calls.length = 0;
    render(
      <Probe
        gateway={gateway}
        views={[runningView("t1", "turn-1", 3), runningView("t2", "turn-2", 2)]}
      />,
    );
    await flush();
    expect(gateway.calls).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS);
    });
    await flush();
    expect(questionCalls(gateway)).toHaveLength(2);
  });

  it("issues no further request after unmounting mid-round", async () => {
    const gateway = new FakeGateway();
    let release: () => void = () => undefined;
    gateway.hold = new Promise<void>((done) => {
      release = done;
    });
    render(
      <Probe
        gateway={gateway}
        views={[runningView("a", "turn-1", 1), runningView("b", "turn-2", 2)]}
      />,
    );
    await flush();
    expect(gateway.calls).toHaveLength(1);
    unmount();
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS * 3);
    });
    expect(gateway.calls).toHaveLength(1);
  });

  it("always polls the open thread even when it is older than the newest 8", async () => {
    const gateway = new FakeGateway();
    const views = Array.from({ length: 12 }, (_, index) =>
      runningView(`t${index}`, `turn-${index}`, index),
    );
    render(<Probe gateway={gateway} pinned="t0" views={views} />);
    await flush();
    const polled = questionCalls(gateway);
    expect(polled).toContain("q:turn-0");
    expect(polled).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
  });

  it("skips remote threads and Codex exec turns that cannot hold interactions", async () => {
    const gateway = new FakeGateway();
    const remote = {
      ...runningView("remote", "turn-r", 3),
      execution: { kind: "remote", interactiveQuestions: true },
    } as unknown as AgentThreadView;
    render(<Probe gateway={gateway} views={[remote, runningView("exec", "turn-x", 2, "codex")]} />);
    await flush();
    expect(gateway.calls).toEqual([]);
    expect(latest.size).toBe(0);
  });

  it("does nothing without a gateway or running threads", async () => {
    render(<Probe gateway={null} views={[runningView("a", "turn-1", 1)]} />);
    await flush();
    expect(latest.size).toBe(0);
    const gateway = new FakeGateway();
    render(<Probe gateway={gateway} views={[settledView("a", "turn-1")]} />);
    await flush();
    expect(gateway.calls).toEqual([]);
  });
});
