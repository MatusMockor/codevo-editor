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
import { describe, expect, it, vi } from "vitest";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
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
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
  it("recovers pending questions after a disconnected poll", async () => {
    vi.useFakeTimers();
    try {
      const port = gateway();
      vi.mocked(port.list).mockRejectedValueOnce(new Error("offline"));
      const { result, unmount } = renderHook(() => useAgentQuestions(port, owner, true));
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.error).toContain("Reconnecting");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.requests).toEqual([question]);
      expect(result.current.error).toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
