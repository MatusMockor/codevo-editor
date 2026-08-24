// @vitest-environment jsdom

import { act, createElement, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor, AgentProjectOrigin } from "../domain/agentProject";
import {
  AgentTaskStartRejectedError,
  type AgentCliKind,
  type AgentTaskGateway,
  type AgentTaskOutputEvent,
  type AgentTaskStatus,
  type AgentTaskStatusEvent,
  type StartAgentTaskRequest,
} from "../domain/agentTask";
import {
  createAgentOutputParserState,
  type AgentOutputParserState,
} from "../domain/agentOutput/agentOutputParser";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
} from "../domain/agentThread";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentTasksNotice, AgentThreadStoreSurface } from "./agentThreadPorts";
import type { AgentOutputParserPort } from "./agentTurnOutputStream";
import type { InPlacePreflight } from "./useAgentIsolationPreview";
import {
  useAgentTurnDispatch,
  type AgentTurnDispatchDependencies,
  type AgentTurnDispatchSurface,
} from "./useAgentTurnDispatch";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/other";
const OWNER_A = "workspace-a";
const OWNER_B = "workspace-b";
const CLI_PATH = "/usr/local/bin/claude";
const SESSION_ID = "sess-0001-abcd";

interface Environment {
  activeRoot: string;
  activeOwner: string;
  generation: number;
  origin: AgentProjectOrigin;
  cliPath: string | null;
  cliKind: AgentCliKind;
  maxConcurrent: number;
  worktreeMissing: boolean;
  leaseToken: number | null;
  preflight: InPlacePreflight;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("useAgentTurnDispatch startThread", () => {
  it("creates a worktree named by the thread id and starts the first turn without resume", async () => {
    const harness = renderDispatch();

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).not.toBeNull();
    const threadId = result?.threadId ?? "";
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledWith(ROOT_A, threadId);
    const started = harness.startedRequests[0];
    expect(started?.taskId).not.toBe(threadId);
    expect(started?.cwd).toBe(`${ROOT_A}/.worktrees/${threadId}`);
    expect(started?.resumeSessionId).toBeNull();
    expect(started?.workspaceId).toBe(OWNER_A);
    expect(started?.agentCliKind).toBe("claudeCode");
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledWith({
      taskId: started?.taskId,
      workspaceId: OWNER_A,
    });
    const thread = harness.thread(threadId);
    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0]?.turnId).toBe(started?.taskId);
    expect(thread.turns[0]?.status).toEqual({ kind: "pending" });
    expect(thread.target.worktreePath).toBe(`${ROOT_A}/.worktrees/${threadId}`);
    expect(thread.provider).toEqual({ kind: "claudeCode", sessionId: null });
    expect(thread.title).toBe("Fix the failing test");
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("starts an in-place thread in the repository root after the preflight passes", async () => {
    const harness = renderDispatch();

    const result = await act(() =>
      harness.hook().startThread(startRequest({ isolation: "in-place" })),
    );

    expect(result).not.toBeNull();
    expect(harness.preflightInPlace).toHaveBeenCalledTimes(1);
    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.startedRequests[0]?.cwd).toBe(ROOT_A);
    expect(harness.startedRequests[0]?.isolation).toBe("in-place");
    harness.unmount();
  });

