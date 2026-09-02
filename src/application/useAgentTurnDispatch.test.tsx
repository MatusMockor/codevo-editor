// @vitest-environment jsdom

import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
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
import type {
  AgentTasksNotice,
  AgentThreadStartResult,
  AgentThreadStoreSurface,
} from "./agentThreadPorts";
import { AGENT_TASKS_SOURCE } from "./agentProjectAuthority";
import type { AgentOutputParserPort } from "./agentTurnOutputStream";
import type { InPlacePreflight } from "./useAgentIsolationPreview";
import {
  AGENT_PROVIDER_DISABLED_NOTICE,
  AGENT_PROVIDER_NOT_CONFIGURED_NOTICE,
  AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
  AGENT_PROVIDER_UNREGISTERED_NOTICE,
  AGENT_PROVIDER_UPDATING_NOTICE,
  type AgentProviderAdmissionAuthority,
  type AgentProviderAdmissionDisposition,
} from "./agentProviderAdmissionAuthority";
import {
  DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE,
  LAUNCH_PROVIDER_MISMATCH_NOTICE,
} from "./agentTurnAdmission";
import {
  useAgentTurnDispatch,
  type AgentTurnDispatchDependencies,
  type AgentTurnDispatchSurface,
} from "./useAgentTurnDispatch";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/other";
const OWNER_A = "workspace-a";
const OWNER_B = "workspace-b";
const SESSION_ID = "sess-0001-abcd";

interface Environment {
  activeRoot: string;
  repositoryRoot: string;
  firstRepositoryRoot: string | null;
  activeOwner: string;
  workspaceId: string;
  workspaceGeneration: number;
  generation: number;
  origin: AgentProjectOrigin;
  cliKind: AgentCliKind;
  providerRevision: Record<AgentCliKind, number>;
  providerGeneration: Record<AgentCliKind, number>;
  providerDisposition: Record<AgentCliKind, AgentProviderAdmissionDisposition>;
  maxConcurrent: number;
  worktreeMissing: boolean;
  leaseToken: number | null;
  ensureProjectLease: ((projectRootKey: string) => Promise<boolean>) | null;
  preflight: InPlacePreflight;
  currentCliVersion: Record<AgentCliKind, string | null>;
  outputSubscriptionGate: Promise<void> | null;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useAgentTurnDispatch startThread", () => {
  it("tracks the exact provider while a new turn is pending before publication", async () => {
    const lease = createDeferred<boolean>();
    const ensureProjectLease = vi.fn(async () => lease.promise);
    const harness = renderDispatch({
      cliKind: "claudeCode",
      leaseToken: null,
      ensureProjectLease,
      providerDisposition: {
        claudeCode: { kind: "disabled" },
        codex: { kind: "ready" },
      },
    });

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(
        startRequest({
          isolation: "in-place",
          launch: defaultAgentLaunchOptions("codex"),
        }),
      );
      await waitForReact(() => expect(ensureProjectLease).toHaveBeenCalledWith(ROOT_A));
      expect(harness.hook().pendingTurnCount("claudeCode")).toBe(0);
      expect(harness.hook().pendingTurnCount("codex")).toBe(1);
      expect(harness.state().threads.size).toBe(0);
      lease.resolve(true);
      result = await starting;
    });

