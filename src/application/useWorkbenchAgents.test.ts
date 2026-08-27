// @vitest-environment jsdom

import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { WorkspaceTrustState } from "../domain/trust";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type WorkspaceSettings,
} from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useWorkbenchAgents,
  type WorkbenchAgentsOptions,
  type WorkbenchAgentsSurface,
} from "./useWorkbenchAgents";

const ACTIVE_ROOT = "/ws/active";
const ACTIVE_ID = "workspace-active";
const BACKGROUND_ROOT = "/ws/api";
const CLI_PATH = "/usr/local/bin/claude";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useWorkbenchAgents composition", () => {
  it("serves the M1 single active project without project gateways", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });

    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));

    const project = harness.hook().agentProjects.projects[0];
    expect(project?.rootKey).toBe(ACTIVE_ROOT);
    expect(project?.ownerId).toBe(ACTIVE_ID);
    expect(project?.origin).toBe("active-tab");
    expect(project?.trust).toBe("trusted");

    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Fix the failing test",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(ACTIVE_ID);
    expect(harness.startedRequests[0]?.repositoryRoot).toBe(ACTIVE_ROOT);
    expect(harness.trust.getTrust).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("selects the current provider path for every new dispatch", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });
    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));
    harness.appSettings.agentCliPaths = {
      claudeCode: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
    };
    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Claude turn",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    expect(harness.startedRequests[0]).toMatchObject({
      agentCliKind: "claudeCode",
      agentCliPath: "/usr/local/bin/claude",
    });

    harness.appSettings.agentCliKind = "codex";
    harness.rerender();
    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Codex turn",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("codex"),
      });
    });
    expect(harness.startedRequests[1]).toMatchObject({
      agentCliKind: "codex",
      agentCliPath: "/usr/local/bin/codex",
    });
    harness.unmount();
  });

  it("dispatches a nested repository with the replacement registered workspace identity", async () => {
    const nestedRepository = `${ACTIVE_ROOT}/packages/api`;
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      gitRepositoryMappings: [{ rootRelativePath: "" }, { rootRelativePath: "packages/api" }],
    });
    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));
    let firstThreadId = "";
    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Keep working",
        isolation: "in-place",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
      firstThreadId = started?.threadId ?? "";
    });

    harness.setWorkspaceId("workspace-active-replaced");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-active-replaced",
      );
      expect(harness.hook().agentProjects.projects[0]?.ownerId).toBe(ACTIVE_ID);
    });

    let secondThreadId = "";
    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: nestedRepository,
        prompt: "List files",
        isolation: "in-place",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
      secondThreadId = started?.threadId ?? "";
    });

    expect(harness.startedRequests[1]).toMatchObject({
      workspaceId: "workspace-active-replaced",
      projectRoot: ACTIVE_ROOT,
      repositoryRoot: nestedRepository,
      cwd: nestedRepository,
    });
    expect(harness.hook().threads).toHaveLength(2);
    expect(harness.hook().threads.map((view) => view.thread.owner.ownerId)).toEqual(
      expect.arrayContaining([ACTIVE_ID, "workspace-active-replaced"]),
    );
    act(() => {
      harness.hook().renameThread(firstThreadId, "First owner");
      harness.hook().renameThread(secondThreadId, "Second owner");
    });
    expect(harness.hook().threads.map((view) => view.thread.title)).toEqual(
      expect.arrayContaining(["First owner", "Second owner"]),
    );
    await act(async () => harness.hook().stop(secondThreadId));
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[1]?.taskId,
      workspaceId: "workspace-active-replaced",
    });
    harness.unmount();
  });

  it("admits background tabs through the project gateways and dispatches into them", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
    });

    const background = harness
      .hook()
      .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
    expect(background?.origin).toBe("background-tab");
    expect(background?.ownerId).toBe(agentRootOwnerId(BACKGROUND_ROOT));

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(agentRootOwnerId(BACKGROUND_ROOT));
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps trust rejections out of Problems across grant and retry", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.leaseToken).not.toBeNull();
    });
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(
      new Error("Agent worktrees require a trusted repository."),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Check trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("untrusted");
      expect(background?.leaseToken).toBeNull();
    });
    expect(harness.reportError).not.toHaveBeenCalled();

    await act(async () => {
      await harness.hook().agentProjects.trustProject(BACKGROUND_ROOT);
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.leaseToken).not.toBeNull();
    });
    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Retry after trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(harness.trust.setTrust).toHaveBeenCalledWith(BACKGROUND_ROOT, true);
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(2);
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a late trust rejection across an active workspace A to B to A replacement", async () => {
    const worktree = createDeferred<{
      readonly worktreePath: string;
      readonly branch: string;
      readonly trusted: boolean;
    }>();
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockImplementationOnce(() => worktree.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check stale trust",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.addAgentWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      worktree.reject(new Error("Agent worktrees require a trusted repository."));
      expect(await pending).toBeNull();
    });

    expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
    expect(harness.activeTrustChanged).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops an untrusted worktree cleanup notice across an active workspace A to B to A replacement", async () => {
    const cleanup = createDeferred<undefined>();
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockResolvedValueOnce({
      worktreePath: `${ACTIVE_ROOT}/.worktrees/stale`,
      branch: "agent/stale",
      trusted: false,
    });
    harness.worktree.removeWorktree.mockImplementationOnce(() => cleanup.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check stale cleanup",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.removeWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      cleanup.resolve(undefined);
      expect(await pending).toBeNull();
    });

    expect(harness.hook().notice).toBeNull();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reports orphaned cleanup to the retained project after an active workspace replacement", async () => {
    const cleanup = createDeferred<undefined>();
    const cleanupError = new Error("cleanup failed");
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockResolvedValueOnce({
      worktreePath: `${ACTIVE_ROOT}/.worktrees/orphaned`,
      branch: "agent/orphaned",
      trusted: false,
    });
    harness.worktree.removeWorktree.mockImplementationOnce(() => cleanup.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check orphan accounting",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.removeWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      cleanup.reject(cleanupError);
      expect(await pending).toBeNull();
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", cleanupError);
    expect(harness.hook().notice?.message).toContain("orphaned");
    harness.unmount();
  });

  it("forwards active workspace trust as the project authority", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTrust: { rootPath: ACTIVE_ROOT, trusted: false },
    });

    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("untrusted");
    });
    expect(harness.lease.acquireAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("downgrades a project fail-closed when the backend rejects the dispatch as untrusted", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
    });
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("untrusted");
    });
    harness.unmount();
  });

  it("keeps the active project downgraded after the backend rejects its dispatch as untrusted", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTrust: { rootPath: ACTIVE_ROOT, trusted: true },
    });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
    });
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );
    const trustCallsBeforeRejection = harness.trust.getTrust.mock.calls.length;

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Check trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("untrusted");
    });
    expect(harness.activeTrustChanged).toHaveBeenCalledWith(ACTIVE_ROOT, ACTIVE_ID, false);
    expect(harness.trust.getTrust).toHaveBeenCalledTimes(trustCallsBeforeRejection);
    harness.unmount();
  });

  it("refuses a dispatch into an unprotected project when the lease cannot be acquired", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
      refusedLeaseRoots: [BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
      expect(background?.leaseToken).toBeNull();
    });

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.kind).toBe("error");
    expect(harness.hook().notice?.message).toContain("could not be protected from tab close");
    harness.unmount();
  });

  it("acquires the missing lease during dispatch and keeps the closed tab's task alive", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
      refusedLeaseRoots: [BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
      expect(background?.leaseToken).toBeNull();
    });
    harness.refusedLeaseRoots.delete(BACKGROUND_ROOT);

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(
      harness.lease.acquireAgentRootLease.mock.calls.filter(
        ([request]) => request.rootPath === BACKGROUND_ROOT,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.leaseToken).not.toBeNull();
    });
    expect(harness.hook().threads).toHaveLength(1);

    harness.appSettings.workspaceTabs = [ACTIVE_ROOT];
    harness.rerender();

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.origin).toBe("closed-tab-live-tasks");
    });
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(harness.agent.stopAgentTasksForRoot).not.toHaveBeenCalled();
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("releases a background project by stopping its tasks through the agent gateway", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.repositories.length).toBeGreaterThan(0);
    });

    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: BACKGROUND_ROOT,
        repositoryRoot: BACKGROUND_ROOT,
        prompt: "Refactor the API",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    const worktreePath = harness.startedRequests[0]?.cwd ?? "";
    await act(async () => {
      harness.emitStatus({
        taskId,
        workspaceId: agentRootOwnerId(BACKGROUND_ROOT),
        repositoryRoot: BACKGROUND_ROOT,
        isolation: "worktree",
        worktreePath,
        sequence: 1,
        status: { kind: "exited", exitCode: 0 },
      });
    });

    harness.appSettings.workspaceTabs = [ACTIVE_ROOT];
    await act(async () => {
      await harness.hook().agentProjects.releaseProject(BACKGROUND_ROOT);
    });

    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: agentRootOwnerId(BACKGROUND_ROOT),
      repositoryRoot: BACKGROUND_ROOT,
    });
    await waitForReact(() => {
      expect(
        harness
          .hook()
          .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined();
      expect(harness.hook().threads).toHaveLength(0);
    });
    harness.unmount();
  });
});