  it("refuses an unsafe in-place start with the guard reasons", async () => {
    const harness = renderDispatch({
      preflight: { kind: "unsafe", label: "the working tree has uncommitted changes" },
    });

    const result = await act(() =>
      harness.hook().startThread(startRequest({ isolation: "in-place" })),
    );

    expect(result).toBeNull();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.notice()?.message).toContain("Running in place is unsafe");
    harness.unmount();
  });

  it("stops the task and retains the worktree when the owner changes after the start", async () => {
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      harness.environment.generation += 1;
      return { taskId: payload.taskId };
    });

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    const taskId = harness.startedRequests[0]?.taskId;
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({ taskId, workspaceId: OWNER_A });
    expect(harness.agent.acknowledgeAgentTaskStart).not.toHaveBeenCalled();
    expect(harness.retainUncertainWorktree).toHaveBeenCalledTimes(1);
    expect(harness.state().threads.size).toBe(0);
    harness.unmount();
  });

  it("discards a start that resolves after an A -> B -> A workspace round trip", async () => {
    const harness = renderDispatch();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    let result: { threadId: string } | null = null;
    await act(async () => {
      const dispatching = harness.hook().startThread(startRequest());
      for (let turn = 0; turn < 16 && harness.startedRequests.length === 0; turn += 1) {
        await Promise.resolve();
      }
      expect(harness.startedRequests).toHaveLength(1);
      harness.switchToProject(ROOT_B, OWNER_B);
      harness.switchToProject(ROOT_A, OWNER_A);
      pendingStart.resolve({ taskId: harness.startedRequests[0]?.taskId ?? "" });
      result = await dispatching;
    });

    expect(result).toBeNull();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.state().threads.size).toBe(0);
    harness.unmount();
  });

  it("reports a definite backend rejection with its message and compensates the worktree", async () => {
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new AgentTaskStartRejectedError("Too many agent tasks are starting or running."),
    );

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(harness.notice()).toEqual({
      kind: "error",
      message: "Too many agent tasks are starting or running.",
      action: null,
    });
    expect(harness.retainUncertainWorktree).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledTimes(1);
    expect(harness.state().threads.size).toBe(0);
    harness.unmount();
  });

  it("keeps the uncertain notice and retains the worktree when the start failure is unclassified", async () => {
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("socket hung up"));

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(harness.notice()?.message).toContain("uncertain");
    expect(harness.retainUncertainWorktree).toHaveBeenCalledTimes(1);
    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses to start without a configured CLI and offers the settings action", async () => {
    const harness = renderDispatch({ cliPath: null });

    expect(await act(() => harness.hook().startThread(startRequest()))).toBeNull();

    expect(harness.notice()?.action).toBe("configure-agent-cli");
    harness.unmount();
  });
});

describe("useAgentTurnDispatch output stream", () => {
  it("captures the session id, batches chunks per frame, and flushes before the terminal status", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitOutput(turnId, 1, `session:${SESSION_ID}`);
      for (let sequence = 2; sequence <= 501; sequence += 1) {
        harness.emitOutput(turnId, sequence, "x");
      }
    });
    await waitForReact(() => expect(harness.turn(threadId, 0).lastOutputSequence).toBe(501));

    expect(harness.thread(threadId).provider.sessionId).toBe(SESSION_ID);
    expect(harness.actionsOf("turnEventsAppended").length).toBeLessThanOrEqual(8);
    expect(harness.parser.feed).toHaveBeenCalledTimes(501);
    expect(harness.turn(threadId, 0).events).toHaveLength(1);

    await act(async () => {
      harness.emitOutput(turnId, 502, "tail");
      harness.emitStatus(turnId, 2, { kind: "exited", exitCode: 0 });
    });

    const kinds = harness.actions.map((action) => action.kind);
    const terminalIndex = kinds.lastIndexOf("taskStatusEvent");
    expect(kinds[terminalIndex - 1]).toBe("turnEventsAppended");
    expect(harness.parser.finish).toHaveBeenCalledTimes(1);
    expect(harness.turn(threadId, 0).status).toEqual({ kind: "exited", exitCode: 0 });
    expect(harness.turn(threadId, 0).lastOutputSequence).toBe(502);
    expect(harness.onTurnTerminal).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("ignores late, duplicate, and foreign output once the turn is terminal", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitOutput(turnId, 1, "first");
      harness.emitOutput(turnId, 1, "duplicate");
      harness.emitOutput("agt-foreign-0000", 1, "foreign");
      harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 });
    });
    const feedsBeforeLate = harness.parser.feed.mock.calls.length;
    const appendsBeforeLate = harness.actionsOf("turnEventsAppended").length;

    await act(async () => {
      harness.emitOutput(turnId, 2, "late");
      harness.emitStatus(turnId, 2, { kind: "stopped" });
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(feedsBeforeLate).toBe(1);
    expect(harness.parser.feed).toHaveBeenCalledTimes(1);
    expect(harness.actionsOf("turnEventsAppended")).toHaveLength(appendsBeforeLate);
    expect(harness.turn(threadId, 0).status).toEqual({ kind: "exited", exitCode: 0 });
    expect(harness.turn(threadId, 0).events).toEqual([{ kind: "assistantText", text: "first" }]);
    harness.unmount();
  });

  it("does not treat a foreign owner's terminal status as the end of the stream", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 }, OWNER_B);
      harness.emitOutput(turnId, 1, "still live");
    });
    await waitForReact(() => expect(harness.turn(threadId, 0).lastOutputSequence).toBe(1));

    expect(harness.turn(threadId, 0).status).toEqual({ kind: "pending" });
    expect(harness.parser.finish).not.toHaveBeenCalled();
    harness.unmount();
  });
});

