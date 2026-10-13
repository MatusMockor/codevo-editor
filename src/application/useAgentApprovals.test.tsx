// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  agentInteractionFeedFake,
  agentInteractionSnapshotOf,
} from "../test/agentInteractionFeedFake";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import type { AgentInteractionFeed } from "./agentInteractionPorts";
import {
  AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD as FAILURE_NOTICE_THRESHOLD,
  AGENT_INTERACTION_RETRY_BASE_MS,
} from "./agentInteractionStore";
import type { AgentPendingRequestAvailability } from "./agentPendingRequestPolling";
import type { AgentLocalQuestionOwner, AgentQuestionGateway } from "./agentQuestionPorts";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
import { useAgentApprovals, type AgentApprovalsSurface } from "./useAgentApprovals";
import { useAgentQuestions } from "./useAgentQuestions";

const UNAVAILABLE_NOTICE = "Approvals from this agent can't be shown right now.";
const REMOTE: AgentApprovalOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "task-a",
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

interface Props {
  readonly gateway: AgentApprovalGateway | null;
  readonly owner: AgentApprovalOwner | null;
  readonly running: boolean;
  readonly availability?: AgentPendingRequestAvailability;
}

function renderApprovals(initial: Props) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const result = {} as { current: AgentApprovalsSurface };
  const errors: (string | null)[] = [];
  function Harness(props: Props) {
    result.current = useAgentApprovals(
      props.gateway,
      props.owner,
      props.running,
      props.availability,
    );
    errors.push(result.current.error);
    return null;
  }
  const rerender = (props: Props) => act(() => root.render(<Harness {...props} />));
  rerender(initial);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  return { result, rerender, unmount, errors };
}

function owner(taskId: string, workspaceId = "workspace"): AgentLocalQuestionOwner {
  return { kind: "local", workspaceId, taskId };
}

function approval(taskId: string, id = "approval-1"): AgentApprovalRequest {
  return {
    id,
    taskId,
    provider: "claudeCode",
    kind: "command",
    title: "Run a command?",
    detail: "npm test",
    detailTruncated: false,
    facts: [],
    decisions: ["allowOnce", "deny"],
    status: "pending",
  };
}

