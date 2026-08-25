// @vitest-environment jsdom

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
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Fix the failing test",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
        }),
      ).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(ACTIVE_ID);
    expect(harness.startedRequests[0]?.repositoryRoot).toBe(ACTIVE_ROOT);
    expect(harness.trust.getTrust).not.toHaveBeenCalled();
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
        }),
      ).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(agentRootOwnerId(BACKGROUND_ROOT));
    expect(harness.hook().threads).toHaveLength(1);
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
}

function renderWorkbenchAgents(options: HarnessOptions) {
  const appSettings: AppSettings = {
    ...defaultAppSettings(),
    agentCliPath: CLI_PATH,
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
          descriptorForRoot: () => null,
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
    gitRepositoryMappings: [{ rootRelativePath: "" }],
    gitRepositoryStatuses: [],
    openDocuments: [],
    prompter: { confirm: () => true, prompt: () => null },
    reportError,
    setSettingsInitialSection: vi.fn(),
    setSettingsOpen: vi.fn(),
    workspaceId: ACTIVE_ID,
    workspaceRoot: ACTIVE_ROOT,
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
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