describe("useAgentTurnDispatch sendFollowUp", () => {
  it("resumes the captured session in the thread worktree with a new turn id", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const firstTurnId = harness.turnIdOf(threadId, 0);

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Continue" }))).toBe(
      true,
    );

    const followUp = harness.startedRequests[1];
    expect(followUp?.resumeSessionId).toBe(SESSION_ID);
    expect(followUp?.cwd).toBe(`${ROOT_A}/.worktrees/${threadId}`);
    expect(followUp?.taskId).not.toBe(firstTurnId);
    expect(followUp?.prompt).toBe("Continue");
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(1);
    expect(harness.thread(threadId).turns).toHaveLength(2);
    expect(harness.turn(threadId, 1).turnId).toBe(followUp?.taskId);
    expect(harness.actionsOf("turnStarted")).toHaveLength(1);
    harness.unmount();
  });

  it("allows only one running turn per thread", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Continue" }));

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Again" }))).toBe(false);

    expect(harness.notice()?.message).toContain("still running");
    expect(harness.startedRequests).toHaveLength(2);
    harness.unmount();
  });

  it("rejects a racing follow-up while the previous start is still in flight", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    const first = act(() => harness.hook().sendFollowUp({ threadId, prompt: "One" }));
    await waitForReact(() => expect(harness.startedRequests).toHaveLength(2));
    const second = await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Two" }));
    pendingStart.resolve({ taskId: harness.startedRequests[1]?.taskId ?? "" });

    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(harness.startedRequests).toHaveLength(2);
    harness.unmount();
  });

  it("registers the follow-up turn before the start resolves so archive, remove and release cannot orphan it", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    let result = false;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({ threadId, prompt: "Continue" });
      await harness.waitForStartedRequests(2);
      expect(harness.actionsOf("turnStarted")).toHaveLength(1);
      harness.dispatchAction({ kind: "archived", threadId });
      harness.dispatchAction({ kind: "deleted", threadId });
      harness.dispatchAction({ kind: "ownerReleased", ownerId: OWNER_A });
      pendingStart.resolve({ taskId: harness.startedRequests[1]?.taskId ?? "" });
      result = await sending;
    });

    expect(result).toBe(true);
    const thread = harness.thread(threadId);
    expect(thread.archived).toBe(false);
    expect(thread.turns).toHaveLength(2);
    expect(harness.turn(threadId, 1).status).toEqual({ kind: "pending" });
    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("stops the started process when the thread vanished during the start await", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    let result = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({ threadId, prompt: "Continue" });
      await harness.waitForStartedRequests(2);
      harness.dropThread(threadId);
      pendingStart.resolve({ taskId: harness.startedRequests[1]?.taskId ?? "" });
      result = await sending;
    });

    expect(result).toBe(false);
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[1]?.taskId,
      workspaceId: OWNER_A,
    });
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(1);
    expect(harness.state().threads.has(threadId)).toBe(false);
    harness.unmount();
  });

  it("ends the follow-up turn as failed with the backend message when the start is rejected", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new AgentTaskStartRejectedError(
        "An agent task is already running in this working directory.",
      ),
    );

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Continue" }))).toBe(
      false,
    );

    const turn = harness.turn(threadId, 1);
    expect(turn.status).toEqual({
      kind: "failed",
      message: "An agent task is already running in this working directory.",
    });
    expect(harness.notice()).toEqual({
      kind: "error",
      message: "An agent task is already running in this working directory.",
      action: null,
    });
    expect(harness.retainUncertainWorktree).not.toHaveBeenCalled();
    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Retry" }))).toBe(true);
    harness.unmount();
  });

  it("keeps the uncertain notice for a start failure the gateway could not classify", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("socket hung up"));

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Continue" }))).toBe(
      false,
    );

    expect(harness.turn(threadId, 1).status.kind).toBe("failed");
    expect(harness.notice()?.message).toContain("uncertain");
    harness.unmount();
  });

  it("blocks a follow-up on an archived thread", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    act(() => harness.dispatchAction({ kind: "archived", threadId }));

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "More" }))).toBe(false);

    expect(harness.notice()?.message).toContain("archived");
    harness.unmount();
  });

  it("blocks a follow-up when the thread's project owner is no longer current", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.switchToProject(ROOT_B, OWNER_B);

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "More" }))).toBe(false);

    expect(harness.notice()?.message).toContain("no longer open");
    expect(harness.startedRequests).toHaveLength(1);
    harness.unmount();
  });

  it("blocks a follow-up when the live task limit is reached", async () => {
    const harness = renderDispatch();
    const settled = await harness.settleThreadWithSession();
    await harness.startThread();
    harness.environment.maxConcurrent = 1;

    expect(await act(() => harness.hook().sendFollowUp({ threadId: settled, prompt: "x" }))).toBe(
      false,
    );

    expect(harness.notice()?.message).toContain("concurrent agent limit");
    harness.unmount();
  });

  it("blocks a follow-up when the CLI is no longer configured", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.environment.cliPath = null;

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "x" }))).toBe(false);

    expect(harness.notice()?.action).toBe("configure-agent-cli");
    harness.unmount();
  });

  it("blocks a follow-up when the configured provider differs from the thread provider", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.environment.cliKind = "codex";

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "x" }))).toBe(false);

    expect(harness.notice()?.message).toBe(
      "This thread was started with Claude Code; start a new thread.",
    );
    harness.unmount();
  });

  it("blocks a follow-up when no session id was captured", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    await act(async () => {
      harness.emitStatus(harness.turnIdOf(threadId, 0), 1, { kind: "exited", exitCode: 0 });
    });

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "x" }))).toBe(false);

    expect(harness.notice()?.message).toBe(
      "This thread has no resumable session; start a new thread.",
    );
    harness.unmount();
  });

  it("blocks a follow-up when the worktree is missing", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.environment.worktreeMissing = true;

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "x" }))).toBe(false);

    expect(harness.notice()?.message).toBe("The worktree for this thread no longer exists.");
    harness.unmount();
  });

  it("warns once when a resumed turn exits non-zero without a session or result", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Continue" }));

    await act(async () => {
      harness.emitStatus(harness.turnIdOf(threadId, 1), 1, { kind: "exited", exitCode: 2 });
    });

    expect(harness.notice()?.message).toContain("rejected the resume request");
    harness.unmount();
  });
});