    expect(result).not.toBeNull();
    expect(harness.hook().pendingTurnCount("codex")).toBe(0);
    harness.unmount();
  });

  it.each([
    ["disabled", { kind: "disabled" }, AGENT_PROVIDER_DISABLED_NOTICE],
    ["updating", { kind: "updating" }, AGENT_PROVIDER_UPDATING_NOTICE],
    [
      "unregistered",
      { kind: "policyUnavailable", reason: "unregistered" },
      AGENT_PROVIDER_UNREGISTERED_NOTICE,
    ],
    [
      "registration-failed",
      { kind: "policyUnavailable", reason: "registrationFailed" },
      AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
    ],
  ] as const)(
    "rejects a %s provider before starting a new thread",
    async (_label, disposition, message) => {
      const harness = renderDispatch({
        providerDisposition: {
          claudeCode: disposition,
          codex: { kind: "ready" },
        },
      });

      const result = await act(() => harness.hook().startThread(startRequest()));

      expect(result).toBeNull();
      expect(harness.notice()?.message).toBe(message);
      expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
      expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("rejects an A to B to A provider revision after project lease acquisition", async () => {
    const lease = createDeferred<boolean>();
    const ensureProjectLease = vi.fn(async () => lease.promise);
    const harness = renderDispatch({
      leaseToken: null,
      ensureProjectLease,
    });

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(startRequest({ isolation: "in-place" }));
      await waitForReact(() => expect(ensureProjectLease).toHaveBeenCalledWith(ROOT_A));
      replaceProviderAtoBtoA(harness.environment);
      lease.resolve(true);
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.preflightInPlace).not.toHaveBeenCalled();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("rejects an A to B to A provider revision after in-place preflight", async () => {
    const preflight = createDeferred<InPlacePreflight>();
    const harness = renderDispatch();
    harness.preflightInPlace.mockImplementationOnce(async () => preflight.promise);

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(startRequest({ isolation: "in-place" }));
      await waitForReact(() => expect(harness.preflightInPlace).toHaveBeenCalledTimes(1));
      replaceProviderAtoBtoA(harness.environment);
      preflight.resolve({ kind: "ok" });
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("compensates the exact worktree after an A to B to A provider revision", async () => {
    const worktree = createDeferred<{
      worktreePath: string;
      branch: string;
      trusted: boolean;
    }>();
    const harness = renderDispatch();
    harness.worktree.addAgentWorktree.mockImplementationOnce(async () => worktree.promise);

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(startRequest());
      await waitForReact(() => expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(1));
      replaceProviderAtoBtoA(harness.environment);
      worktree.resolve({
        worktreePath: `${ROOT_A}/.worktrees/provider-race`,
        branch: "agent/provider-race",
        trusted: true,
      });
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledWith(
      ROOT_A,
      `${ROOT_A}/.worktrees/provider-race`,
      false,
    );
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("compensates a worktree when provider authority changes before task start", async () => {
    const harness = renderDispatch();
    harness.onWorktreeCreated.mockImplementationOnce(() => {
      replaceProviderAtoBtoA(harness.environment);
    });

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledTimes(1);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("stops a started task after an A to B to A provider revision during start", async () => {
    const started = createDeferred<{ taskId: string }>();
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockImplementationOnce(async (request: StartAgentTaskRequest) => {
      harness.startedRequests.push(request);
      return started.promise;
    });

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(startRequest());
      await harness.waitForStartedRequests(1);
      replaceProviderAtoBtoA(harness.environment);
      started.resolve({ taskId: harness.startedRequests[0]?.taskId ?? "" });
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[0]?.taskId,
      workspaceId: OWNER_A,
    });
    expect(harness.retainUncertainWorktree).toHaveBeenCalledTimes(1);
    expect(harness.agent.acknowledgeAgentTaskStart).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("stops a started task after an A to B to A provider revision during acknowledgement", async () => {
    const acknowledged = createDeferred<undefined>();
    const harness = renderDispatch();
    harness.agent.acknowledgeAgentTaskStart.mockImplementationOnce(
      async () => acknowledged.promise,
    );

    let result: AgentThreadStartResult | null = null;
    await act(async () => {
      const starting = harness.hook().startThread(startRequest());
      await waitForReact(() =>
        expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(1),
      );
      expect(harness.hook().pendingTurnCount("claudeCode")).toBe(1);
      replaceProviderAtoBtoA(harness.environment);
      acknowledged.resolve(undefined);
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.retainUncertainWorktree).toHaveBeenCalledTimes(1);
    expect(harness.hook().pendingTurnCount("claudeCode")).toBe(0);
    harness.unmount();
  });

  it("revalidates the exact nested repository after acquiring a project lease", async () => {
    const nestedRepository = `${ROOT_A}/packages/api`;
    const pendingLease = createDeferred<boolean>();
    const ensureProjectLease = vi.fn(async () => pendingLease.promise);
    const harness = renderDispatch({
      repositoryRoot: nestedRepository,
      firstRepositoryRoot: ROOT_A,
      leaseToken: null,
      ensureProjectLease,
    });

    let result: unknown = "pending";
    await act(async () => {
      const starting = harness
        .hook()
        .startThread(startRequest({ repositoryRoot: nestedRepository, isolation: "in-place" }));
      await waitForReact(() => expect(ensureProjectLease).toHaveBeenCalledWith(ROOT_A));
      harness.environment.repositoryRoot = ROOT_B;
      pendingLease.resolve(true);
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("binds a nested repository launch to its exact project root", async () => {
    const nestedRepository = `${ROOT_A}/packages/api`;
    const harness = renderDispatch({ repositoryRoot: nestedRepository });

    const result = await act(() =>
      harness
        .hook()
        .startThread(startRequest({ repositoryRoot: nestedRepository, isolation: "in-place" })),
    );

    expect(result).not.toBeNull();
    expect(harness.startedRequests[0]).toMatchObject({
      workspaceId: OWNER_A,
      projectRoot: ROOT_A,
      repositoryRoot: nestedRepository,
      cwd: nestedRepository,
    });
    harness.unmount();
  });

  it("uses the current registered workspace while an earlier task owner remains frozen", async () => {
    const harness = renderDispatch({ workspaceId: OWNER_B });

    const result = await act(() =>
      harness.hook().startThread(startRequest({ isolation: "in-place" })),
    );

    expect(result).not.toBeNull();
    expect(harness.startedRequests[0]?.workspaceId).toBe(OWNER_B);
    expect(harness.thread(result?.threadId ?? "").owner.ownerId).toBe(OWNER_B);
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledWith({
      taskId: harness.startedRequests[0]?.taskId,
      workspaceId: OWNER_B,
    });
    harness.unmount();
  });

  it("stops a started task when the registered workspace changes during the start await", async () => {
    const pendingStart = createDeferred<{ taskId: string }>();
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockImplementationOnce(async (request: StartAgentTaskRequest) => {
      harness.startedRequests.push(request);
      return pendingStart.promise;
    });

    let result: unknown = "pending";
    await act(async () => {
      const starting = harness.hook().startThread(startRequest({ isolation: "in-place" }));
      await harness.waitForStartedRequests(1);
      harness.environment.workspaceId = OWNER_B;
      harness.environment.workspaceGeneration += 1;
      pendingStart.resolve({ taskId: harness.startedRequests[0]?.taskId ?? "" });
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[0]?.taskId,
      workspaceId: OWNER_A,
    });
    harness.unmount();
  });

  it("rejects stale A to B to A launch authority after the start await", async () => {
    const pendingStart = createDeferred<{ taskId: string }>();
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockImplementationOnce(async (request: StartAgentTaskRequest) => {
      harness.startedRequests.push(request);
      return pendingStart.promise;
    });

    let result: unknown = "pending";
    await act(async () => {
      const starting = harness.hook().startThread(startRequest({ isolation: "in-place" }));
      await harness.waitForStartedRequests(1);
      harness.environment.workspaceId = OWNER_B;
      harness.environment.workspaceGeneration += 1;
      harness.environment.workspaceId = OWNER_A;
      harness.environment.workspaceGeneration += 1;
      pendingStart.resolve({ taskId: harness.startedRequests[0]?.taskId ?? "" });
      result = await starting;
    });

    expect(result).toBeNull();
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[0]?.taskId,
      workspaceId: OWNER_A,
    });
    harness.unmount();
  });

  it("creates a worktree named by the thread id and starts the first turn without resume", async () => {
    const harness = renderDispatch();

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).not.toBeNull();
    const threadId = result?.threadId ?? "";
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledWith(ROOT_A, threadId);
    expect(harness.onWorktreeCreated).toHaveBeenCalledWith(
      ROOT_A,
      `${ROOT_A}/.worktrees/${threadId}`,
    );
    const started = harness.startedRequests[0];
    expect(started?.taskId).not.toBe(threadId);
    expect(started?.cwd).toBe(`${ROOT_A}/.worktrees/${threadId}`);
    expect(started?.resumeSessionId).toBeNull();
    expect(started?.workspaceId).toBe(OWNER_A);
    expect(started?.agentCliKind).toBe("claudeCode");
    expect(started?.providerGeneration).toBe(1);
    expect(Object.keys(started ?? {}).sort()).toEqual(
      [
        "taskId",
        "workspaceId",
        "projectRoot",
        "repositoryRoot",
        "cwd",
        "isolation",
        "prompt",
        "agentCliKind",
        "providerGeneration",
        "resumeSessionId",
        "launch",
      ].sort(),
    );
    expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledWith({
      taskId: started?.taskId,
      workspaceId: OWNER_A,
    });
    const thread = harness.thread(threadId);
    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0]?.turnId).toBe(started?.taskId);
    expect(thread.turns[0]?.status).toEqual({ kind: "pending" });
    expect(thread.turns[0]?.streamMetrics).toBeNull();
    expect(thread.target.worktreePath).toBe(`${ROOT_A}/.worktrees/${threadId}`);
    expect(thread.provider).toEqual({ kind: "claudeCode", sessionId: null });
    expect(thread.title).toBe("Fix the failing test");
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("downgrades a backend-rejected worktree without reporting a generic error and permits retry", async () => {
    const harness = renderDispatch();
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(
      new Error("Agent worktrees require a trusted repository."),
    );

    const rejected = await act(() => harness.hook().startThread(startRequest()));
    const retried = await act(() => harness.hook().startThread(startRequest()));

    expect(rejected).toBeNull();
    expect(retried).not.toBeNull();
    expect(harness.onProjectDispatchTrustRejected).toHaveBeenCalledWith(ROOT_A);
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("reports an unknown worktree creation failure without downgrading the project", async () => {
    const harness = renderDispatch();
    const error = new Error(
      "transport:\u001b[31m cannot lock ref 'refs/heads/agent/agt-test': permission denied\nretry later",
    );
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(error);

    const result = await act(() => harness.hook().startThread(startRequest()));
    const retried = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(retried).not.toBeNull();
    expect(harness.onProjectDispatchTrustRejected).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalledWith("Agents", error);
    expect(harness.notice()).toBeNull();
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(2);
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("shows a bounded sanitized reason when worktree creation fails", async () => {
    const harness = renderDispatch();
    const reason = `permission denied\n\u001b[31m\u0085\u202e${"é".repeat(4_000)}`;
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(new Error(reason));

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    const notice = harness.notice()?.message ?? "";
    expect(notice).toMatch(/^The agent worktree could not be created: permission denied /);
    expect(notice).not.toContain("\n");
    expect(notice).not.toContain("\u001b");
    expect(notice).not.toContain("\u0085");
    expect(notice).not.toContain("\u202e");
    expect(notice).not.toContain("31m");
    expect(notice.endsWith(" [truncated]")).toBe(true);
    expect(new TextEncoder().encode(notice).byteLength).toBeLessThanOrEqual(
      new TextEncoder().encode("The agent worktree could not be created: ").byteLength + 512,
    );
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("stamps the selected provider's observed CLI version on the started turn", async () => {
    const harness = renderDispatch({
      currentCliVersion: { claudeCode: "1.4.2", codex: "0.150.0" },
    });

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).not.toBeNull();
    expect(harness.turn(result?.threadId ?? "", 0).cliVersion).toBe("1.4.2");
    harness.unmount();
  });

  it("starts the turn with an unknown CLI version when provider state has no observed version", async () => {
    const harness = renderDispatch();

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).not.toBeNull();
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.turn(result?.threadId ?? "", 0).cliVersion).toBeNull();
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

  it("downgrades an exact task trust rejection without a generic report or persistent notice", async () => {
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(harness.onProjectDispatchTrustRejected).toHaveBeenCalledWith(ROOT_A);
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.notice()).toBeNull();
    expect(harness.retainUncertainWorktree).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("does not downgrade a replacement project after a delayed task trust rejection", async () => {
    const harness = renderDispatch();
    harness.agent.startAgentTask.mockImplementationOnce(async () => {
      harness.environment.generation += 1;
      throw new Error("Agent tasks require a trusted repository.");
    });

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).toBeNull();
    expect(harness.onProjectDispatchTrustRejected).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledTimes(1);
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

  it("refuses to start when automatic discovery did not find the provider", async () => {
    const harness = renderDispatch({
      providerDisposition: {
        claudeCode: { kind: "policyUnavailable", reason: "notConfigured" },
        codex: { kind: "ready" },
      },
    });

    expect(await act(() => harness.hook().startThread(startRequest()))).toBeNull();

    expect(harness.notice()?.message).toBe(AGENT_PROVIDER_NOT_CONFIGURED_NOTICE);
    harness.unmount();
  });
});

describe("useAgentTurnDispatch launch admission", () => {
  it("rejects a dangerous launch that was not confirmed before touching the gateway", async () => {
    const harness = renderDispatch();
    const launch = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "default",
    } as const;

    const result = await act(() => harness.hook().startThread(startRequest({ launch })));

    expect(result).toBeNull();
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.notice()).toEqual({
      kind: "warning",
      message: DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE,
      action: null,
    });
    harness.unmount();
  });

  it("passes a confirmed dangerous launch into the start request and stamps it on the turn", async () => {
    const harness = renderDispatch();
    const launch = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "default",
    } as const;

    const result = await act(() =>
      harness.hook().startThread(startRequest({ launch, dangerousLaunchConfirmed: true })),
    );

    expect(result).not.toBeNull();
    expect(harness.startedRequests[0]?.launch).toEqual(launch);
    expect(harness.thread(result?.threadId ?? "").turns[0]?.launch).toEqual(launch);
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("starts with the explicit enabled launch provider when the persisted selection is disabled", async () => {
    const harness = renderDispatch({
      cliKind: "codex",
      providerDisposition: {
        claudeCode: { kind: "ready" },
        codex: { kind: "disabled" },
      },
    });

    const result = await act(() => harness.hook().startThread(startRequest()));

    expect(result).not.toBeNull();
    expect(harness.startedRequests[0]).toMatchObject({
      agentCliKind: "claudeCode",
      providerGeneration: 1,
      launch: defaultAgentLaunchOptions("claudeCode"),
    });
    expect(harness.thread(result?.threadId ?? "").provider.kind).toBe("claudeCode");
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("uses the launch chosen for a follow-up rather than the previous turn's", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const launch = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "plan",
      effort: "default",
    } as const;

    expect(await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Go", launch }))).toBe(
      true,
    );

    expect(harness.startedRequests[1]?.launch).toEqual(launch);
    expect(harness.startedRequests[1]?.resumeSessionId).toBe(SESSION_ID);
    expect(harness.thread(threadId).turns[1]?.launch).toEqual(launch);
    harness.unmount();
  });

  it("rejects a follow-up whose launch provider differs from the thread provider", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.agent.startAgentTask.mockClear();

    const sent = await act(() =>
      harness
        .hook()
        .sendFollowUp({ threadId, prompt: "Go", launch: defaultAgentLaunchOptions("codex") }),
    );

    expect(sent).toBe(false);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.notice()?.message).toBe(LAUNCH_PROVIDER_MISMATCH_NOTICE);
    expect(harness.thread(threadId).turns).toHaveLength(1);
    harness.unmount();
  });

  it("rejects an unconfirmed dangerous follow-up and never remembers a prior confirmation", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const launch = {
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "default",
    } as const;
    harness.agent.startAgentTask.mockClear();

    const sent = await act(() => harness.hook().sendFollowUp({ threadId, prompt: "Go", launch }));

    expect(sent).toBe(false);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.notice()?.message).toBe(DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE);
    harness.unmount();
  });
});

describe("useAgentTurnDispatch output stream", () => {
  it("persists exact clean zero-output metrics before a terminal status", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 });
    });

    expect(harness.turn(threadId, 0).streamMetrics).toEqual({
      receivedUtf8Bytes: 0,
      complete: true,
    });
    const actions = harness.actionsOf("turnEventsAppended");
    expect(actions[actions.length - 1]).toMatchObject({
      turnId,
      streamMetricsDelta: { receivedUtf8Bytes: 0, complete: true },
    });
    expect(harness.turn(threadId, 0).status).toEqual({ kind: "exited", exitCode: 0 });
    harness.unmount();
  });

  it("marks zero-output metrics incomplete when supervisor completion is uncertain", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitStatus(turnId, 1, { kind: "failed", message: "wait failed" });
    });

    expect(harness.turn(threadId, 0).streamMetrics).toEqual({
      receivedUtf8Bytes: 0,
      complete: false,
    });
    expect(harness.turn(threadId, 0).status).toEqual({
      kind: "failed",
      message: "wait failed",
    });
    harness.unmount();
  });

  it("keeps a turn incomplete when output subscription became ready only after it started", async () => {
    const outputSubscription = createDeferred<void>();
    const harness = renderDispatch({ outputSubscriptionGate: outputSubscription.promise });
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      outputSubscription.resolve();
      await outputSubscription.promise;
      await Promise.resolve();
    });
    await act(async () => {
      harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 });
    });

    expect(harness.turn(threadId, 0).streamMetrics).toEqual({
      receivedUtf8Bytes: 0,
      complete: false,
    });
    harness.unmount();
  });

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
    const statusActions = harness.actionsOf("taskStatusEvent");
    expect(kinds[terminalIndex - 1]).toBe("turnEventsAppended");
    expect(statusActions[statusActions.length - 1]).toMatchObject({ threadId });
    expect(
      harness
        .actionsOf("turnEventsAppended")
        .every((action) => action.kind === "turnEventsAppended" && action.threadId === threadId),
    ).toBe(true);
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

  it("keeps the stream live for stale or foreign terminal status authority", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    const turnId = harness.turnIdOf(threadId, 0);

    await act(async () => {
      harness.emitStatus(turnId, 1, { kind: "running" });
      harness.emitStatus(turnId, 1, { kind: "exited", exitCode: 0 });
      harness.emitStatus(turnId, 2, { kind: "exited", exitCode: 0 }, OWNER_A, {
        repositoryRoot: ROOT_B,
      });
      harness.emitStatus(turnId, 2, { kind: "exited", exitCode: 0 }, OWNER_A, {
        isolation: "in-place",
        worktreePath: null,
      });
      harness.emitStatus(turnId, 2, { kind: "exited", exitCode: 0 }, OWNER_A, {
        worktreePath: `${ROOT_A}/.worktrees/foreign`,
      });
      harness.emitOutput(turnId, 1, "still live");
    });
    await waitForReact(() => expect(harness.turn(threadId, 0).lastOutputSequence).toBe(1));

    expect(harness.turn(threadId, 0).status).toEqual({ kind: "running" });
    expect(harness.onTurnTerminal).not.toHaveBeenCalled();

    await act(async () => {
      harness.emitStatus(turnId, 2, { kind: "exited", exitCode: 0 });
    });
    expect(harness.turn(threadId, 0).status).toEqual({ kind: "exited", exitCode: 0 });
    expect(harness.onTurnTerminal).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});

