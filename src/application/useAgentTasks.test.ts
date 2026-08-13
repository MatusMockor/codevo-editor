// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProjectDescriptor,
  AgentProjectOrigin,
  AgentProjectTrust,
} from "../domain/agentProject";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentTaskGateway,
  type AgentTaskOutputEvent,
  type AgentTaskStatusEvent,
  type StartAgentTaskRequest,
} from "../domain/agentTask";
import type { AgentIsolationPolicy } from "../domain/agentSettings";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../domain/git";
import type {
  AgentWorktreeReceipt,
  GitWorktreeDescriptor,
  GitWorktreeGateway,
} from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  MAX_AGENT_TASK_CHANGE_ROWS,
  MAX_AGENT_TASK_DIFF_SIDE_BYTES,
  useAgentTasks,
  type AgentRepositoryStatusSnapshot,
  type AgentTasksDependencies,
  type AgentTasksSurface,
} from "./useAgentTasks";

const WORKSPACE_ROOT = "/workspace/app";
const PRIMARY_ROOT = "/workspace/app";
const NESTED_ROOT = "/workspace/app/packages/api";
const WORKTREE_PATH = "/workspace/app/.worktrees/agt-1";
const CLI_PATH = "/usr/local/bin/claude";

interface Environment {
  present: boolean;
  generation: number;
  ownerId: string;
  workspaceRoot: string;
  trust: AgentProjectTrust;
  origin: AgentProjectOrigin;
  repositories: ReadonlyArray<ResolvedGitRepository>;
  extraProjects: ReadonlyArray<AgentProjectDescriptor>;
  worktrees: ReadonlyArray<GitWorktreeDescriptor>;
  cliPath: string | null;
  cliKind: AgentCliKind;
  maxConcurrent: number;
  policy: AgentIsolationPolicy;
  status: AgentRepositoryStatusSnapshot;
  dirtyEditors: number;
  confirmResult: boolean;
  leaseToken: number | null;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createRejectableDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useAgentTasks dispatch", () => {
  it("starts an in-place task in the repository root and acknowledges it", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).not.toBeNull();
    });

    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    const started = harness.startedRequests[0];
    expect(started?.cwd).toBe(PRIMARY_ROOT);
    expect(started?.isolation).toBe("in-place");
    expect(started?.agentCliPath).toBe(CLI_PATH);
    expect(started?.agentCliKind).toBe("claudeCode");
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(1);
    expect(harness.hook().tasks).toHaveLength(1);
    expect(harness.hook().tasks[0]?.record.status).toEqual({ kind: "pending" });
    expect(harness.hook().tasks[0]?.record.worktreePath).toBeNull();
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("refreshes the exact repository status immediately before an in-place start", async () => {
    const harness = renderAgentTasks({ status: { known: false, dirty: false } });
    const order: string[] = [];
    harness.git.getStatus.mockImplementationOnce(async (rootPath: string) => {
      order.push(`status:${rootPath}`);
      return { branch: "main", changes: [], isRepository: true, rootPath };
    });
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      order.push("start");
      harness.startedRequests.push(payload);
      return { taskId: payload.taskId };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).not.toBeNull();
    });

    expect(order).toEqual([`status:${PRIMARY_ROOT}`, "start"]);
    harness.unmount();
  });

  it("fails closed when the authoritative status refresh fails before in-place start", async () => {
    const harness = renderAgentTasks();
    harness.git.getStatus.mockRejectedValueOnce(new Error("status unavailable"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("could not be refreshed");
    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    harness.unmount();
  });

  it("drops a late preflight rejection after the project is released without reporting into it", async () => {
    const harness = renderAgentTasks({ leaseToken: 7 });
    const pending = createRejectableDeferred<GitStatus>();
    harness.git.getStatus.mockImplementationOnce(() => pending.promise);
    let dispatched!: ReturnType<AgentTasksSurface["dispatch"]>;

    act(() => {
      dispatched = harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    harness.environment.present = false;
    harness.rerender();
    await act(async () => {
      pending.reject(new Error("late A failure"));
      expect(await dispatched).toBeNull();
    });

    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("drops an A preflight after a per-root release and re-add generation cycle", async () => {
    const harness = renderAgentTasks({ leaseToken: 7 });
    const pending = createDeferred<GitStatus>();
    harness.git.getStatus.mockImplementationOnce(() => pending.promise);
    let dispatched!: ReturnType<AgentTasksSurface["dispatch"]>;

    act(() => {
      dispatched = harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    harness.environment.present = false;
    harness.rerender();
    harness.environment.present = true;
    harness.environment.generation += 1;
    harness.rerender();
    await act(async () => {
      pending.resolve({ branch: "main", changes: [], isRepository: true, rootPath: PRIMARY_ROOT });
      expect(await dispatched).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it.each(["released", "re-added"] as const)(
    "does not report a late worktree creation rejection into a %s project",
    async (returnState) => {
      const harness = renderAgentTasks({ leaseToken: 7 });
      const pending = createRejectableDeferred<AgentWorktreeReceipt>();
      harness.worktree.addAgentWorktree.mockImplementationOnce(() => pending.promise);
      let dispatched!: ReturnType<AgentTasksSurface["dispatch"]>;
      act(() => {
        dispatched = harness.hook().dispatch(request({ isolation: "worktree" }));
      });
      harness.environment.present = false;
      harness.rerender();
      if (returnState === "re-added") {
        harness.environment.present = true;
        harness.environment.generation += 1;
        harness.rerender();
      }
      await act(async () => {
        pending.reject(new Error("late add failure"));
        expect(await dispatched).toBeNull();
      });
      expect(harness.reportError).not.toHaveBeenCalled();
      expect(harness.hook().notice).toBeNull();
      harness.unmount();
    },
  );

  it("does not report late start or acknowledgement rejection into a replaced project generation", async () => {
    const startHarness = renderAgentTasks();
    const pendingStart = createRejectableDeferred<{ taskId: string }>();
    startHarness.agent.startAgentTask.mockImplementationOnce(() => pendingStart.promise);
    let startDispatch!: ReturnType<AgentTasksSurface["dispatch"]>;
    act(() => {
      startDispatch = startHarness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {});
    startHarness.environment.generation += 1;
    startHarness.rerender();
    await act(async () => {
      pendingStart.reject(new Error("late start failure"));
      expect(await startDispatch).toBeNull();
    });
    expect(startHarness.reportError).not.toHaveBeenCalled();
    startHarness.unmount();

    const ackHarness = renderAgentTasks();
    const pendingAck = createRejectableDeferred<void>();
    ackHarness.agent.acknowledgeAgentTaskStart.mockImplementationOnce(() => pendingAck.promise);
    let ackDispatch!: ReturnType<AgentTasksSurface["dispatch"]>;
    act(() => {
      ackDispatch = ackHarness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {});
    ackHarness.environment.generation += 1;
    ackHarness.rerender();
    await act(async () => {
      pendingAck.reject(new Error("late ack failure"));
      expect(await ackDispatch).toBeNull();
    });
    expect(ackHarness.reportError).not.toHaveBeenCalled();
    ackHarness.unmount();
  });

  it("does not treat a null confirmation as approval for an unknown fresh status", async () => {
    const harness = renderAgentTasks({ status: { known: false, dirty: false } });

    await act(async () => {
      expect(
        await harness.hook().dispatch({
          ...request({ isolation: "in-place" }),
          unsafeInPlaceConfirmationKey: null,
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("repository status is unknown");
    harness.unmount();
  });

  it("creates a worktree and starts an isolated task inside it", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).not.toBeNull();
    });

    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(1);
    expect(harness.startedRequests[0]?.cwd).toBe(WORKTREE_PATH);
    expect(harness.hook().tasks[0]?.record.worktreePath).toBe(WORKTREE_PATH);
    expect(harness.hook().tasks[0]?.record.isolation).toBe("worktree");
    harness.unmount();
  });

  it("orders the dispatch as worktree, start, acknowledge", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });

    expect(harness.calls).toEqual([
      "addAgentWorktree",
      "startAgentTask",
      "acknowledgeAgentTaskStart",
    ]);
    harness.unmount();
  });

  it("refuses to dispatch above the concurrent agent limit", async () => {
    const harness = renderAgentTasks({ maxConcurrent: 1 });

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.hook().notice?.message).toContain("concurrent agent limit");
    harness.unmount();
  });

  it("refuses to dispatch without a configured agent CLI and offers the settings action", async () => {
    const harness = renderAgentTasks({ cliPath: null });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.hook().agentCliConfigured).toBe(false);
    expect(harness.hook().notice?.action).toBe("configure-agent-cli");
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();

    act(() => harness.hook().configureAgentCli());

    expect(harness.openAgentSettings).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("refuses a repository outside the resolved workspace repositories", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      expect(
        await harness.hook().dispatch(request({ repositoryRoot: "/elsewhere/repo" })),
      ).toBeNull();
    });

    expect(harness.hook().notice?.message).toContain("Select a repository");
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses an empty prompt", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      expect(await harness.hook().dispatch(request({ prompt: "   \n  " }))).toBeNull();
    });

    expect(harness.hook().notice?.message).toContain("Write a prompt");
    harness.unmount();
  });

  it("refuses a prompt above the prompt byte cap", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      expect(
        await harness.hook().dispatch(request({ prompt: "é".repeat(MAX_AGENT_TASK_PROMPT_BYTES) })),
      ).toBeNull();
    });

    expect(harness.hook().notice?.message).toContain("too long");
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps a started task but warns when the acknowledgement fails", async () => {
    const harness = renderAgentTasks();
    harness.agent.acknowledgeAgentTaskStart.mockRejectedValueOnce(new Error("no listener"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).not.toBeNull();
    });

    expect(harness.hook().tasks).toHaveLength(1);
    expect(harness.hook().notice?.kind).toBe("warning");
    expect(harness.hook().notice?.message).toContain("live output");
    harness.unmount();
  });

  it("blocks an unsafe in-place dispatch until it is explicitly confirmed", async () => {
    const harness = renderAgentTasks({ status: { known: true, dirty: true }, dirtyEditors: 2 });

    await act(async () => {
      expect(await harness.hook().dispatch({ ...request({ isolation: "in-place" }) })).toBeNull();
    });

    expect(harness.hook().notice?.message).toContain("uncommitted changes");
    expect(harness.hook().notice?.message).toContain("unsaved editors");
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();

    const confirmationKey = harness.hook().isolationPreview(PRIMARY_ROOT).confirmationKey;
    expect(confirmationKey).not.toBeNull();
    await act(async () => {
      expect(
        await harness.hook().dispatch({
          ...request({ isolation: "in-place" }),
          unsafeInPlaceConfirmationKey: confirmationKey,
        }),
      ).not.toBeNull();
    });

    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("rejects a confirmation when the fresh repository safety snapshot changed", async () => {
    const harness = renderAgentTasks({ status: { known: true, dirty: true } });
    await act(async () => {
      await harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
    });
    const confirmationKey = harness.hook().isolationPreview(PRIMARY_ROOT).confirmationKey;
    expect(confirmationKey).not.toBeNull();
    harness.environment.dirtyEditors = 1;

    await act(async () => {
      expect(
        await harness.hook().dispatch({
          ...request({ isolation: "in-place" }),
          unsafeInPlaceConfirmationKey: confirmationKey,
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("unsaved editors");
    harness.unmount();
  });

  it("aborts and removes the worktree when the receipt is untrusted", async () => {
    const harness = renderAgentTasks({}, { trusted: false });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(
      PRIMARY_ROOT,
      WORKTREE_PATH,
      false,
    );
    expect(harness.hook().notice?.message).toContain("not trusted");
    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("reports a start failure as an error notice and retains no task", async () => {
    const harness = renderAgentTasks();
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("spawn refused"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    expect(harness.hook().notice?.kind).toBe("error");
    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("stops an unexpected backend task id but retains its worktree without terminal proof", async () => {
    const harness = renderAgentTasks();
    harness.agent.startAgentTask.mockResolvedValueOnce({ taskId: "foreign-task-id" });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    const requestedTaskId = harness.agent.startAgentTask.mock.calls[0]?.[0].taskId;
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: requestedTaskId,
      workspaceId: "workspace-a",
    });
    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("unexpected task id");
    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("uses the exact agent gateway that accepted start for mismatch cleanup", async () => {
    const harness = renderAgentTasks();
    const replacementStop = vi.fn(async () => undefined);
    const replacementGateway = { ...harness.agent, stopAgentTask: replacementStop };
    harness.agent.startAgentTask.mockImplementationOnce(async () => {
      Object.defineProperty(harness.dependencies, "agentTaskGateway", {
        configurable: true,
        value: replacementGateway as unknown as AgentTaskGateway,
      });
      return { taskId: "foreign-task-id" };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(replacementStop).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a dispatch whose project generation was replaced mid-flight and stops the started task", async () => {
    const harness = renderAgentTasks();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.environment.generation += 1;
      return { taskId: payload.taskId };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.agent.acknowledgeAgentTaskStart).not.toHaveBeenCalled();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("drops a worktree receipt whose repository left the workspace mid-flight", async () => {
    const harness = renderAgentTasks();
    harness.worktree.addAgentWorktree.mockImplementationOnce(async () => {
      harness.environment.repositories = [];
      return { worktreePath: WORKTREE_PATH, branch: "agent/agt-1", trusted: true };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(
      PRIMARY_ROOT,
      WORKTREE_PATH,
      false,
    );
    harness.unmount();
  });

  it("compensates a stale worktree receipt through the exact gateway that created it", async () => {
    const harness = renderAgentTasks();
    const creatingGateway = harness.worktree;
    const replacementRemove = vi.fn(async () => undefined);
    const replacementGateway = {
      ...creatingGateway,
      removeWorktree: replacementRemove,
    };
    creatingGateway.addAgentWorktree.mockImplementationOnce(async () => {
      harness.environment.repositories = [];
      Object.defineProperty(harness.dependencies, "gitWorktreeGateway", {
        configurable: true,
        value: replacementGateway as unknown as GitWorktreeGateway,
      });
      return {
        worktreePath: `${PRIMARY_ROOT}/.worktrees/exact-receipt`,
        branch: "agent/exact-receipt",
        trusted: true,
      };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(creatingGateway.removeWorktree).toHaveBeenCalledWith(
      PRIMARY_ROOT,
      `${PRIMARY_ROOT}/.worktrees/exact-receipt`,
      false,
    );
    expect(replacementRemove).not.toHaveBeenCalled();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not leak an uncertain stale-receipt cleanup into the current workspace", async () => {
    const harness = renderAgentTasks();
    harness.worktree.addAgentWorktree.mockImplementationOnce(async () => {
      harness.environment.repositories = [];
      return { worktreePath: WORKTREE_PATH, branch: "agent/agt-1", trusted: true };
    });
    harness.worktree.removeWorktree.mockRejectedValueOnce(new Error("cleanup response lost"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("hides live tasks of a removed project and re-adopts them with a working stop handle", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    expect(harness.hook().tasks).toHaveLength(1);
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    harness.environment.present = false;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(0));

    harness.environment.present = true;
    harness.environment.generation += 1;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(1));

    await act(async () => {
      await harness.hook().stop(taskId);
    });
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId,
      workspaceId: "workspace-a",
    });
    harness.unmount();
  });

  it("drops released terminal history and does not resurrect it when the root is re-added", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
    });

    act(() => harness.hook().releaseProjectTasks("workspace-a"));
    harness.environment.present = false;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(0));

    harness.environment.present = true;
    harness.environment.generation += 1;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(0));
    harness.unmount();
  });
});

describe("useAgentTasks lifecycle", () => {
  it("reduces status and output events into the dispatched task", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "running" }));
      harness.emitOutput({
        taskId,
        sequence: 1,
        stream: "stdout",
        chunk: "working",
        truncated: false,
      });
    });

    expect(harness.hook().tasks[0]?.record.status).toEqual({ kind: "running" });
    expect(harness.hook().tasks[0]?.record.outputTail).toBe("working");
    expect(harness.hook().tasks[0]?.terminal).toBe(false);

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 2, { kind: "exited", exitCode: 0 }));
    });

    expect(harness.hook().tasks[0]?.terminal).toBe(true);
    harness.unmount();
  });

  it("stops a live task and ignores stop for a terminal task", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    await act(async () => {
      await harness.hook().stop(taskId);
    });
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId,
      workspaceId: "workspace-a",
    });

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "stopped" }));
    });
    await act(async () => {
      await harness.hook().stop(taskId);
    });

    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("dismisses a task and its change summary", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    await act(async () => {
      harness.emitStatus(worktreeStatusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
      await harness.hook().showChanges(taskId);
    });
    expect(harness.hook().tasks[0]?.changeSummary).not.toBeNull();

    act(() => harness.hook().dismiss(taskId));

    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("unsubscribes from both agent event streams on unmount", async () => {
    const harness = renderAgentTasks();
    await waitForReact(() =>
      expect(harness.agent.subscribeAgentTaskStatus).toHaveBeenCalledTimes(1),
    );
    expect(harness.agent.subscribeAgentTaskOutput).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeStatus).not.toHaveBeenCalled();

    harness.unmount();

    expect(harness.unsubscribeStatus).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeOutput).toHaveBeenCalledTimes(1);
  });
});