describe("useAgentTurnDispatch stop and project release", () => {
  it("stops the running turn of a thread", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();

    await act(() => harness.hook().stop(threadId));

    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.turnIdOf(threadId, 0),
      workspaceId: OWNER_A,
    });
    harness.unmount();
  });

  it("reports live threads per owner and stops every repository root of that owner", async () => {
    const harness = renderDispatch();
    await harness.startThread();

    expect(harness.hook().hasLiveTasksForOwner(OWNER_A)).toBe(true);
    expect(harness.hook().hasLiveTasksForOwner(OWNER_B)).toBe(false);
    await act(() => harness.hook().stopProjectTasks(OWNER_A, ["/elsewhere"]));

    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: OWNER_A,
      repositoryRoot: "/elsewhere",
    });
    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: OWNER_A,
      repositoryRoot: ROOT_A,
    });
    harness.unmount();
  });
});

function startRequest(
  overrides: Partial<Parameters<AgentTurnDispatchSurface["startThread"]>[0]> = {},
) {
  return {
    projectRootKey: ROOT_A,
    repositoryRoot: ROOT_A,
    prompt: "Fix the failing test",
    isolation: "worktree" as const,
    unsafeInPlaceConfirmationKey: null,
    ...overrides,
  };
}

function repository(repositoryRoot: string): ResolvedGitRepository {
  return {
    mapping: { rootRelativePath: "" },
    repositoryRoot,
    repositoryRelativePath: "",
  };
}