describe("useAgentTurnDispatch sendFollowUp", () => {
  it.each([
    ["disabled", { kind: "disabled" }, AGENT_PROVIDER_DISABLED_NOTICE],
    ["updating", { kind: "updating" }, AGENT_PROVIDER_UPDATING_NOTICE],
    [
      "unregistered",
      { kind: "policyUnavailable", reason: "unregistered" },
      AGENT_PROVIDER_UNREGISTERED_NOTICE,
    ],
    [
      "registration-failed",
      { kind: "policyUnavailable", reason: "registrationFailed" },
      AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
    ],
  ] as const)(
    "rejects a follow-up when its provider is %s",
    async (_label, disposition, message) => {
      const harness = renderDispatch();
      const threadId = await harness.settleThreadWithSession();
      harness.environment.providerDisposition.claudeCode = disposition;
      harness.environment.providerRevision.claudeCode += 1;
      harness.agent.startAgentTask.mockClear();

      const sent = await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Continue",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      );

      expect(sent).toBe(false);
      expect(harness.notice()?.message).toBe(message);
      expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("rejects a late follow-up start after an A to B to A provider revision", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const started = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (request: StartAgentTaskRequest) => {
      harness.startedRequests.push(request);
      return started.promise;
    });

    let sent = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await harness.waitForStartedRequests(2);
      replaceProviderAtoBtoA(harness.environment);
      started.resolve({ taskId: harness.startedRequests[1]?.taskId ?? "" });
      sent = await sending;
    });

    expect(sent).toBe(false);
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.turn(threadId, 1).status).toEqual({ kind: "stopped" });
    harness.unmount();
  });

  it("rejects a follow-up after an A to B to A provider revision during acknowledgement", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const acknowledged = createDeferred<undefined>();
    harness.agent.acknowledgeAgentTaskStart.mockImplementationOnce(
      async () => acknowledged.promise,
    );

    let sent = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await waitForReact(() =>
        expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(2),
      );
      replaceProviderAtoBtoA(harness.environment);
      acknowledged.resolve(undefined);
      sent = await sending;
    });

    expect(sent).toBe(false);
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.turn(threadId, 1).status).toEqual({ kind: "stopped" });
    harness.unmount();
  });

  it("resumes the captured session in the thread worktree with a new turn id", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const firstTurnId = harness.turnIdOf(threadId, 0);

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Continue",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(true);

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
    await act(() =>
      harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    );

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Again",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

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

    const first = act(() =>
      harness
        .hook()
        .sendFollowUp({ threadId, prompt: "One", launch: defaultAgentLaunchOptions("claudeCode") }),
    );
    await waitForReact(() => expect(harness.startedRequests).toHaveLength(2));
    const second = await act(() =>
      harness
        .hook()
        .sendFollowUp({ threadId, prompt: "Two", launch: defaultAgentLaunchOptions("claudeCode") }),
    );
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
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
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
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
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

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Continue",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

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
    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Retry",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(true);
    harness.unmount();
  });

  it("settles only its exact follow-up after project authority was replaced during start", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    let result = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await harness.waitForStartedRequests(2);
      harness.environment.generation += 1;
      pendingStart.reject(
        new AgentTaskStartRejectedError(
          "An agent task is already running in this working directory.",
        ),
      );
      result = await sending;
    });

    expect(result).toBe(false);
    expect(harness.turn(threadId, 1).status).toEqual({
      kind: "failed",
      message: "An agent task is already running in this working directory.",
    });
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("stop-settles its exact successful follow-up after project authority was replaced", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStart = createDeferred<{ taskId: string }>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return pendingStart.promise;
    });

    let result = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await harness.waitForStartedRequests(2);
      harness.environment.generation += 1;
      pendingStart.resolve({ taskId: harness.startedRequests[1]?.taskId ?? "" });
      result = await sending;
    });

    expect(result).toBe(false);
    expect(harness.turn(threadId, 1).status).toEqual({ kind: "stopped" });
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("revalidates follow-up authority after stopping an unexpected task id", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingStop = createDeferred<undefined>();
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      return { taskId: "agt-unexpected-0001" };
    });
    harness.agent.stopAgentTask.mockImplementationOnce(async () => pendingStop.promise);

    let result = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await waitForReact(() => expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1));
      harness.environment.generation += 1;
      pendingStop.resolve(undefined);
      result = await sending;
    });

    expect(result).toBe(false);
    expect(harness.turn(threadId, 1).status).toEqual({
      kind: "failed",
      message: "The agent returned an unexpected task id.",
    });
    expect(harness.notice()).toBeNull();
    harness.unmount();
  });

  it("revalidates follow-up authority after acknowledgement and stop awaits", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    const pendingAcknowledge = createDeferred<undefined>();
    harness.agent.acknowledgeAgentTaskStart.mockImplementationOnce(
      async () => pendingAcknowledge.promise,
    );

    let result = true;
    await act(async () => {
      const sending = harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      await waitForReact(() =>
        expect(harness.agent.acknowledgeAgentTaskStart).toHaveBeenCalledTimes(2),
      );
      harness.environment.generation += 1;
      pendingAcknowledge.resolve(undefined);
      result = await sending;
    });

    expect(result).toBe(false);
    expect(harness.turn(threadId, 1).status).toEqual({ kind: "stopped" });
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("keeps the uncertain notice for a start failure the gateway could not classify", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.agent.startAgentTask.mockRejectedValueOnce(new Error("socket hung up"));

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "Continue",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

    expect(harness.turn(threadId, 1).status.kind).toBe("failed");
    expect(harness.notice()?.message).toContain("uncertain");
    harness.unmount();
  });

  it("blocks a follow-up on an archived thread", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    act(() => harness.dispatchAction({ kind: "archived", threadId }));

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "More",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toContain("archived");
    harness.unmount();
  });

  it("blocks a follow-up when the thread's project owner is no longer current", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.switchToProject(ROOT_B, OWNER_B);

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId,
          prompt: "More",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toContain("no longer open");
    expect(harness.startedRequests).toHaveLength(1);
    harness.unmount();
  });

  it("blocks a follow-up when the live task limit is reached", async () => {
    const harness = renderDispatch();
    const settled = await harness.settleThreadWithSession();
    await harness.startThread();
    harness.environment.maxConcurrent = 1;

    expect(
      await act(() =>
        harness.hook().sendFollowUp({
          threadId: settled,
          prompt: "x",
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toContain("concurrent agent limit");
    harness.unmount();
  });

  it("blocks a follow-up when automatic discovery no longer finds the provider", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.environment.providerDisposition.claudeCode = {
      kind: "policyUnavailable",
      reason: "notConfigured",
    };
    harness.environment.providerRevision.claudeCode += 1;

    expect(
      await act(() =>
        harness
          .hook()
          .sendFollowUp({ threadId, prompt: "x", launch: defaultAgentLaunchOptions("claudeCode") }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toBe(AGENT_PROVIDER_NOT_CONFIGURED_NOTICE);
    harness.unmount();
  });

  it("uses the thread provider when the selected draft provider differs", async () => {
    const harness = renderDispatch({
      currentCliVersion: { claudeCode: "2.1.247", codex: "0.150.0" },
    });
    const threadId = await harness.settleThreadWithSession();
    harness.environment.cliKind = "codex";

    expect(
      await act(() =>
        harness
          .hook()
          .sendFollowUp({ threadId, prompt: "x", launch: defaultAgentLaunchOptions("claudeCode") }),
      ),
    ).toBe(true);

    expect(harness.startedRequests[1]).toMatchObject({
      agentCliKind: "claudeCode",
      providerGeneration: 1,
    });
    expect(harness.turn(threadId, 1).cliVersion).toBe("2.1.247");
    harness.unmount();
  });

  it("blocks a follow-up when no session id was captured", async () => {
    const harness = renderDispatch();
    const threadId = await harness.startThread();
    await act(async () => {
      harness.emitStatus(harness.turnIdOf(threadId, 0), 1, { kind: "exited", exitCode: 0 });
    });

    expect(
      await act(() =>
        harness
          .hook()
          .sendFollowUp({ threadId, prompt: "x", launch: defaultAgentLaunchOptions("claudeCode") }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toBe(
      "This thread has no resumable session; start a new thread.",
    );
    harness.unmount();
  });

  it("blocks a follow-up when the worktree is missing", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    harness.environment.worktreeMissing = true;

    expect(
      await act(() =>
        harness
          .hook()
          .sendFollowUp({ threadId, prompt: "x", launch: defaultAgentLaunchOptions("claudeCode") }),
      ),
    ).toBe(false);

    expect(harness.notice()?.message).toBe("The worktree for this thread no longer exists.");
    harness.unmount();
  });

  it("warns once when a resumed turn exits non-zero without a session or result", async () => {
    const harness = renderDispatch();
    const threadId = await harness.settleThreadWithSession();
    await act(() =>
      harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    );

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

  it("attempts every repository root and rejects when any project task drain fails", async () => {
    const harness = renderDispatch();
    await harness.startThread();
    harness.agent.stopAgentTasksForRoot.mockRejectedValueOnce(new Error("stop failed"));

    await expect(harness.hook().stopProjectTasks(OWNER_A, ["/elsewhere"])).rejects.toThrow(
      "Agent project task drain failed.",
    );

    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledTimes(2);
    expect(harness.reportError).toHaveBeenCalledWith(
      AGENT_TASKS_SOURCE,
      expect.objectContaining({ message: "stop failed" }),
    );
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
    launch: defaultAgentLaunchOptions("claudeCode"),
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
    repositoryRoot: ROOT_A,
    firstRepositoryRoot: null,
    activeOwner: OWNER_A,
    workspaceId: OWNER_A,
    workspaceGeneration: 1,
    generation: 1,
    origin: "active-tab",
    cliKind: "claudeCode",
    providerRevision: { claudeCode: 1, codex: 1 },
    providerGeneration: { claudeCode: 1, codex: 1 },
    providerDisposition: { claudeCode: { kind: "ready" }, codex: { kind: "ready" } },
    maxConcurrent: 4,
    worktreeMissing: false,
    leaseToken: 1,
    ensureProjectLease: null,
    preflight: { kind: "ok" },
    currentCliVersion: { claudeCode: null, codex: null },
    outputSubscriptionGate: null,
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
      if (environment.outputSubscriptionGate !== null) {
        await environment.outputSubscriptionGate;
      }
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
  const onWorktreeCreated = vi.fn();
  const onTurnTerminal = vi.fn();
  const onProjectDispatchTrustRejected = vi.fn();
  const reportError = vi.fn();

  const project = (): AgentProjectDescriptor => ({
    rootKey: environment.activeRoot,
    rootPath: environment.activeRoot,
    ownerId: environment.activeOwner,
    label: "app",
    generation: environment.generation,
    trust: "trusted",
    origin: environment.origin,
    repositories: [
      ...(environment.firstRepositoryRoot === null
        ? []
        : [repository(environment.firstRepositoryRoot)]),
      repository(environment.repositoryRoot),
    ],
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
        markUnread: () => undefined,
        rename: () => undefined,
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
      getAgentCliKind: () => environment.cliKind,
      getAgentProviderAdmissionAuthority: (
        provider: AgentCliKind,
      ): AgentProviderAdmissionAuthority => providerAuthority(environment, provider),
      getMaxConcurrentAgentTasks: () => environment.maxConcurrent,
      launchIdentityForProject: () => ({
        workspaceId: environment.workspaceId,
        generation: environment.workspaceGeneration,
      }),
      ensureProjectLease: environment.ensureProjectLease ?? undefined,
      preflightInPlace,
      isWorktreeMissing: () => environment.worktreeMissing,
      retainUncertainWorktree,
      onWorktreeCreated,
      currentCliVersion: (provider) => environment.currentCliVersion[provider],
      onTurnTerminal,
      onProjectDispatchTrustRejected,
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
    onWorktreeCreated,
    onTurnTerminal,
    onProjectDispatchTrustRejected,
    reportError,
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
      overrides: Partial<AgentTaskStatusEvent> = {},
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
        ...overrides,
      });
    },
    emitOutput(taskId: string, sequence: number, chunk: string): void {
      expect(outputHandler).not.toBeNull();
      outputHandler?.({ taskId, sequence, stream: "stdout", chunk, truncated: false });
    },
    switchToProject(rootKey: string, ownerId: string): void {
      environment.activeRoot = rootKey;
      environment.activeOwner = ownerId;
      environment.workspaceId = ownerId;
      environment.workspaceGeneration += 1;
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

function replaceProviderAtoBtoA(environment: Environment): void {
  environment.providerRevision.claudeCode += 1;
  environment.providerRevision.claudeCode += 1;
}

function providerAuthority(
  environment: Environment,
  provider: AgentCliKind,
): AgentProviderAdmissionAuthority {
  const revision = environment.providerRevision[provider];
  const disposition = environment.providerDisposition[provider];
  switch (disposition.kind) {
    case "ready":
      return {
        provider,
        revision,
        disposition,
        providerGeneration: environment.providerGeneration[provider],
      };
    case "updating":
      return {
        provider,
        revision,
        disposition,
        providerGeneration: environment.providerGeneration[provider],
      };
    case "disabled":
      return { provider, revision, disposition };
    case "policyUnavailable":
      return { provider, revision, disposition };
    default:
      return unsupportedProviderDisposition(disposition);
  }
}

function unsupportedProviderDisposition(disposition: never): never {
  throw new TypeError(`Unsupported provider disposition: ${JSON.stringify(disposition)}.`);
}