describe("useAgentTasks change review", () => {
  it("bounds the change list and labels truncation", async () => {
    const harness = renderAgentTasks();
    harness.gitStatus = gitStatus(
      Array.from({ length: MAX_AGENT_TASK_CHANGE_ROWS + 7 }, (_unused, index) =>
        changedFile(`src/file-${index}.ts`),
      ),
    );

    const taskId = await dispatchTerminalWorktreeTask(harness);
    await act(async () => {
      await harness.hook().showChanges(taskId);
    });

    const summary = harness.hook().tasks[0]?.changeSummary;
    expect(summary?.files).toHaveLength(MAX_AGENT_TASK_CHANGE_ROWS);
    expect(summary?.truncated).toBe(true);
    expect(summary?.loading).toBe(false);
    expect(harness.git.getStatus).toHaveBeenCalledWith(WORKTREE_PATH);
    harness.unmount();
  });

  it("hides the change summary again", async () => {
    const harness = renderAgentTasks();
    const taskId = await dispatchTerminalWorktreeTask(harness);

    await act(async () => {
      await harness.hook().showChanges(taskId);
    });
    act(() => harness.hook().hideChanges(taskId));

    expect(harness.hook().tasks[0]?.changeSummary).toBeNull();
    harness.unmount();
  });

  it("bounds each side of a file diff and labels truncation", async () => {
    const harness = renderAgentTasks();
    harness.gitDiff = {
      change: changedFile("src/app.ts"),
      language: "typescript",
      originalContent: "a".repeat(MAX_AGENT_TASK_DIFF_SIDE_BYTES + 64),
      modifiedContent: "b",
      previewUnavailableReason: null,
    };
    const taskId = await dispatchTerminalWorktreeTask(harness);

    await act(async () => {
      await harness.hook().showChanges(taskId);
    });
    await act(async () => {
      await harness.hook().showFileDiff(taskId, changedFile("src/app.ts"));
    });

    const diff = harness.hook().tasks[0]?.changeSummary?.diff;
    expect(diff?.relativePath).toBe("src/app.ts");
    expect(diff?.original.truncated).toBe(true);
    expect(diff?.original.text).toHaveLength(MAX_AGENT_TASK_DIFF_SIDE_BYTES);
    expect(diff?.modified.truncated).toBe(false);
    expect(diff?.loading).toBe(false);

    act(() => harness.hook().hideFileDiff(taskId));

    expect(harness.hook().tasks[0]?.changeSummary?.diff).toBeNull();
    harness.unmount();
  });

  it("surfaces a change read failure without dropping the summary", async () => {
    const harness = renderAgentTasks();
    const taskId = await dispatchTerminalWorktreeTask(harness);
    harness.git.getStatus.mockRejectedValueOnce(new Error("git failed"));

    await act(async () => {
      await harness.hook().showChanges(taskId);
    });

    expect(harness.hook().tasks[0]?.changeSummary?.error).toContain("could not be read");
    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    harness.unmount();
  });

  it("clears the loading flag truthfully when the owner drops during a changes refresh", async () => {
    const harness = renderAgentTasks();
    const taskId = await dispatchTerminalWorktreeTask(harness);

    await act(async () => {
      const pending = harness.hook().showChanges(taskId);
      harness.environment.generation = 2;
      await pending;
    });

    expect(harness.hook().tasks[0]?.changeSummary?.loading).toBe(false);
    expect(harness.hook().tasks[0]?.changeSummary?.error).toContain("no longer owns");
    expect(harness.hook().tasks[0]?.changeSummary?.files).toHaveLength(0);
    harness.unmount();
  });

  it("clears the diff loading flag truthfully when the owner drops during a diff read", async () => {
    const harness = renderAgentTasks();
    const taskId = await dispatchTerminalWorktreeTask(harness);
    await act(async () => {
      await harness.hook().showChanges(taskId);
    });
    const change = harness.hook().tasks[0]?.changeSummary?.files[0];
    expect(change).toBeDefined();
    if (change === undefined) return;

    await act(async () => {
      const pending = harness.hook().showFileDiff(taskId, change);
      harness.environment.generation = 2;
      await pending;
    });

    const diff = harness.hook().tasks[0]?.changeSummary?.diff;
    expect(diff?.loading).toBe(false);
    expect(diff?.error).toContain("no longer owns");
    harness.unmount();
  });

  it("refreshes an open change summary when the task reaches a terminal status", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    await act(async () => {
      await harness.hook().showChanges(taskId);
    });
    expect(harness.git.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      harness.emitStatus(worktreeStatusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
    });

    await waitForReact(() => expect(harness.git.getStatus).toHaveBeenCalledTimes(2));
    harness.unmount();
  });

  it("does not refresh a change summary that was never opened", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    await act(async () => {
      harness.emitStatus(worktreeStatusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
    });

    expect(harness.git.getStatus).not.toHaveBeenCalled();
    harness.unmount();
  });
});