interface HarnessOptions {
  withProjectGateways: boolean;
  workspaceTabs?: ReadonlyArray<string>;
  refusedLeaseRoots?: ReadonlyArray<string>;
  workspaceTrust?: WorkspaceTrustState | null;
  gitRepositoryMappings?: ReadonlyArray<{ readonly rootRelativePath: string }>;
}

function renderWorkbenchAgents(options: HarnessOptions) {
  const appSettings: AppSettings = {
    ...defaultAppSettings(),
    agentCliPaths: { claudeCode: CLI_PATH, codex: null },
    workspaceTabs: [...(options.workspaceTabs ?? [])],
  };
  const workspaceSettings: WorkspaceSettings = defaultWorkspaceSettings();
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;

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
    subscribeAgentTaskOutput: vi.fn(async (_handler: (event: AgentTaskOutputEvent) => void) => {
      return () => undefined;
    }),
  };

  const worktree = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, taskId: string) => ({
      worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
      branch: `agent/${taskId}`,
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };

  const threadStore: AgentThreadStoreGateway = {
    loadAgentThreads: vi.fn(async () => ({ threads: [], unreadable: [], evicted: 0 })),
    saveAgentThread: vi.fn(async () => undefined),
    deleteAgentThread: vi.fn(async () => undefined),
  };

  const git = {
    getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      changes: [],
      isRepository: true,
      rootPath,
    })),
    getDiff: vi.fn(async () => {
      return Promise.reject(new Error("diff not stubbed"));
    }),
    stageFiles: vi.fn(async () => Promise.reject(new Error("stage not stubbed"))),
    commit: vi.fn(async () => Promise.reject(new Error("commit not stubbed"))),
  };

  const trust = {
    getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
  };
  const settingsGateway = {
    loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
  };
  const discovery = { detectRepositories: vi.fn(async () => []) };
  let nextLeaseToken = 0;
  const refusedLeaseRoots = new Set<string>(options.refusedLeaseRoots ?? []);
  const lease = {
    acquireAgentRootLease: vi.fn(async (request: { rootPath: string }) => {
      if (refusedLeaseRoots.has(request.rootPath)) {
        return Promise.reject(new Error("Too many agent project roots are leased."));
      }
      nextLeaseToken += 1;
      return { leaseToken: nextLeaseToken };
    }),
    releaseAgentRootLease: vi.fn(async () => undefined),
  };

  const reportError = vi.fn();
  let activeWorkspaceId = ACTIVE_ID;
  let activeWorkspaceTrust = options.workspaceTrust ?? null;
  const activeTrustChanged = vi.fn((rootPath: string, ownerId: string, trusted: boolean) => {
    if (rootPath !== ACTIVE_ROOT || ownerId !== ACTIVE_ID) return;
    activeWorkspaceTrust = { rootPath, trusted };
  });
  const workbenchOptions: WorkbenchAgentsOptions = {
    agentTaskGateway: agent as unknown as AgentTaskGateway,
    agentThreadStoreGateway: threadStore,
    gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
    agentModeActive: true,
    agentProjectGateways: options.withProjectGateways
      ? {
          settingsGateway,
          trustGateway: trust,
          repositoryDiscoveryGateway: discovery,
          agentRootLeaseGateway: lease,
          descriptorForRoot: (rootPath) => ({
            canonicalRoot: rootPath,
            caseSensitive: true,
            selectedPath: rootPath,
            unicodeNormalizationPolicy: "preserved",
            policy: DEFAULT_WORKSPACE_PATH_POLICY,
            workspaceId: agentRootOwnerId(rootPath),
          }),
        }
      : undefined,
    appSettingsRef: { current: appSettings },
    workspaceSettingsRef: { current: workspaceSettings },
    gitGateway: git,
    gitIntegrationGateway: {
      getShipStatus: vi.fn(async () => Promise.reject(new Error("ship status not stubbed"))),
      pushBranchUpstream: vi.fn(async () => Promise.reject(new Error("push not stubbed"))),
      integrateWorktreeBranch: vi.fn(async () =>
        Promise.reject(new Error("integrate not stubbed")),
      ),
    },
    externalUrlOpener: null,
    gitRepositoryMappings: options.gitRepositoryMappings ?? [{ rootRelativePath: "" }],
    gitRepositoryStatuses: [],
    openDocuments: [],
    onActiveWorkspaceTrustChanged: activeTrustChanged,
    prompter: { confirm: () => true, prompt: () => null },
    reportError,
    setSettingsInitialSection: vi.fn(),
    setSettingsOpen: vi.fn(),
    get workspaceId() {
      return activeWorkspaceId;
    },
    workspaceRoot: ACTIVE_ROOT,
    get workspaceTrust() {
      return activeWorkspaceTrust;
    },
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: WorkbenchAgentsSurface | null = null;

  function Harness() {
    current = useWorkbenchAgents(workbenchOptions);
    return null;
  }

  act(() => root.render(createElement(Harness)));

  return {
    agent,
    activeTrustChanged,
    appSettings,
    git,
    lease,
    refusedLeaseRoots,
    reportError,
    settingsGateway,
    startedRequests,
    trust,
    worktree,
    emitStatus(event: AgentTaskStatusEvent) {
      expect(statusHandler).not.toBeNull();
      statusHandler?.(event);
    },
    hook(): WorkbenchAgentsSurface {
      expect(current).not.toBeNull();
      return current as WorkbenchAgentsSurface;
    },
    rerender() {
      act(() => root.render(createElement(Harness)));
    },
    setWorkspaceId(workspaceId: string) {
      activeWorkspaceId = workspaceId;
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
