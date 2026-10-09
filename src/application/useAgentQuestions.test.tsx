// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";
import { waitForReact } from "../test/reactTestLifecycle";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
const waitFor = waitForReact;
function renderHook<P, R>(hook: (props: P) => R, options?: { initialProps: P }) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const result = {} as { current: R };
  function Harness({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  let mounted = true;
  function rerender(props: P) {
    act(() => root.render(<Harness props={props} />));
  }
  function unmount() {
    if (mounted) {
      mounted = false;
      act(() => root.unmount());
    }
  }
  cleanups.push(unmount);
  rerender(options?.initialProps as P);
  return { result, rerender, unmount };
}
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
import {
  AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD as FAILURE_THRESHOLD,
  AGENT_PENDING_REQUEST_POLL_MS as POLL_MS,
  type AgentPendingRequestAvailability,
} from "./agentPendingRequestPolling";
import { useAgentQuestions } from "./useAgentQuestions";
const owner: AgentQuestionOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/project",
  taskId: "task",
};
const question: AgentQuestionRequest = {
  id: "question",
  taskId: "task",
  provider: "codex",
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
const response = { answers: [{ questionId: "q", optionIds: ["a"], text: "" }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, fail) => {
    resolve = r;
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
interface ObservedProps {
  target: AgentQuestionOwner;
  running: boolean;
  availability?: AgentPendingRequestAvailability;
}
function renderObservedQuestions(port: AgentQuestionGateway, initialProps: ObservedProps) {
  const errors: (string | null)[] = [];
  const rendered = renderHook(
    ({ target, running, availability }: ObservedProps) => {
      const surface = useAgentQuestions(port, target, running, availability);
      errors.push(surface.error);
      return surface;
    },
    { initialProps },
  );
  return { ...rendered, errors };
}
function gateway(): AgentQuestionGateway {
  return {
    list: vi.fn().mockResolvedValue([question]),
    answer: vi
      .fn()
      .mockResolvedValue({ ...question, status: "answered", answers: response.answers }),
  };
}
describe("useAgentQuestions", () => {
  it("recovers a pending question and answers it without starting another prompt", async () => {
    const port = gateway();
    const { result } = renderHook(() => useAgentQuestions(port, owner, false));
    await waitFor(() => expect(result.current.requests).toEqual([question]));
    await act(() => result.current.answer(question.id, response));
    expect(port.answer).toHaveBeenCalledWith(owner, question.id, response);
    expect(result.current.requests[0].status).toBe("answered");
  });
  it("discards late A responses across A B A and suppresses stale callbacks", async () => {
    const first = deferred<readonly AgentQuestionRequest[]>();
    const port = gateway();
    vi.mocked(port.list).mockImplementationOnce(() => first.promise);
    const { result, rerender } = renderHook(
      ({ target }) => useAgentQuestions(port, target, false),
      { initialProps: { target: owner } },
    );
    rerender({ target: { ...owner, taskId: "other" } });
    rerender({ target: owner });
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    await act(async () => first.resolve([{ ...question, id: "stale" }]));
    expect(result.current.requests[0].id).toBe("question");
  });
  it("prevents duplicate submissions and rejects late answer settlement after selection changes", async () => {
    const pending = deferred<AgentQuestionRequest>();
    const port = gateway();
    vi.mocked(port.answer).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ target }) => useAgentQuestions(port, target, false),
      { initialProps: { target: owner as AgentQuestionOwner | null } },
    );
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    let answer!: Promise<void>;
    act(() => {
      answer = result.current.answer(question.id, response);
      void result.current.answer(question.id, response);
    });
    expect(port.answer).toHaveBeenCalledTimes(1);
    rerender({ target: null });
    await act(async () => {
      pending.resolve({ ...question, status: "answered", answers: response.answers });
      await answer;
    });
    expect(result.current.requests).toEqual([]);
  });
  it("keeps the same empty requests across renders without an owner", () => {
    const port = gateway();
    const { result, rerender } = renderHook(({ target }) => useAgentQuestions(port, target, true), {
      initialProps: { target: null as AgentQuestionOwner | null },
    });
    const first = result.current.requests;
    rerender({ target: null });
    expect(first).toEqual([]);
    expect(result.current.requests).toBe(first);
  });
  it("keeps unanswered data and exposes retry after an uncertain network result", async () => {
    const port = gateway();
    vi.mocked(port.answer).mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useAgentQuestions(port, owner, false));
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    await act(async () => {
      await expect(result.current.answer(question.id, response)).rejects.toThrow();
    });
    expect(result.current.requests[0].status).toBe("pending");
    expect(result.current.error).toContain("Retry");
    await act(() => result.current.answer(question.id, response));
    expect(result.current.requests[0].status).toBe("answered");
  });
  it("cleans polling on unmount and refreshes terminal state once", async () => {
    const port = gateway();
    const { result, rerender, unmount } = renderHook(
      ({ running }) => useAgentQuestions(port, owner, running),
      { initialProps: { running: true } },
    );
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    vi.mocked(port.list).mockResolvedValue([{ ...question, status: "cancelled" }]);
    rerender({ running: false });
    await waitFor(() => expect(result.current.requests[0].status).toBe("cancelled"));
    unmount();
    expect(port.list).toHaveBeenCalledTimes(2);
  });
  it("ignores an old poll settling after the answer receipt", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      const poll = deferred<readonly AgentQuestionRequest[]>();
      vi.mocked(port.list)
        .mockResolvedValueOnce([question])
        .mockImplementationOnce(() => poll.promise);
      const { result, unmount } = renderHook(() => useAgentQuestions(port, owner, true));
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(() => result.current.answer(question.id, response));
      await act(async () => poll.resolve([question]));
      expect(result.current.requests[0].status).toBe("answered");
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("invalidates previously captured submit callbacks after A B A", async () => {
    const port = gateway();
    const { result, rerender } = renderHook(
      ({ target }) => useAgentQuestions(port, target, false),
      { initialProps: { target: owner } },
    );
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    const obsolete = result.current.answer;
    rerender({ target: { ...owner, taskId: "other" } });
    rerender({ target: owner });
    await waitFor(() => expect(result.current.requests.length).toBe(1));
    await act(() => obsolete(question.id, response));
    expect(port.answer).not.toHaveBeenCalled();
  });
  it("never shows the reconnecting notice for one disconnected poll and recovers pending questions", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      vi.mocked(port.list).mockRejectedValueOnce(new Error("offline"));
      const { result, errors, unmount } = renderObservedQuestions(port, {
        target: owner,
        running: true,
      });
      await settlePoll();
      expect(port.list).toHaveBeenCalledTimes(1);
      expect(result.current.requests).toEqual([]);
      expect(result.current.error).toBeNull();
      await nextPoll();
      expect(result.current.requests).toEqual([question]);
      expect(new Set(errors)).toEqual(new Set([null]));
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows no error while a new turn's task is not registered yet and lists its questions once it is", async () => {
    vi.useFakeTimers();
    try {
      const nextTurn = { ...owner, taskId: "next-turn" };
      const nextQuestion = { ...question, id: "next-question", taskId: nextTurn.taskId };
      const port = gateway();
      const list = vi.mocked(port.list);
      list.mockResolvedValueOnce([question]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        list.mockRejectedValueOnce(new Error("Agent task is unavailable."));
      list.mockResolvedValue([nextQuestion]);
      const { result, rerender, errors, unmount } = renderObservedQuestions(port, {
        target: owner,
        running: false,
      });
      await settlePoll();
      expect(result.current.requests).toEqual([question]);
      rerender({ target: nextTurn, running: true });
      await settlePoll();
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
        expect(list).toHaveBeenCalledTimes(1 + failure);
        expect(list).toHaveBeenLastCalledWith(nextTurn);
        expect(result.current.requests).toEqual([]);
        await nextPoll();
      }
      expect(result.current.requests).toEqual([nextQuestion]);
      expect(new Set(errors)).toEqual(new Set([null]));
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("restarts the failure streak after a successful poll", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      const list = vi.mocked(port.list);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        list.mockRejectedValueOnce(new Error("offline"));
      list.mockResolvedValueOnce([question]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        list.mockRejectedValueOnce(new Error("offline"));
      const polls = 2 * (FAILURE_THRESHOLD - 1) + 1;
      const { result, errors, unmount } = renderObservedQuestions(port, {
        target: owner,
        running: true,
      });
      await settlePoll();
      for (let poll = 1; poll < polls; poll += 1) await nextPoll();
      expect(list).toHaveBeenCalledTimes(polls);
      expect(result.current.requests).toEqual([question]);
      expect(new Set(errors)).toEqual(new Set([null]));
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports a failed refresh at once when the turn is not running and no later poll can recover", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      const list = vi.mocked(port.list);
      list.mockRejectedValueOnce(new Error("offline"));
      const { result, rerender, unmount } = renderObservedQuestions(port, {
        target: owner,
        running: false,
      });
      await settlePoll();
      expect(list).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(result.current.error).toBe("Questions could not be refreshed. Reconnecting…");
      expect(result.current.requests).toEqual([]);
      rerender({ target: owner, running: true });
      expect(result.current.error).toBeNull();
      await settlePoll();
      expect(result.current.requests).toEqual([question]);
      expect(result.current.error).toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows the reconnecting notice only after consecutive failed polls and clears it on success", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      const list = vi.mocked(port.list);
      list.mockResolvedValueOnce([question]);
      for (let failure = 0; failure < FAILURE_THRESHOLD; failure += 1)
        list.mockRejectedValueOnce(new Error("offline"));
      const { result, unmount } = renderObservedQuestions(port, { target: owner, running: true });
      await settlePoll();
      expect(result.current.requests).toEqual([question]);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
        await nextPoll();
        expect(list).toHaveBeenCalledTimes(1 + failure);
        expect(result.current.error).toBeNull();
        expect(result.current.requests).toEqual([question]);
      }
      await nextPoll();
      expect(result.current.error).toBe("Questions could not be refreshed. Reconnecting…");
      expect(result.current.requests).toEqual([question]);
      await nextPoll();
      expect(list).toHaveBeenCalledTimes(2 + FAILURE_THRESHOLD);
      expect(result.current.error).toBeNull();
      expect(result.current.requests).toEqual([question]);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("drops a late rejection from a previous generation across A B A", async () => {
    vi.useFakeTimers();
    try {
      const late = deferred<readonly AgentQuestionRequest[]>();
      const port = gateway();
      const list = vi.mocked(port.list);
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
        list.mockRejectedValueOnce(new Error("offline"));
      list.mockImplementationOnce(() => late.promise);
      list.mockRejectedValueOnce(new Error("offline"));
      const other = { ...owner, taskId: "other" };
      const { result, rerender, errors, unmount } = renderObservedQuestions(port, {
        target: owner,
        running: true,
      });
      await settlePoll();
      for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) await nextPoll();
      expect(list).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
      rerender({ target: other, running: true });
      await settlePoll();
      expect(list).toHaveBeenLastCalledWith(other);
      expect(result.current.error).toBeNull();
      rerender({ target: owner, running: true });
      await settlePoll();
      expect(result.current.requests).toEqual([question]);
      await act(async () => {
        late.reject(new Error("offline"));
        await late.promise.catch(() => undefined);
      });
      expect(result.current.requests).toEqual([question]);
      expect(new Set(errors)).toEqual(new Set([null]));
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("useAgentQuestions availability", () => {
  const remoteOwner: AgentQuestionOwner = {
    kind: "remote",
    serverId: "linux",
    runnerId: "runner",
    taskId: "task",
  };
  const notice = "Questions could not be refreshed. Reconnecting…";
  const owners = [
    { name: "a local owner", target: owner },
    { name: "a remote owner", target: remoteOwner },
  ];
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  function freshlyListing(port: AgentQuestionGateway, listed: () => AgentQuestionRequest) {
    const list = vi.mocked(port.list);
    list.mockImplementation(() => Promise.resolve([structuredClone(listed())]));
    return list;
  }
  async function polls(count: number) {
    for (let poll = 0; poll < count; poll += 1) await nextPoll();
  }

  it.each(owners)(
    "asks the gateway nothing and holds no timer while unreachable for $name",
    async ({ target }) => {
      const port = gateway();
      const { result, errors } = renderObservedQuestions(port, {
        target,
        running: true,
        availability: "unreachable",
      });
      await polls(FAILURE_THRESHOLD + 2);
      expect(port.list).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(result.current.requests).toEqual([]);
      expect(new Set(errors)).toEqual(new Set([null]));
    },
  );
  it.each(owners)(
    "keeps the listed questions while unreachable and polls at once on return for $name",
    async ({ target }) => {
      const port = gateway();
      const list = vi.mocked(port.list);
      const next = { ...question, id: "next" };
      const { result, rerender } = renderObservedQuestions(port, { target, running: true });
      await settlePoll();
      const listed = result.current.requests;
      expect(listed).toEqual([question]);
      rerender({ target, running: true, availability: "unreachable" });
      await polls(FAILURE_THRESHOLD + 2);
      expect(list).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(result.current.requests).toBe(listed);
      list.mockResolvedValue([next]);
      rerender({ target, running: true, availability: "available" });
      await settlePoll();
      expect(list).toHaveBeenCalledTimes(2);
      expect(result.current.requests).toEqual([next]);
      await nextPoll();
      expect(list).toHaveBeenCalledTimes(3);
    },
  );
  it("hides the reconnecting notice once unreachable and starts a fresh failure streak on return", async () => {
    const port = gateway();
    const list = vi.mocked(port.list);
    list.mockResolvedValueOnce([question]);
    list.mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderObservedQuestions(port, { target: owner, running: true });
    await settlePoll();
    await polls(FAILURE_THRESHOLD);
    const listed = result.current.requests;
    expect(result.current.error).toBe(notice);
    rerender({ target: owner, running: true, availability: "unreachable" });
    expect(result.current.error).toBeNull();
    expect(result.current.requests).toBe(listed);
    rerender({ target: owner, running: true, availability: "available" });
    await settlePoll();
    await polls(FAILURE_THRESHOLD - 2);
    expect(result.current.error).toBeNull();
    await nextPoll();
    expect(result.current.error).toBe(notice);
    expect(result.current.requests).toBe(listed);
  });
  it("discards a poll that was in flight when the runner became unreachable", async () => {
    const late = deferred<readonly AgentQuestionRequest[]>();
    const port = gateway();
    const list = vi.mocked(port.list);
    list.mockResolvedValueOnce([question]).mockImplementationOnce(() => late.promise);
    const { result, rerender } = renderObservedQuestions(port, { target: owner, running: true });
    await settlePoll();
    await nextPoll();
    expect(list).toHaveBeenCalledTimes(2);
    rerender({ target: owner, running: true, availability: "unreachable" });
    await act(async () => {
      late.resolve([{ ...question, id: "stale" }]);
      await late.promise;
    });
    expect(result.current.requests).toEqual([question]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs a single poll loop after the availability flaps", async () => {
    const late = deferred<readonly AgentQuestionRequest[]>();
    const port = gateway();
    const list = vi.mocked(port.list);
    list.mockImplementationOnce(() => late.promise);
    const { result, rerender } = renderObservedQuestions(port, { target: owner, running: true });
    rerender({ target: owner, running: true, availability: "unreachable" });
    rerender({ target: owner, running: true, availability: "available" });
    await settlePoll();
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.requests).toEqual([question]);
    await act(async () => {
      late.resolve([{ ...question, id: "stale" }]);
      await late.promise;
    });
    expect(result.current.requests).toEqual([question]);
    expect(vi.getTimerCount()).toBe(1);
    await nextPoll();
    expect(list).toHaveBeenCalledTimes(3);
  });
  it("keeps the requests and the answer callback while polls list the same questions", async () => {
    const port = gateway();
    const list = freshlyListing(port, () => question);
    const { result } = renderObservedQuestions(port, { target: owner, running: true });
    await settlePoll();
    const listed = result.current.requests;
    const answer = result.current.answer;
    await polls(4);
    expect(list).toHaveBeenCalledTimes(5);
    expect(result.current.requests).toBe(listed);
    expect(result.current.answer).toBe(answer);
  });
  it.each<{ readonly name: string; readonly changed: AgentQuestionRequest }>([
    { name: "another status", changed: { ...question, status: "cancelled" } },
    {
      name: "another prompt",
      changed: { ...question, questions: [{ ...question.questions[0], prompt: "Which one?" }] },
    },
    {
      name: "another option label",
      changed: {
        ...question,
        questions: [
          { ...question.questions[0], options: [{ id: "a", label: "B", description: "" }] },
        ],
      },
    },
    {
      name: "an answer",
      changed: { ...question, status: "answered", answers: response.answers },
    },
  ])("publishes a poll that lists $name", async ({ changed }) => {
    const port = gateway();
    let current: AgentQuestionRequest = question;
    freshlyListing(port, () => current);
    const { result } = renderObservedQuestions(port, { target: owner, running: true });
    await settlePoll();
    const listed = result.current.requests;
    current = changed;
    await nextPoll();
    expect(result.current.requests).not.toBe(listed);
    expect(result.current.requests).toEqual([changed]);
  });
  it("leaves no timer when unmounted while unreachable", async () => {
    const port = gateway();
    const { rerender, unmount } = renderObservedQuestions(port, { target: owner, running: true });
    await settlePoll();
    rerender({ target: owner, running: true, availability: "unreachable" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await polls(2);
    expect(port.list).toHaveBeenCalledTimes(1);
  });
  it("reports an answer that fails while unreachable and keeps it retryable without polling", async () => {
    const port = gateway();
    vi.mocked(port.answer).mockRejectedValueOnce(new Error("The runner is unreachable."));
    const { result, rerender } = renderObservedQuestions(port, {
      target: remoteOwner,
      running: true,
    });
    await settlePoll();
    rerender({ target: remoteOwner, running: true, availability: "unreachable" });
    await act(async () => {
      await expect(result.current.answer(question.id, response)).rejects.toThrow("unreachable");
    });
    expect(result.current.error).toBe(
      "The answer could not be confirmed. Retry to safely check or send it.",
    );
    expect(result.current.requests[0].status).toBe("pending");
    await act(() => result.current.answer(question.id, response));
    expect(result.current.requests[0].status).toBe("answered");
    expect(result.current.error).toBeNull();
    expect(port.list).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