describe("useAgentTasks worktree removal", () => {
  it("removes a clean worktree without forcing and without prompting", async () => {
    const harness = renderAgentTasks();
    harness.gitStatus = gitStatus([]);
    const taskId = await dispatchTerminalWorktreeTask(harness);

    await act(async () => {
      await harness.hook().removeWorktree(taskId);
    });

    expect(harness.confirm).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(
      PRIMARY_ROOT,
      WORKTREE_PATH,
      false,
    );
    expect(harness.hook().tasks[0]?.worktreeRemoved).toBe(true);
    harness.unmount();
  });

  it("forces removal of a dirty worktree only after confirmation", async () => {
    const harness = renderAgentTasks({ confirmResult: false });
    harness.gitStatus = gitStatus([changedFile("src/app.ts")]);
    const taskId = await dispatchTerminalWorktreeTask(harness);

    await act(async () => {
      await harness.hook().removeWorktree(taskId);
    });
    expect(harness.confirm).toHaveBeenCalledTimes(1);
    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    expect(harness.hook().tasks[0]?.worktreeRemoved).toBe(false);

    harness.environment.confirmResult = true;
    await act(async () => {
      await harness.hook().removeWorktree(taskId);
    });

    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(PRIMARY_ROOT, WORKTREE_PATH, true);
    expect(harness.hook().tasks[0]?.worktreeRemoved).toBe(true);
    harness.unmount();
  });

  it("refuses to remove the worktree of a live task", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    await act(async () => {
      await harness.hook().removeWorktree(taskId);
    });

    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("Stop the agent");
    harness.unmount();
  });

  it("reports a removal failure and clears the removing state", async () => {
    const harness = renderAgentTasks();
    harness.gitStatus = gitStatus([]);
    const taskId = await dispatchTerminalWorktreeTask(harness);
    harness.worktree.removeWorktree.mockRejectedValueOnce(new Error("locked"));

    await act(async () => {
      await harness.hook().showChanges(taskId);
    });
    await act(async () => {
      await harness.hook().removeWorktree(taskId);
    });

    expect(harness.hook().notice?.kind).toBe("error");
    expect(harness.hook().tasks[0]?.changeSummary?.removing).toBe(false);
    expect(harness.hook().tasks[0]?.worktreeRemoved).toBe(false);
    harness.unmount();
  });
});