function question(taskId: string): AgentQuestionRequest {
  return {
    id: "question",
    taskId,
    provider: "claudeCode",
    status: "pending",
    questions: [
      {
        id: "q",
        header: "Choose",
        prompt: "Which?",
        multiple: false,
        allowCustom: true,
        options: [{ id: "a", label: "A", description: "" }],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settleFeed() {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function feedGateway() {
  return Object.assign(agentInteractionFeedFake(), {
    answerApproval: vi.fn<AgentApprovalGateway["answerApproval"]>(),
  });
}

function listing(
  target: AgentLocalQuestionOwner,
  sequence: number,
  approvals: readonly AgentApprovalRequest[],
  questions: readonly AgentQuestionRequest[] = [],
): AgentInteractionSnapshot {
  return agentInteractionSnapshotOf(target, sequence, { approvals, questions });
}

function statuses(requests: readonly AgentApprovalRequest[]) {
  return requests.map((request) => [request.id, request.status]);
}

describe("useAgentApprovals", () => {
  const A = owner("task-a");
  const pending = approval("task-a");
  const next = approval("task-a", "approval-next");
  const approved: AgentApprovalRequest = { ...pending, status: "approved", decision: "allowOnce" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a pushed approval without any timer and publishes the confirmed decision", async () => {
    const gateway = feedGateway();
    gateway.answerApproval.mockResolvedValue(approved);
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([]);
    act(() => gateway.publish(listing(A, 1, [pending])));
    expect(result.current.requests).toEqual([pending]);
    expect(vi.getTimerCount()).toBe(0);
    await act(() => result.current.answer(pending.id, "allowOnce"));
    expect(gateway.answerApproval).toHaveBeenCalledWith(A, pending.id, "allowOnce");
    expect(result.current.requests[0]?.status).toBe("approved");
    expect(result.current.answering).toBeNull();
  });

  it("recovers the current pending approval when it mounts after the push", async () => {
    const gateway = feedGateway();
    gateway.record(listing(A, 3, [pending]));
    const { result } = renderApprovals({ gateway, owner: A, running: false });
    await settleFeed();
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.currentInteractions).toHaveBeenCalledWith({
      workspaceId: "workspace",
      taskId: "task-a",
    });
    expect(result.current.requests).toEqual([pending]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores decisions the provider did not offer", async () => {
    const gateway = feedGateway();
    gateway.record(listing(A, 1, [pending]));
    const { result } = renderApprovals({ gateway, owner: A, running: false });
    await settleFeed();
    await act(() => result.current.answer(pending.id, "allowForSession"));
    expect(gateway.answerApproval).not.toHaveBeenCalled();
    expect(result.current.answering).toBeNull();
  });

  it("ignores stale, duplicate, reordered and foreign pushes", async () => {
    const gateway = feedGateway();
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    act(() => gateway.push(listing(A, 5, [pending])));
    const listed = result.current.requests;
    act(() => {
      gateway.push(listing(A, 5, [next]));
      gateway.push(listing(A, 4, [next]));
      gateway.push(listing(A, 0, []));
      gateway.push(listing(owner("task-a", "elsewhere"), 9, [next]));
      gateway.push(listing(owner("task-b"), 9, [approval("task-b", "foreign")]));
    });
    expect(result.current.requests).toBe(listed);
    act(() => {
      gateway.push(listing(A, 7, [next]));
      gateway.push(listing(A, 6, [pending]));
    });
    expect(result.current.requests).toEqual([next]);
  });

  it("drops a late read from the previous owner after switching threads and back", async () => {
    const late = deferred<AgentInteractionSnapshot>();
    const gateway = feedGateway();
    const B = owner("task-b");
    gateway.currentInteractions.mockImplementationOnce(() => late.promise);
    gateway.record(listing(A, 2, [pending]));
    gateway.record(listing(B, 1, [approval("task-b")]));
    const { result, rerender } = renderApprovals({ gateway, owner: A, running: false });
    await settleFeed();
    rerender({ gateway, owner: B, running: false });
    await settleFeed();
    expect(result.current.requests[0]?.taskId).toBe("task-b");
    act(() => gateway.push(listing(A, 8, [next])));
    expect(result.current.requests.map((request) => request.taskId)).toEqual(["task-b"]);
    rerender({ gateway, owner: A, running: false });
    expect(result.current.requests).toEqual([]);
    await settleFeed();
    expect(result.current.requests).toEqual([pending]);
    await act(async () => {
      late.resolve(listing(A, 99, [approval("task-a", "stale")]));
      await late.promise;
    });
    expect(result.current.requests).toEqual([pending]);
    expect(gateway.subscribers()).toBe(1);
  });

  it("isolates the same task id across workspaces A B A", async () => {
    const gateway = feedGateway();
    const elsewhere = owner("task-a", "workspace-b");
    gateway.record(listing(A, 2, [pending]));
    const { result, rerender } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([pending]);
    rerender({ gateway, owner: elsewhere, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([]);
    act(() => gateway.publish(listing(A, 3, [pending, next])));
    expect(result.current.requests).toEqual([]);
    rerender({ gateway, owner: A, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([pending, next]);
  });

  it("surfaces a failed decision for retry and stays inactive for remote owners", async () => {
    const gateway = feedGateway();
    gateway.answerApproval.mockRejectedValue(new Error("expired"));
    gateway.record(listing(A, 1, [pending]));
    const { result, rerender } = renderApprovals({ gateway, owner: A, running: false });
    await settleFeed();
    await act(async () => {
      await expect(result.current.answer(pending.id, "deny")).rejects.toThrow("expired");
    });
    expect(result.current.error).toBe(
      "The decision could not be confirmed. It may have expired; retry to check.",
    );
    expect(result.current.requests[0]?.status).toBe("pending");
    rerender({ gateway, owner: REMOTE, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(gateway.subscribers()).toBe(0);
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
  });

  it.each<{ readonly name: string; readonly props: Props }>([
    { name: "a remote owner", props: { gateway: feedGateway(), owner: REMOTE, running: true } },
    { name: "no gateway", props: { gateway: null, owner: A, running: true } },
    {
      name: "a gateway that is not an interaction feed",
      props: { gateway: { answerApproval: vi.fn() }, owner: A, running: true },
    },
  ])("keeps the same empty requests across renders for $name", async ({ props }) => {
    const { result, rerender, errors } = renderApprovals(props);
    const first = result.current.requests;
    await settleFeed();
    rerender(props);
    expect(first).toEqual([]);
    expect(result.current.requests).toBe(first);
    expect(new Set(errors)).toEqual(new Set([null]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing after an unmount during a pending read", async () => {
    const read = deferred<AgentInteractionSnapshot>();
    const gateway = feedGateway();
    gateway.currentInteractions.mockImplementationOnce(() => read.promise);
    const { errors, unmount } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    const renders = errors.length;
    unmount();
    await act(async () => {
      read.reject(new Error("offline"));
      await read.promise.catch(() => undefined);
    });
    act(() => gateway.push(listing(A, 4, [pending])));
    await elapse(60_000);
    expect(errors).toHaveLength(renders);
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<{ readonly name: string; failing(feed: AgentInteractionFeed): Mock }>([
    { name: "read", failing: (feed) => vi.mocked(feed.currentInteractions) },
    { name: "subscription", failing: (feed) => vi.mocked(feed.subscribeInteractions) },
  ])("never shows a notice when a $name fails once and the retry succeeds", async ({ failing }) => {
    const gateway = feedGateway();
    gateway.record(listing(A, 1, [pending]));
    failing(gateway).mockRejectedValueOnce(new Error("unavailable"));
    const { result, errors } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    expect(result.current.requests).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    await elapse(AGENT_INTERACTION_RETRY_BASE_MS);
    expect(result.current.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(new Set(errors)).toEqual(new Set([null]));
  });
  it.each<{ readonly name: string; failing(feed: AgentInteractionFeed): Mock }>([
    { name: "read", failing: (feed) => vi.mocked(feed.currentInteractions) },
    { name: "subscription", failing: (feed) => vi.mocked(feed.subscribeInteractions) },
  ])(
    "states calmly that approvals are unavailable once the $name keeps failing and recovers without a remount",
    async ({ failing }) => {
      const gateway = feedGateway();
      gateway.record(listing(A, 1, [pending]));
      for (let failure = 1; failure <= FAILURE_NOTICE_THRESHOLD; failure += 1)
        failing(gateway).mockRejectedValueOnce(new Error("unavailable"));
      const { result, errors } = renderApprovals({ gateway, owner: A, running: true });
      await settleFeed();
      for (let failure = 1; failure < FAILURE_NOTICE_THRESHOLD; failure += 1) {
        expect(result.current.error).toBeNull();
        await elapse(AGENT_INTERACTION_RETRY_BASE_MS * 2 ** (failure - 1));
      }
      expect(result.current.error).toBe(UNAVAILABLE_NOTICE);
      expect(result.current.requests).toEqual([]);
      await elapse(AGENT_INTERACTION_RETRY_BASE_MS * 2 ** (FAILURE_NOTICE_THRESHOLD - 1));
      expect(result.current.error).toBeNull();
      expect(result.current.requests).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(errors.some((error) => error?.includes("Reconnecting"))).toBe(false);
    },
  );
  it("keeps a confirmed decision over a stale pending push and yields to the real status", async () => {
    const gateway = feedGateway();
    gateway.answerApproval.mockResolvedValue(approved);
    gateway.record(listing(A, 4, [pending]));
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    await act(() => result.current.answer(pending.id, "allowOnce"));
    act(() => gateway.push(listing(A, 5, [pending, next])));
    expect(statuses(result.current.requests)).toEqual([
      ["approval-1", "approved"],
      ["approval-next", "pending"],
    ]);
    act(() => gateway.push(listing(A, 6, [{ ...pending, status: "timedOut" }, next])));
    expect(statuses(result.current.requests)).toEqual([
      ["approval-1", "timedOut"],
      ["approval-next", "pending"],
    ]);
  });

  it("keeps the decision in flight across a push and blocks a second decision meanwhile", async () => {
    const receipt = deferred<AgentApprovalRequest>();
    const gateway = feedGateway();
    gateway.answerApproval.mockReturnValueOnce(receipt.promise);
    gateway.record(listing(A, 4, [pending]));
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    let answer!: Promise<void>;
    act(() => {
      answer = result.current.answer(pending.id, "allowOnce");
    });
    expect(result.current.answering).toBe(pending.id);
    act(() => gateway.push(listing(A, 5, [pending, next])));
    expect(result.current.answering).toBe(pending.id);
    expect(result.current.requests).toEqual([pending, next]);
    await act(() => result.current.answer(next.id, "deny"));
    expect(gateway.answerApproval).toHaveBeenCalledTimes(1);
    await act(async () => {
      receipt.resolve(approved);
      await answer;
    });
    expect(result.current.answering).toBeNull();
    expect(statuses(result.current.requests)).toEqual([
      ["approval-1", "approved"],
      ["approval-next", "pending"],
    ]);
  });

  it("rejects a late decision settlement after the owner changes mid-flight", async () => {
    const receipt = deferred<AgentApprovalRequest>();
    const gateway = feedGateway();
    const B = owner("task-b");
    gateway.answerApproval.mockReturnValueOnce(receipt.promise);
    gateway.record(listing(A, 1, [pending]));
    gateway.record(listing(B, 1, [approval("task-b", pending.id)]));
    const { result, rerender } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    let answer!: Promise<void>;
    act(() => {
      answer = result.current.answer(pending.id, "allowOnce");
    });
    rerender({ gateway, owner: B, running: true });
    await settleFeed();
    await act(async () => {
      receipt.resolve(approved);
      await answer;
    });
    expect(result.current.requests).toEqual([approval("task-b", pending.id)]);
    expect(result.current.answering).toBeNull();
  });

  it("holds no timer and keeps the listed approvals while the turn starts and stops", async () => {
    const gateway = feedGateway();
    const { result, rerender } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    act(() => gateway.publish(listing(A, 1, [pending])));
    const listed = result.current.requests;
    rerender({ gateway, owner: A, running: false });
    rerender({ gateway, owner: A, running: true });
    await settleFeed();
    await elapse(60_000);
    expect(result.current.requests).toBe(listed);
    expect(gateway.subscribeInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the requests and the answer callback when a push changes only the questions", async () => {
    const gateway = feedGateway();
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    act(() => gateway.push(listing(A, 1, [pending])));
    const listed = result.current.requests;
    const answer = result.current.answer;
    act(() => gateway.push(listing(A, 2, [structuredClone(pending)], [question("task-a")])));
    act(() => gateway.push(listing(A, 3, [structuredClone(pending)])));
    expect(result.current.requests).toBe(listed);
    expect(result.current.answer).toBe(answer);
  });

  it.each<{ readonly name: string; readonly changed: AgentApprovalRequest }>([
    { name: "another status", changed: { ...pending, status: "expired" } },
    { name: "a decision", changed: approved },
    { name: "another detail", changed: { ...pending, detail: "npm run lint" } },
    { name: "another fact", changed: { ...pending, facts: [{ label: "cwd", value: "/repo" }] } },
    { name: "other decisions", changed: { ...pending, decisions: ["deny"] } },
  ])("publishes a push that lists $name", async ({ changed }) => {
    const gateway = feedGateway();
    const { result } = renderApprovals({ gateway, owner: A, running: true });
    await settleFeed();
    act(() => gateway.push(listing(A, 1, [pending])));
    const listed = result.current.requests;
    act(() => gateway.push(listing(A, 2, [changed])));
    expect(result.current.requests).not.toBe(listed);
    expect(result.current.requests).toEqual([changed]);
  });

  it("shares one subscription and one read with the questions of the same owner", async () => {
    const gateway = Object.assign(feedGateway(), {
      list: vi.fn<AgentQuestionGateway["list"]>(),
      answer: vi.fn<AgentQuestionGateway["answer"]>(),
    });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.createElement("div"));
    const seen = { approvals: 0, questions: 0 };
    function Composer() {
      seen.approvals = useAgentApprovals(gateway, A, true).requests.length;
      seen.questions = useAgentQuestions(gateway, A, true).requests.length;
      return null;
    }
    act(() => root.render(<Composer />));
    cleanups.push(() => act(() => root.unmount()));
    await settleFeed();
    act(() => gateway.publish(listing(A, 1, [pending, next], [question("task-a")])));
    expect(seen).toEqual({ approvals: 2, questions: 1 });
    expect(gateway.subscribeInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.subscribers()).toBe(1);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(gateway.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