function fakeParser(): AgentOutputParserPort & {
  readonly feed: ReturnType<typeof vi.fn>;
  readonly finish: ReturnType<typeof vi.fn>;
} {
  const create = (kind: AgentCliKind): AgentOutputParserState => createAgentOutputParserState(kind);
  const feed = vi.fn(
    (state: AgentOutputParserState, _stream: "stdout" | "stderr", chunk: string) =>
      chunk.startsWith("session:")
        ? { state, events: [], sessionId: chunk.slice("session:".length) }
        : { state, events: [{ kind: "assistantText" as const, text: chunk }], sessionId: null },
  );
  const finish = vi.fn((state: AgentOutputParserState) => ({ state, events: [], sessionId: null }));
  return { create, feed, finish };
}

function renderDispatch(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    activeRoot: ROOT_A,
    activeOwner: OWNER_A,
    generation: 1,
    origin: "active-tab",
    cliPath: CLI_PATH,
    cliKind: "claudeCode",
    maxConcurrent: 4,
    worktreeMissing: false,
    leaseToken: 1,
    preflight: { kind: "ok" },
    ...overrides,
  };
  const startedRequests: StartAgentTaskRequest[] = [];
  const actions: AgentThreadsAction[] = [];
  const notices: Array<AgentTasksNotice | null> = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;
  let outputHandler: ((event: AgentTaskOutputEvent) => void) | null = null;
  let entropy = 0;

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      startedRequests.push(payload);
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (handler: (event: AgentTaskStatusEvent) => void) => {
      statusHandler = handler;
      return () => undefined;
    }),
    subscribeAgentTaskOutput: vi.fn(async (handler: (event: AgentTaskOutputEvent) => void) => {
      outputHandler = handler;
      return () => undefined;
    }),
  };
  const worktree = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, threadId: string) => ({
      worktreePath: `${repositoryRoot}/.worktrees/${threadId}`,
      branch: `agent/${threadId}`,
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };
  const parser = fakeParser();
  const preflightInPlace = vi.fn(async (): Promise<InPlacePreflight> => environment.preflight);
  const retainUncertainWorktree = vi.fn();
  const onTurnTerminal = vi.fn();
  const reportError = vi.fn();

  const project = (): AgentProjectDescriptor => ({
    rootKey: environment.activeRoot,
    rootPath: environment.activeRoot,
    ownerId: environment.activeOwner,
    label: "app",
    generation: environment.generation,
    trust: "trusted",
    origin: environment.origin,
    repositories: [repository(environment.activeRoot)],
    isolationPolicy: "auto",
    leaseToken: environment.leaseToken,
  });

  let current: AgentTurnDispatchSurface | null = null;
  let latestState: AgentThreadsState = emptyAgentThreadsState();
  let shadowState: AgentThreadsState = latestState;
  let dispatchAction: (action: HarnessAction) => void = () => undefined;

  function Harness() {
    const [state, dispatch] = useReducer(harnessReducer, undefined, emptyAgentThreadsState);
    latestState = state;
    shadowState = state;
    const store = useMemo<AgentThreadStoreSurface>(
      () => ({
        state,
        loadedRootKeys: new Set([ROOT_A]),
        currentState: () => shadowState,
        dispatchAction: (action) => {
          actions.push(action);
          shadowState = harnessReducer(shadowState, action);
          dispatch(action);
        },
        togglePin: () => undefined,
        archive: () => undefined,
        remove: () => undefined,
      }),
      [state],
    );
    dispatchAction = (action) => {
      shadowState = harnessReducer(shadowState, action);
      dispatch(action);
    };
    const dependencies: AgentTurnDispatchDependencies = {
      agentTaskGateway: agent as unknown as AgentTaskGateway,
      gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
      get projects() {
        return [project()];
      },
      store,
      getAgentCliPath: () => environment.cliPath,
      getAgentCliKind: () => environment.cliKind,
      getMaxConcurrentAgentTasks: () => environment.maxConcurrent,
      preflightInPlace,
      isWorktreeMissing: () => environment.worktreeMissing,
      retainUncertainWorktree,
      onTurnTerminal,
      reportError,
      setNotice: (notice) => notices.push(notice),
      outputParser: parser,
      now: () => 1_700_000_000_000 + entropy,
      createEntropyHex4: () => {
        entropy += 1;
        return entropy.toString(16).padStart(4, "0");
      },
    };
    current = useAgentTurnDispatch(dependencies);
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));

  const harness = {
    agent,
    worktree,
    parser,
    preflightInPlace,
    retainUncertainWorktree,
    onTurnTerminal,
    startedRequests,
    actions,
    environment,
    hook(): AgentTurnDispatchSurface {
      expect(current).not.toBeNull();
      return current as AgentTurnDispatchSurface;
    },
    state(): AgentThreadsState {
      return latestState;
    },
    thread(threadId: string): AgentThread {
      const thread = latestState.threads.get(threadId);
      expect(thread).toBeDefined();
      return thread as AgentThread;
    },
    turn(threadId: string, index: number) {
      const turn = harness.thread(threadId).turns[index];
      expect(turn).toBeDefined();
      return turn as NonNullable<typeof turn>;
    },
    turnIdOf(threadId: string, index: number): string {
      return harness.turn(threadId, index).turnId;
    },
    notice(): AgentTasksNotice | null {
      return notices[notices.length - 1] ?? null;
    },
    actionsOf(kind: AgentThreadsAction["kind"]): AgentThreadsAction[] {
      return actions.filter((action) => action.kind === kind);
    },
    dispatchAction(action: AgentThreadsAction): void {
      dispatchAction(action);
    },
    dropThread(threadId: string): void {
      dispatchAction({ kind: "harnessDropThread", threadId });
    },
    async waitForStartedRequests(count: number): Promise<void> {
      for (let round = 0; round < 32 && startedRequests.length < count; round += 1) {
        await Promise.resolve();
      }
      expect(startedRequests).toHaveLength(count);
    },
    emitStatus(
      taskId: string,
      sequence: number,
      status: AgentTaskStatus,
      workspaceId: string = OWNER_A,
    ): void {
      expect(statusHandler).not.toBeNull();
      statusHandler?.({
        taskId,
        workspaceId,
        repositoryRoot: ROOT_A,
        isolation: "worktree",
        worktreePath: `${ROOT_A}/.worktrees/${threadIdForTurn(latestState, taskId)}`,
        sequence,
        status,
      });
    },
    emitOutput(taskId: string, sequence: number, chunk: string): void {
      expect(outputHandler).not.toBeNull();
      outputHandler?.({ taskId, sequence, stream: "stdout", chunk, truncated: false });
    },
    switchToProject(rootKey: string, ownerId: string): void {
      environment.activeRoot = rootKey;
      environment.activeOwner = ownerId;
      environment.generation += 1;
    },
    async startThread(): Promise<string> {
      const result = await act(() => harness.hook().startThread(startRequest()));
      expect(result).not.toBeNull();
      return result?.threadId ?? "";
    },
    async settleThreadWithSession(): Promise<string> {
      const threadId = await harness.startThread();
      const turnId = harness.turnIdOf(threadId, 0);
      await act(async () => {
        harness.emitOutput(turnId, 1, `session:${SESSION_ID}`);
        harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 });
      });
      await waitForReact(() =>
        expect(harness.thread(threadId).provider.sessionId).toBe(SESSION_ID),
      );
      return threadId;
    },
    rerender(): void {
      act(() => root.render(createElement(Harness)));
    },
    unmount(): void {
      act(() => root.unmount());
      host.remove();
    },
  };
  return harness;
}

type HarnessAction =
  AgentThreadsAction | { readonly kind: "harnessDropThread"; readonly threadId: string };

function harnessReducer(state: AgentThreadsState, action: HarnessAction): AgentThreadsState {
  if (action.kind !== "harnessDropThread") return agentThreadsReducer(state, action);
  const threads = new Map(state.threads);
  threads.delete(action.threadId);
  return { threads };
}

function threadIdForTurn(state: AgentThreadsState, turnId: string): string {
  for (const thread of state.threads.values()) {
    if (thread.turns.some((turn) => turn.turnId === turnId)) return thread.threadId;
  }
  return "unknown";
}