describe("useAgentTasks orphaned worktrees", () => {
  it("derives orphans from listWorktrees and excludes primary, foreign, and task-owned paths", async () => {
    const orphanPath = `${PRIMARY_ROOT}/.worktrees/agt-orphan`;
    const harness = renderAgentTasks({
      worktrees: [
        worktreeDescriptor(PRIMARY_ROOT, { isPrimary: true, branch: "main" }),
        worktreeDescriptor(orphanPath, { branch: "agent/agt-orphan" }),
        worktreeDescriptor("/elsewhere/manual-worktree", { branch: "manual" }),
        worktreeDescriptor(WORKTREE_PATH, { branch: "agent/agt-1" }),
      ],
    });

    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(2));
    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "worktree" }));
    });

    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    const orphan = harness.hook().orphanedWorktrees[0];
    expect(orphan?.worktreePath).toBe(orphanPath);
    expect(orphan?.repositoryRoot).toBe(PRIMARY_ROOT);
    expect(orphan?.branch).toBe("agent/agt-orphan");
    expect(orphan?.prunable).toBe(false);
    harness.unmount();
  });

  it("shows a dismissed terminal worktree task as an orphan again", async () => {
    const harness = renderAgentTasks({
      worktrees: [worktreeDescriptor(WORKTREE_PATH, { branch: "agent/agt-1" })],
    });
    const taskId = await dispatchTerminalWorktreeTask(harness);
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(0));

    act(() => harness.hook().dismiss(taskId));

    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    expect(harness.hook().orphanedWorktrees[0]?.worktreePath).toBe(WORKTREE_PATH);
    harness.unmount();
  });

  it("removes a dirty orphaned worktree only after confirmation and refreshes the list", async () => {
    const orphanPath = `${PRIMARY_ROOT}/.worktrees/agt-orphan`;
    const harness = renderAgentTasks({
      worktrees: [worktreeDescriptor(orphanPath, { branch: "agent/agt-orphan" })],
    });
    harness.gitStatus = gitStatus([changedFile("src/app.ts")]);
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    const listCallsBeforeRemoval = harness.worktree.listWorktrees.mock.calls.length;

    await act(async () => {
      await harness.hook().removeOrphanedWorktree(orphanPath);
    });

    expect(harness.confirm).toHaveBeenCalledTimes(1);
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(PRIMARY_ROOT, orphanPath, true);
    expect(harness.hook().notice?.kind).toBe("info");
    expect(harness.worktree.listWorktrees.mock.calls.length).toBeGreaterThan(
      listCallsBeforeRemoval,
    );
    harness.unmount();
  });

  it("keeps a dirty orphan when the removal is not confirmed", async () => {
    const orphanPath = `${PRIMARY_ROOT}/.worktrees/agt-orphan`;
    const harness = renderAgentTasks({
      confirmResult: false,
      worktrees: [worktreeDescriptor(orphanPath, {})],
    });
    harness.gitStatus = gitStatus([changedFile("src/app.ts")]);
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));

    await act(async () => {
      await harness.hook().removeOrphanedWorktree(orphanPath);
    });

    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    expect(harness.hook().orphanedWorktrees[0]?.removing).toBe(false);
    harness.unmount();
  });

  it("prunes stale worktree registrations for a repository", async () => {
    const orphanPath = `${PRIMARY_ROOT}/.worktrees/agt-stale`;
    const harness = renderAgentTasks({
      worktrees: [worktreeDescriptor(orphanPath, { prunable: true })],
    });
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    expect(harness.hook().orphanedWorktrees[0]?.prunable).toBe(true);

    await act(async () => {
      await harness.hook().pruneOrphanedWorktrees(PRIMARY_ROOT);
    });

    expect(harness.worktree.pruneWorktrees).toHaveBeenCalledWith(PRIMARY_ROOT);
    expect(harness.hook().notice?.kind).toBe("info");
    harness.unmount();
  });

  it("retains the created worktree when the agent start settlement is uncertain", async () => {
    const harness = renderAgentTasks();
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("spawn refused"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("start result was uncertain");
    expect(harness.hook().tasks).toHaveLength(0);
    harness.unmount();
  });

  it("does not expose or prune an uncertain-start worktree as an ordinary orphan", async () => {
    const harness = renderAgentTasks({
      worktrees: [worktreeDescriptor(WORKTREE_PATH, { branch: "agent/agt-1" })],
    });
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("start response lost"));

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.hook().orphanedWorktrees).toHaveLength(0);
    await act(async () => {
      await harness.hook().pruneOrphanedWorktrees(PRIMARY_ROOT);
    });
    expect(harness.worktree.pruneWorktrees).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("terminal cleanup is proven");
    harness.unmount();
  });

  it("points at the orphan list when the repository worktree cap is reached", async () => {
    const harness = renderAgentTasks();
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(
      new Error("Repository already holds the maximum of 16 worktrees."),
    );

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "worktree" }))).toBeNull();
    });

    expect(harness.hook().notice?.message).toContain("maximum of 16 worktrees");
    expect(harness.hook().notice?.message).toContain("orphaned worktrees");
    harness.unmount();
  });
});

