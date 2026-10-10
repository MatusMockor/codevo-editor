// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForReact as waitFor } from "../test/reactTestLifecycle";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import {
  AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD as FAILURE_THRESHOLD,
  AGENT_PENDING_REQUEST_POLL_MS as POLL_MS,
  type AgentPendingRequestAvailability,
} from "./agentPendingRequestPolling";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import { useAgentApprovals, type AgentApprovalsSurface } from "./useAgentApprovals";

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
  cleanups.push(() => act(() => root.unmount()));
  return { result, rerender, errors };
}

function owner(taskId: string): AgentApprovalOwner {
  return { kind: "local", workspaceId: "workspace", repositoryRoot: "/repo", taskId };
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settlePoll() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
}

function listingGateway(
  listApprovals: AgentApprovalGateway["listApprovals"],
): AgentApprovalGateway & { readonly listApprovals: ReturnType<typeof vi.fn> } {
  return { listApprovals: vi.fn(listApprovals), answerApproval: vi.fn() };
}

describe("useAgentApprovals", () => {
  it("lists pending approvals and publishes the confirmed decision", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi
        .fn()
        .mockResolvedValue({ ...pending, status: "approved", decision: "allowOnce" }),
    };
    const { result } = renderApprovals({ gateway, owner: owner("task-a"), running: false });
    await waitFor(() => expect(result.current.requests).toEqual([pending]));
    await act(() => result.current.answer(pending.id, "allowOnce"));
    expect(gateway.answerApproval).toHaveBeenCalledWith(owner("task-a"), pending.id, "allowOnce");
    expect(result.current.requests[0]?.status).toBe("approved");
    expect(result.current.answering).toBeNull();
  });

  it("ignores decisions the provider did not offer", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi.fn(),
    };
    const { result } = renderApprovals({ gateway, owner: owner("task-a"), running: false });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    await act(() => result.current.answer(pending.id, "allowForSession"));
    expect(gateway.answerApproval).not.toHaveBeenCalled();
  });

  it("drops a late list from the previous owner after switching threads", async () => {
    const late = deferred<readonly AgentApprovalRequest[]>();
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn((current: AgentApprovalOwner) =>
        current.taskId === "task-a" ? late.promise : Promise.resolve([approval("task-b")]),
      ),
      answerApproval: vi.fn(),
    };
    const { result, rerender } = renderApprovals({
      gateway,
      owner: owner("task-a"),
      running: false,
    });
    rerender({ gateway, owner: owner("task-b"), running: false });
    await waitFor(() => expect(result.current.requests[0]?.taskId).toBe("task-b"));
    await act(async () => {
      late.resolve([approval("task-a", "foreign")]);
      await late.promise;
    });
    expect(result.current.requests.map((request) => request.id)).toEqual(["approval-1"]);
    expect(result.current.requests[0]?.taskId).toBe("task-b");
  });

  it("surfaces a failed decision for retry and stays inactive for remote owners", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi.fn().mockRejectedValue(new Error("expired")),
    };
    const { result, rerender } = renderApprovals({
      gateway,
      owner: owner("task-a"),
      running: false,
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    await act(async () => {
      await expect(result.current.answer(pending.id, "deny")).rejects.toThrow("expired");
    });
    expect(result.current.error).toContain("could not be confirmed");
    rerender({
      gateway,
      owner: { kind: "remote", serverId: "server", runnerId: "runner", taskId: "task-a" },
      running: true,
    });
    expect(result.current.requests).toEqual([]);
    expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
  });

  it.each<{ readonly name: string; readonly props: Props }>([
    {
      name: "a remote owner",
      props: {
        gateway: listingGateway(() => Promise.resolve([])),
        owner: { kind: "remote", serverId: "server", runnerId: "runner", taskId: "task-a" },
        running: true,
      },
    },
    { name: "no gateway", props: { gateway: null, owner: owner("task-a"), running: true } },
  ])("keeps the same empty requests across renders for $name", ({ props }) => {
    const { result, rerender } = renderApprovals(props);
    const first = result.current.requests;
    rerender(props);
    expect(first).toEqual([]);
    expect(result.current.requests).toBe(first);
  });

  it("shows no error while a new turn's task is not registered yet and lists its approvals once it is", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const next = approval("task-next", "approval-next");
      const gateway = listingGateway(() => Promise.resolve([next]));
      gateway.listApprovals.mockResolvedValueOnce([pending]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        gateway.listApprovals.mockRejectedValueOnce(new Error("Agent task is unavailable."));
      const { result, rerender, errors } = renderApprovals({
        gateway,
        owner: owner("task-a"),
        running: false,
      });
      await settlePoll();
      expect(result.current.requests).toEqual([pending]);
      rerender({ gateway, owner: owner("task-next"), running: true });
      await settlePoll();
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
        expect(gateway.listApprovals).toHaveBeenCalledTimes(1 + failure);
        expect(gateway.listApprovals).toHaveBeenLastCalledWith(owner("task-next"));
        expect(result.current.requests).toEqual([]);
        await nextPoll();
      }
      expect(result.current.requests).toEqual([next]);
      expect(new Set(errors)).toEqual(new Set([null]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the failure streak after a successful poll", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const gateway = listingGateway(() => Promise.resolve([pending]));
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      gateway.listApprovals.mockResolvedValueOnce([pending]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      const polls = 2 * (FAILURE_THRESHOLD - 1) + 1;
      const { result, errors } = renderApprovals({
        gateway,
        owner: owner("task-a"),
        running: true,
      });
      await settlePoll();
      for (let poll = 1; poll < polls; poll += 1) await nextPoll();
      expect(gateway.listApprovals).toHaveBeenCalledTimes(polls);
      expect(result.current.requests).toEqual([pending]);
      expect(new Set(errors)).toEqual(new Set([null]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed refresh at once when the turn is not running and no later poll can recover", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const gateway = listingGateway(() => Promise.resolve([pending]));
      gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      const { result, rerender } = renderApprovals({
        gateway,
        owner: owner("task-a"),
        running: false,
      });
      await settlePoll();
      expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(result.current.error).toBe("Approvals could not be refreshed. Reconnecting…");
      expect(result.current.requests).toEqual([]);
      rerender({ gateway, owner: owner("task-a"), running: true });
      expect(result.current.error).toBeNull();
      await settlePoll();
      expect(result.current.requests).toEqual([pending]);
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows the reconnecting notice for one failed poll followed by a success", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const gateway = listingGateway(() => Promise.resolve([pending]));
      gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      const { result, errors } = renderApprovals({
        gateway,
        owner: owner("task-a"),
        running: true,
      });
      await settlePoll();
      expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
      expect(result.current.requests).toEqual([]);
      expect(result.current.error).toBeNull();
      await nextPoll();
      expect(result.current.requests).toEqual([pending]);
      expect(new Set(errors)).toEqual(new Set([null]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the reconnecting notice only after consecutive failed polls and clears it on success", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const gateway = listingGateway(() => Promise.resolve([pending]));
      gateway.listApprovals.mockResolvedValueOnce([pending]);
      for (let failure = 0; failure < FAILURE_THRESHOLD; failure += 1)
        gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      const { result } = renderApprovals({ gateway, owner: owner("task-a"), running: true });
      await settlePoll();
      expect(result.current.requests).toEqual([pending]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
        await nextPoll();
        expect(gateway.listApprovals).toHaveBeenCalledTimes(1 + failure);
        expect(result.current.error).toBeNull();
        expect(result.current.requests).toEqual([pending]);
      }
      await nextPoll();
      expect(result.current.error).toBe("Approvals could not be refreshed. Reconnecting…");
      expect(result.current.requests).toEqual([pending]);
      await nextPoll();
      expect(gateway.listApprovals).toHaveBeenCalledTimes(2 + FAILURE_THRESHOLD);
      expect(result.current.error).toBeNull();
      expect(result.current.requests).toEqual([pending]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a late rejection from a previous generation across A B A", async () => {
    vi.useFakeTimers();
    try {
      const pending = approval("task-a");
      const late = deferred<readonly AgentApprovalRequest[]>();
      const gateway = listingGateway(() => Promise.resolve([pending]));
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      gateway.listApprovals.mockImplementationOnce(() => late.promise);
      gateway.listApprovals.mockRejectedValueOnce(new Error("offline"));
      const { result, rerender, errors } = renderApprovals({
        gateway,
        owner: owner("task-a"),
        running: true,
      });
      await settlePoll();
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) await nextPoll();
      expect(gateway.listApprovals).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
      rerender({ gateway, owner: owner("task-b"), running: true });
      await settlePoll();
      expect(gateway.listApprovals).toHaveBeenLastCalledWith(owner("task-b"));
      expect(result.current.error).toBeNull();
      rerender({ gateway, owner: owner("task-a"), running: true });
      await settlePoll();
      expect(result.current.requests).toEqual([pending]);
      await act(async () => {
        late.reject(new Error("offline"));
        await late.promise.catch(() => undefined);
      });
      expect(result.current.requests).toEqual([pending]);
      expect(new Set(errors)).toEqual(new Set([null]));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useAgentApprovals availability", () => {
  const notice = "Approvals could not be refreshed. Reconnecting…";
  const pending = approval("task-a");
  const available = { owner: owner("task-a"), running: true } as const;
  const unreachable = { ...available, availability: "unreachable" } as const;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function freshlyListingGateway(listed: () => AgentApprovalRequest) {
    return listingGateway(() => Promise.resolve([structuredClone(listed())]));
  }

  async function polls(count: number) {
    for (let poll = 0; poll < count; poll += 1) await nextPoll();
  }

  it("asks the gateway nothing and holds no timer while unreachable", async () => {
    const gateway = listingGateway(() => Promise.resolve([pending]));
    const { result, errors } = renderApprovals({ gateway, ...unreachable });
    await polls(FAILURE_THRESHOLD + 2);
    expect(gateway.listApprovals).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.requests).toEqual([]);
    expect(new Set(errors)).toEqual(new Set([null]));
  });

  it("keeps the listed approvals while unreachable and polls at once on return", async () => {
    const next = approval("task-a", "approval-next");
    const gateway = listingGateway(() => Promise.resolve([pending]));
    const { result, rerender } = renderApprovals({ gateway, ...available });
    await settlePoll();
    const listed = result.current.requests;
    expect(listed).toEqual([pending]);
    rerender({ gateway, ...unreachable });
    await polls(FAILURE_THRESHOLD + 2);
    expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.requests).toBe(listed);
    gateway.listApprovals.mockResolvedValue([next]);
    rerender({ gateway, ...available });
    await settlePoll();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(2);
    expect(result.current.requests).toEqual([next]);
    await nextPoll();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(3);
  });

  it("hides the reconnecting notice once unreachable and starts a fresh failure streak on return", async () => {
    const gateway = listingGateway(() => Promise.reject(new Error("offline")));
    gateway.listApprovals.mockResolvedValueOnce([pending]);
    const { result, rerender } = renderApprovals({ gateway, ...available });
    await settlePoll();
    await polls(FAILURE_THRESHOLD);
    const listed = result.current.requests;
    expect(result.current.error).toBe(notice);
    rerender({ gateway, ...unreachable });
    expect(result.current.error).toBeNull();
    expect(result.current.requests).toBe(listed);
    rerender({ gateway, ...available });
    await settlePoll();
    await polls(FAILURE_THRESHOLD - 2);
    expect(result.current.error).toBeNull();
    await nextPoll();
    expect(result.current.error).toBe(notice);
    expect(result.current.requests).toBe(listed);
  });

  it("discards a poll that was in flight when the runner became unreachable", async () => {
    const late = deferred<readonly AgentApprovalRequest[]>();
    const gateway = listingGateway(() => late.promise);
    gateway.listApprovals.mockResolvedValueOnce([pending]);
    const { result, rerender } = renderApprovals({ gateway, ...available });
    await settlePoll();
    await nextPoll();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(2);
    rerender({ gateway, ...unreachable });
    await act(async () => {
      late.resolve([approval("task-a", "stale")]);
      await late.promise;
    });
    expect(result.current.requests).toEqual([pending]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs a single poll loop after the availability flaps", async () => {
    const late = deferred<readonly AgentApprovalRequest[]>();
    const gateway = listingGateway(() => Promise.resolve([pending]));
    gateway.listApprovals.mockImplementationOnce(() => late.promise);
    const { result, rerender } = renderApprovals({ gateway, ...available });
    rerender({ gateway, ...unreachable });
    rerender({ gateway, ...available });
    await settlePoll();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(2);
    expect(result.current.requests).toEqual([pending]);
    await act(async () => {
      late.resolve([approval("task-a", "stale")]);
      await late.promise;
    });
    expect(result.current.requests).toEqual([pending]);
    expect(vi.getTimerCount()).toBe(1);
    await nextPoll();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(3);
  });

  it("keeps the requests and the answer callback while polls list the same approvals", async () => {
    const gateway = freshlyListingGateway(() => pending);
    const { result } = renderApprovals({ gateway, ...available });
    await settlePoll();
    const listed = result.current.requests;
    const answer = result.current.answer;
    await polls(4);
    expect(gateway.listApprovals).toHaveBeenCalledTimes(5);
    expect(result.current.requests).toBe(listed);
    expect(result.current.answer).toBe(answer);
  });

  it.each<{ readonly name: string; readonly changed: AgentApprovalRequest }>([
    { name: "another status", changed: { ...pending, status: "expired" } },
    { name: "a decision", changed: { ...pending, status: "approved", decision: "allowOnce" } },
    { name: "another detail", changed: { ...pending, detail: "npm run lint" } },
    { name: "another fact", changed: { ...pending, facts: [{ label: "cwd", value: "/repo" }] } },
    { name: "other decisions", changed: { ...pending, decisions: ["deny"] } },
  ])("publishes a poll that lists $name", async ({ changed }) => {
    let current = pending;
    const gateway = freshlyListingGateway(() => current);
    const { result } = renderApprovals({ gateway, ...available });
    await settlePoll();
    const listed = result.current.requests;
    current = changed;
    await nextPoll();
    expect(result.current.requests).not.toBe(listed);
    expect(result.current.requests).toEqual([changed]);
  });

  it("leaves no timer when unmounted while unreachable", async () => {
    const gateway = listingGateway(() => Promise.resolve([pending]));
    const { rerender } = renderApprovals({ gateway, ...available });
    await settlePoll();
    rerender({ gateway, ...unreachable });
    cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(vi.getTimerCount()).toBe(0);
    await polls(2);
    expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
  });

  it("reports a decision that fails while unreachable and keeps it retryable without polling", async () => {
    const gateway = listingGateway(() => Promise.resolve([pending]));
    vi.mocked(gateway.answerApproval)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...pending, status: "denied", decision: "deny" });
    const { result, rerender } = renderApprovals({ gateway, ...available });
    await settlePoll();
    rerender({ gateway, ...unreachable });
    await act(async () => {
      await expect(result.current.answer(pending.id, "deny")).rejects.toThrow("offline");
    });
    expect(result.current.error).toBe(
      "The decision could not be confirmed. It may have expired; retry to check.",
    );
    expect(result.current.requests[0]?.status).toBe("pending");
    await act(() => result.current.answer(pending.id, "deny"));
    expect(result.current.requests[0]?.status).toBe("denied");
    expect(result.current.error).toBeNull();
    expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