describe("useAgentTasks isolation preview", () => {
  it("refreshes an unknown preview to clean for the exact selected repository", async () => {
    const harness = renderAgentTasks({ status: { known: false, dirty: false } });
    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "status-unknown",
    });
    harness.environment.status = { known: true, dirty: false };

    await act(async () => {
      await harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
    });

    expect(harness.git.getStatus).toHaveBeenCalledWith(PRIMARY_ROOT);
    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({ kind: "in-place" });
    expect(harness.hook().isolationPreview(PRIMARY_ROOT).confirmationKey).not.toBeNull();
    harness.unmount();
  });

  it("publishes unknown and keeps in-place unsafe when preview refresh fails", async () => {
    const harness = renderAgentTasks();
    harness.git.getStatus.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
    });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "status-unknown",
    });
    expect(harness.hook().isolationPreview(PRIMARY_ROOT).confirmationKey).toBeNull();
    harness.unmount();
  });

  it("drops a reordered stale refresh for the same repository", async () => {
    const harness = renderAgentTasks({ status: { known: false, dirty: false } });
    const stale = createDeferred<GitStatus>();
    harness.git.getStatus
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath: PRIMARY_ROOT,
      });
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
      second = harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
    });
    await act(async () => {
      await second;
      stale.resolve({
        branch: "main",
        changes: [changedFile("src/stale.ts")],
        isRepository: true,
        rootPath: PRIMARY_ROOT,
      });
      await first;
    });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({ kind: "in-place" });
    harness.unmount();
  });

  it("does not let a pending preview overwrite a newer dispatch preflight", async () => {
    const harness = renderAgentTasks({ status: { known: true, dirty: false } });
    const stalePreview = createDeferred<GitStatus>();
    harness.git.getStatus
      .mockImplementationOnce(() => stalePreview.promise)
      .mockResolvedValueOnce({
        branch: "main",
        changes: [changedFile("src/fresh-dirty.ts")],
        isRepository: true,
        rootPath: PRIMARY_ROOT,
      });
    let preview!: Promise<void>;
    act(() => {
      preview = harness.hook().refreshIsolationStatus(PRIMARY_ROOT);
    });

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });
    await act(async () => {
      stalePreview.resolve({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath: PRIMARY_ROOT,
      });
      await preview;
    });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "dirty-tree",
    });
    harness.unmount();
  });

  it("recommends in-place for a clean repository with no live agents", () => {
    const harness = renderAgentTasks();

    const preview = harness.hook().isolationPreview(PRIMARY_ROOT);

    expect(preview.recommended).toEqual({ kind: "in-place" });
    expect(preview.inPlaceGuard).toEqual({ kind: "safe" });
    harness.unmount();
  });

  it("recommends a worktree once an agent is live in that repository", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "agent-active",
    });
    expect(harness.hook().isolationPreview(NESTED_ROOT).recommended).toEqual({ kind: "in-place" });
    harness.unmount();
  });

  it("recommends a worktree when the workspace policy demands it", () => {
    const harness = renderAgentTasks({ policy: "worktree" });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "policy",
    });
    harness.unmount();
  });

  it("reports an unknown repository status as an unsafe in-place reason", () => {
    const harness = renderAgentTasks({ status: { known: false, dirty: false } });

    expect(harness.hook().isolationPreview(PRIMARY_ROOT).inPlaceGuard).toEqual({
      kind: "unsafe",
      reasons: ["status-unknown"],
    });
    harness.unmount();
  });
});

describe("useAgentTasks multi-root projects", () => {
  const BACKGROUND_ROOT = "/workspace/api";
  const BACKGROUND_OWNER = "agent-root:api";

  function backgroundProject(
    overrides: Partial<AgentProjectDescriptor> = {},
  ): AgentProjectDescriptor {
    return {
      rootKey: BACKGROUND_ROOT,
      rootPath: BACKGROUND_ROOT,
      ownerId: BACKGROUND_OWNER,
      label: "api",
      generation: 1,
      trust: "trusted",
      origin: "background-tab",
      repositories: [repository(BACKGROUND_ROOT, "")],
      isolationPolicy: "auto",
      leaseToken: 7,
      ...overrides,
    };
  }

  function backgroundRequest(
    overrides: Partial<Parameters<AgentTasksSurface["dispatch"]>[0]> = {},
  ): Parameters<AgentTasksSurface["dispatch"]>[0] {
    return {
      projectRootKey: BACKGROUND_ROOT,
      repositoryRoot: BACKGROUND_ROOT,
      prompt: "Refactor the API",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
      ...overrides,
    };
  }

  it("dispatches into a background project without touching the active project", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(BACKGROUND_OWNER);
    expect(harness.startedRequests[0]?.repositoryRoot).toBe(BACKGROUND_ROOT);
    expect(harness.hook().tasks).toHaveLength(1);
    expect(harness.hook().tasks[0]?.repositoryLabel).toBe("api");
    expect(harness.environment.generation).toBe(1);
    expect(harness.hook().repositories.map((entry) => entry.repositoryRoot)).toContain(
      PRIMARY_ROOT,
    );
    harness.unmount();
  });

  it("keeps active and background tasks visible side by side", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {
      await harness.hook().dispatch(backgroundRequest());
    });

    expect(harness.hook().tasks).toHaveLength(2);
    const owners = harness.hook().tasks.map((task) => task.record.owner.workspaceId);
    expect(owners).toContain("workspace-a");
    expect(owners).toContain(BACKGROUND_OWNER);
    harness.unmount();
  });

  it("fails closed on in-place dispatch into a background project", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();

    await act(async () => {
      expect(
        await harness.hook().dispatch(backgroundRequest({ isolation: "in-place" })),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("active project");
    harness.unmount();
  });

  it("refuses dispatch into a project that is being released", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject({ origin: "closed-tab-live-tasks" })];
    harness.rerender();

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("released");
    harness.unmount();
  });

  it("acquires the missing project lease before starting a leaseless dispatch", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject({ leaseToken: null })];
    harness.rerender();

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).not.toBeNull();
    });

    expect(harness.ensureProjectLease).toHaveBeenCalledWith(BACKGROUND_ROOT);
    const leaseOrder = harness.ensureProjectLease.mock.invocationCallOrder[0] ?? Infinity;
    const startOrder = harness.agent.startAgentTask.mock.invocationCallOrder[0] ?? 0;
    expect(leaseOrder).toBeLessThan(startOrder);
    expect(harness.hook().tasks).toHaveLength(1);
    harness.unmount();
  });

  it("skips the lease preflight when the project already holds a lease", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).not.toBeNull();
    });

    expect(harness.ensureProjectLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses a leaseless dispatch fail-closed when the lease cannot be acquired", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject({ leaseToken: null })];
    harness.rerender();
    harness.ensureProjectLease.mockResolvedValueOnce(false);

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.kind).toBe("error");
    expect(harness.hook().notice?.message).toContain("could not be protected from tab close");
    harness.unmount();
  });

  it("refuses a leaseless dispatch when the lease acquisition itself fails", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject({ leaseToken: null })];
    harness.rerender();
    harness.ensureProjectLease.mockRejectedValueOnce(new Error("lease gateway down"));

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("could not be protected from tab close");
    harness.unmount();
  });

  it("previews worktree-only isolation for background repositories", async () => {
    const harness = renderAgentTasks({ status: { known: true, dirty: false } });
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();

    const preview = harness.hook().isolationPreview(BACKGROUND_ROOT);

    expect(preview.inPlaceAllowed).toBe(false);
    expect(preview.recommended.kind).toBe("worktree");
    expect(harness.hook().isolationPreview(PRIMARY_ROOT).inPlaceAllowed).toBe(true);
    harness.unmount();
  });

  it("drops a background dispatch when that project generation is replaced mid-flight", async () => {
    const harness = renderAgentTasks();
    harness.environment.extraProjects = [backgroundProject()];
    harness.rerender();
    harness.worktree.addAgentWorktree.mockImplementationOnce(async () => {
      harness.environment.extraProjects = [backgroundProject({ generation: 2 })];
      return { worktreePath: WORKTREE_PATH, branch: "agent/agt-1", trusted: true };
    });

    await act(async () => {
      expect(await harness.hook().dispatch(backgroundRequest())).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(
      BACKGROUND_ROOT,
      WORKTREE_PATH,
      false,
    );
    harness.unmount();
  });

  it("releases terminal tasks of an owner and retains its live tasks", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {
      await harness
        .hook()
        .dispatch(request({ isolation: "in-place", repositoryRoot: NESTED_ROOT }));
    });
    const terminalTaskId = harness.startedRequests[0]?.taskId ?? "";
    const liveTaskId = harness.startedRequests[1]?.taskId ?? "";
    await act(async () => {
      harness.emitStatus(statusEvent(terminalTaskId, 1, { kind: "exited", exitCode: 0 }));
    });
    expect(harness.hook().tasks).toHaveLength(2);

    act(() => harness.hook().releaseProjectTasks("workspace-a"));

    expect(harness.hook().tasks).toHaveLength(1);
    expect(harness.hook().tasks[0]?.record.owner.taskId).toBe(liveTaskId);
    expect(harness.hook().hasLiveTasksForOwner("workspace-a")).toBe(true);
    harness.unmount();
  });

  it("stops project tasks for the passed roots united with live task roots", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    await act(async () => {
      await harness.hook().stopProjectTasks("workspace-a", [NESTED_ROOT]);
    });

    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      repositoryRoot: NESTED_ROOT,
    });
    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      repositoryRoot: PRIMARY_ROOT,
    });
    harness.unmount();
  });

  it("reports whether an owner still holds live tasks", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    expect(harness.hook().hasLiveTasksForOwner("workspace-a")).toBe(true);
    expect(harness.hook().hasLiveTasksForOwner("someone-else")).toBe(false);

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "stopped" }));
    });

    expect(harness.hook().hasLiveTasksForOwner("workspace-a")).toBe(false);
    harness.unmount();
  });

  it("downgrades the project trust when the backend rejects an untrusted dispatch", async () => {
    const harness = renderAgentTasks();
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );

    await act(async () => {
      expect(await harness.hook().dispatch(request({ isolation: "in-place" }))).toBeNull();
    });

    expect(harness.onProjectDispatchTrustRejected).toHaveBeenCalledWith(WORKSPACE_ROOT);
    harness.unmount();
  });

  it("keeps failing closed on foreign, duplicate, and stale status events", async () => {
    const harness = renderAgentTasks();

    await act(async () => {
      await harness.hook().dispatch(request({ isolation: "in-place" }));
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";

    await act(async () => {
      harness.emitStatus({
        ...statusEvent(taskId, 1, { kind: "running" }),
        workspaceId: "intruder",
      });
    });
    expect(harness.hook().tasks[0]?.record.status).toEqual({ kind: "pending" });

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "running" }));
    });
    expect(harness.hook().tasks[0]?.record.status).toEqual({ kind: "running" });

    await act(async () => {
      harness.emitStatus(statusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
    });
    expect(harness.hook().tasks[0]?.record.status).toEqual({ kind: "running" });
    harness.unmount();
  });
});

async function dispatchTerminalWorktreeTask(
  harness: ReturnType<typeof renderAgentTasks>,
): Promise<string> {
  await act(async () => {
    await harness.hook().dispatch(request({ isolation: "worktree" }));
  });
  const taskId = harness.startedRequests[0]?.taskId ?? "";
  await act(async () => {
    harness.emitStatus(worktreeStatusEvent(taskId, 1, { kind: "exited", exitCode: 0 }));
  });
  return taskId;
}

function request(
  overrides: Partial<Parameters<AgentTasksSurface["dispatch"]>[0]> = {},
): Parameters<AgentTasksSurface["dispatch"]>[0] {
  return {
    projectRootKey: WORKSPACE_ROOT,
    repositoryRoot: PRIMARY_ROOT,
    prompt: "Refactor the parser",
    isolation: "worktree",
    unsafeInPlaceConfirmationKey: null,
    ...overrides,
  };
}

function statusEvent(
  taskId: string,
  sequence: number,
  status: AgentTaskStatusEvent["status"],
): AgentTaskStatusEvent {
  return {
    taskId,
    workspaceId: "workspace-a",
    repositoryRoot: PRIMARY_ROOT,
    isolation: "in-place",
    worktreePath: null,
    sequence,
    status,
  };
}

function worktreeStatusEvent(
  taskId: string,
  sequence: number,
  status: AgentTaskStatusEvent["status"],
): AgentTaskStatusEvent {
  return {
    ...statusEvent(taskId, sequence, status),
    isolation: "worktree",
    worktreePath: WORKTREE_PATH,
  };
}

function worktreeDescriptor(
  worktreePath: string,
  overrides: Partial<GitWorktreeDescriptor>,
): GitWorktreeDescriptor {
  return {
    worktreePath,
    branch: null,
    head: null,
    isPrimary: false,
    locked: false,
    prunable: false,
    ...overrides,
  };
}

function changedFile(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE_PATH}/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function gitStatus(changes: GitChangedFile[]): GitStatus {
  return { branch: "agent/agt-1", changes, isRepository: true, rootPath: WORKTREE_PATH };
}

function repository(repositoryRoot: string, rootRelativePath: string): ResolvedGitRepository {
  return {
    mapping: { rootRelativePath },
    repositoryRoot,
    repositoryRelativePath: "",
  };
}

function renderAgentTasks(
  overrides: Partial<Environment> = {},
  receiptOverrides: Partial<AgentWorktreeReceipt> = {},
) {
  const environment: Environment = {
    present: true,
    generation: 1,
    ownerId: "workspace-a",
    workspaceRoot: WORKSPACE_ROOT,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(PRIMARY_ROOT, ""), repository(NESTED_ROOT, "packages/api")],
    extraProjects: [],
    worktrees: [],
    cliPath: CLI_PATH,
    cliKind: "claudeCode",
    maxConcurrent: 4,
    policy: "auto",
    status: { known: true, dirty: false },
    dirtyEditors: 0,
    confirmResult: true,
    leaseToken: null,
    ...overrides,
  };

  const calls: string[] = [];
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;
  let outputHandler: ((event: AgentTaskOutputEvent) => void) | null = null;
  const unsubscribeStatus = vi.fn();
  const unsubscribeOutput = vi.fn();

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      calls.push("startAgentTask");
      startedRequests.push(payload);
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => {
      calls.push("acknowledgeAgentTaskStart");
    }),
    stopAgentTask: vi.fn(async () => {
      calls.push("stopAgentTask");
    }),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (handler: (event: AgentTaskStatusEvent) => void) => {
      statusHandler = handler;
      return unsubscribeStatus;
    }),
    subscribeAgentTaskOutput: vi.fn(async (handler: (event: AgentTaskOutputEvent) => void) => {
      outputHandler = handler;
      return unsubscribeOutput;
    }),
  };

  const worktree = {
    listWorktrees: vi.fn(
      async (): Promise<ReadonlyArray<GitWorktreeDescriptor>> => environment.worktrees,
    ),
    addAgentWorktree: vi.fn(async () => {
      calls.push("addAgentWorktree");
      return {
        worktreePath: WORKTREE_PATH,
        branch: "agent/agt-1",
        trusted: true,
        ...receiptOverrides,
      };
    }),
    removeWorktree: vi.fn(async () => {
      calls.push("removeWorktree");
    }),
    pruneWorktrees: vi.fn(async () => []),
  };

  const state = {
    gitStatus: gitStatus([changedFile("src/app.ts")]),
    gitDiff: {
      change: changedFile("src/app.ts"),
      language: "typescript",
      originalContent: "before",
      modifiedContent: "after",
      previewUnavailableReason: null,
    } as GitFileDiff,
  };

  const git = {
    getStatus: vi.fn(async (rootPath: string) => {
      if (rootPath !== PRIMARY_ROOT && rootPath !== NESTED_ROOT) return state.gitStatus;
      return {
        branch: "main",
        changes: environment.status.dirty ? [changedFile("src/dirty.ts")] : [],
        isRepository: environment.status.known,
        rootPath,
      } satisfies GitStatus;
    }),
    getDiff: vi.fn(async () => state.gitDiff),
  };

  const confirm = vi.fn(() => environment.confirmResult);
  const reportError = vi.fn();
  const openAgentSettings = vi.fn();
  const onProjectDispatchTrustRejected = vi.fn();
  const ensureProjectLease = vi.fn(async (): Promise<boolean> => true);
  let entropy = 0;

  const primaryProject = (): AgentProjectDescriptor => ({
    rootKey: environment.workspaceRoot,
    rootPath: environment.workspaceRoot,
    ownerId: environment.ownerId,
    label: "app",
    generation: environment.generation,
    trust: environment.trust,
    origin: environment.origin,
    repositories: environment.repositories,
    isolationPolicy: environment.policy,
    leaseToken: environment.leaseToken,
  });

  const dependencies: AgentTasksDependencies = {
    agentTaskGateway: agent as unknown as AgentTaskGateway,
    gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
    gitGateway: git,
    prompter: { confirm, prompt: () => null },
    get projects() {
      const primary = environment.present ? [primaryProject()] : [];
      return [...primary, ...environment.extraProjects];
    },
    getAgentCliPath: () => environment.cliPath,
    getAgentCliKind: () => environment.cliKind,
    getMaxConcurrentAgentTasks: () => environment.maxConcurrent,
    getRepositoryStatus: () => environment.status,
    getDirtyEditorDocumentCount: () => environment.dirtyEditors,
    onProjectDispatchTrustRejected,
    ensureProjectLease,
    reportError,
    openAgentSettings,
    now: () => 1_700_000_000_000 + entropy,
    createEntropyHex4: () => {
      entropy += 1;
      return entropy.toString(16).padStart(4, "0");
    },
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: AgentTasksSurface | null = null;

  function Harness() {
    current = useAgentTasks(dependencies);
    return null;
  }

  act(() => root.render(createElement(Harness)));

  return {
    agent,
    calls,
    confirm,
    dependencies,
    ensureProjectLease,
    environment,
    git,
    get gitStatus() {
      return state.gitStatus;
    },
    set gitStatus(next: GitStatus) {
      state.gitStatus = next;
    },
    get gitDiff() {
      return state.gitDiff;
    },
    set gitDiff(next: GitFileDiff) {
      state.gitDiff = next;
    },
    onProjectDispatchTrustRejected,
    openAgentSettings,
    reportError,
    startedRequests,
    unsubscribeOutput,
    unsubscribeStatus,
    worktree,
    emitStatus(event: AgentTaskStatusEvent) {
      expect(statusHandler).not.toBeNull();
      statusHandler?.(event);
    },
    emitOutput(event: AgentTaskOutputEvent) {
      expect(outputHandler).not.toBeNull();
      outputHandler?.(event);
    },
    hook(): AgentTasksSurface {
      expect(current).not.toBeNull();
      return current as AgentTasksSurface;
    },
    rerender() {
      act(() => root.render(createElement(Harness)));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
