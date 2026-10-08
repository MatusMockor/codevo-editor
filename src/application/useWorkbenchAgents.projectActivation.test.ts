// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { agentRootOwnerId } from "../domain/agentProject";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import type { AgentThread } from "../domain/agentThread";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import { defaultAppSettings, defaultWorkspaceSettings, type AppSettings } from "../domain/settings";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import { AGENT_PROVIDER_CHANGED_BEFORE_SEND_NOTICE } from "./agentTurnAdmission";
import { agentTurnStartAbandonedMessage } from "./agentTurnStartRunner";
import {
  useWorkbenchAgents,
  type WorkbenchAgentsOptions,
  type WorkbenchAgentsSurface,
} from "./useWorkbenchAgents";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

const ACTIVE_ROOT = "/ws/active";
const RESTORED_ROOT = "/ws/api";
const OTHER_ROOT = "/ws/other";
const CLI_PATH = "/usr/local/bin/claude";
const THREAD_ID = "restored-thread";

const LAUNCH: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "default",
  mode: "supervised",
  effort: "high",
  context: "1m",
  fastMode: false,
  thinkingMode: false,
};

describe("useWorkbenchAgents first activation of a restored project", () => {
  it("keeps an accepted follow-up when its restored project becomes the active workspace", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();
    expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(agentRootOwnerId(RESTORED_ROOT));
    const accepted = harness.holdStart();

    let sent: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      sent = harness
        .hook()
        .sendFollowUp({ threadId: THREAD_ID, prompt: "Continue", launch: LAUNCH });
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1));

    harness.openWorkspace(RESTORED_ROOT);
    await waitForReact(() => {
      expect(harness.project(RESTORED_ROOT)?.origin).toBe("active-tab");
      expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(workspaceIdFor(RESTORED_ROOT));
    });
    await act(async () => {
      accepted.resolve();
      expect(await sent).toBe(true);
    });

    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(harness.lastTurnStatus(THREAD_ID)).toEqual({ kind: "pending" });
    harness.unmount();
  });

  it("keeps an accepted follow-up when another project becomes the active workspace", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread(ACTIVE_ROOT)] });
    await harness.settleRestoredProject();
    const accepted = harness.holdStart();

    let sent: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      sent = harness
        .hook()
        .sendFollowUp({ threadId: THREAD_ID, prompt: "Continue", launch: LAUNCH });
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1));

    harness.openWorkspace(RESTORED_ROOT);
    await waitForReact(() => expect(harness.project(ACTIVE_ROOT)?.origin).toBe("background-tab"));
    await act(async () => {
      accepted.resolve();
      expect(await sent).toBe(true);
    });

    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(harness.lastTurnStatus(THREAD_ID)).toEqual({ kind: "pending" });
    harness.unmount();
  });

  it("says why a new thread was not started when its restored project became the active workspace", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [] });
    await harness.settleRestoredProject();
    const worktree = harness.holdWorktree();

    let started: Promise<{ readonly threadId: string } | null> = Promise.resolve(null);
    await act(async () => {
      started = harness.hook().startThread({
        projectRootKey: RESTORED_ROOT,
        repositoryRoot: RESTORED_ROOT,
        prompt: "Refactor the API",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: LAUNCH,
      });
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(1));

    harness.openWorkspace(RESTORED_ROOT);
    await waitForReact(() =>
      expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(workspaceIdFor(RESTORED_ROOT)),
    );
    await act(async () => {
      worktree.resolve();
      expect(await started).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.removeWorktree).toHaveBeenCalledTimes(1);
    expect(harness.hook().notice?.message).toBe(AGENT_PROVIDER_CHANGED_BEFORE_SEND_NOTICE);
    harness.unmount();
  });

  it("still abandons an accepted follow-up when its project tab is closed", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();
    const accepted = harness.holdStart();

    let sent: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      sent = harness
        .hook()
        .sendFollowUp({ threadId: THREAD_ID, prompt: "Continue", launch: LAUNCH });
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1));

    harness.closeTab(RESTORED_ROOT);
    await waitForReact(() =>
      expect(harness.project(RESTORED_ROOT)?.origin).toBe("closed-tab-live-tasks"),
    );
    await act(async () => {
      accepted.resolve();
      expect(await sent).toBe(false);
    });

    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("still abandons an accepted follow-up when the same root is registered as a different workspace", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();
    const accepted = harness.holdStart();

    let sent: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      sent = harness
        .hook()
        .sendFollowUp({ threadId: THREAD_ID, prompt: "Continue", launch: LAUNCH });
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1));

    harness.openWorkspace(RESTORED_ROOT, "workspace-replacement");
    await waitForReact(() =>
      expect(
        harness.hook().agentProjects.launchIdentityForProject(RESTORED_ROOT)?.workspaceId,
      ).toBe("workspace-replacement"),
    );
    await act(async () => {
      accepted.resolve();
      expect(await sent).toBe(false);
    });

    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.lastTurnStatus(THREAD_ID)).toEqual({
      kind: "failed",
      message: agentTurnStartAbandonedMessage("workspaceReplaced"),
    });
    harness.unmount();
  });
});

function workspaceIdFor(rootPath: string): string {
  return `workspace:${rootPath}`;
}

function descriptorFor(rootPath: string, workspaceId: string): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot: rootPath,
    caseSensitive: true,
    selectedPath: rootPath,
    unicodeNormalizationPolicy: "preserved",
    policy: DEFAULT_WORKSPACE_PATH_POLICY,
    workspaceId,
  };
}

function restoredThread(rootKey: string = RESTORED_ROOT): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: {
      rootKey,
      ownerId: agentRootOwnerId(rootKey),
      repositoryRoot: rootKey,
    },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Restored conversation",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
    turns: [
      {
        turnId: "restored-turn",
        prompt: "Start",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1,
        endedAtEpochMs: 2,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 2,
        lastOutputSequence: 0,
        streamMetrics: null,
        launch: LAUNCH,
        cliVersion: "1.0.0",
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: 2,
    externalOrigin: null,
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderWorkbenchAgents(options: { readonly savedThreads: ReadonlyArray<AgentThread> }) {
  const appSettings: AppSettings = {
    ...defaultAppSettings(),
    agentCliKind: "claudeCode",
    agentCliPaths: { claudeCode: CLI_PATH, codex: null },
    workspaceTabs: [ACTIVE_ROOT, RESTORED_ROOT, OTHER_ROOT],
  };
  const appSettingsRef = { current: appSettings };
  const descriptors = new Map<string, WorkspaceIdentityDescriptor>([
    [ACTIVE_ROOT, descriptorFor(ACTIVE_ROOT, workspaceIdFor(ACTIVE_ROOT))],
  ]);
  const leasedWorkspaceIds = new Map<string, string>();
  let activeRoot = ACTIVE_ROOT;
  let startGate: Promise<void> = Promise.resolve();
  let worktreeGate: Promise<void> = Promise.resolve();

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      await startGate;
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    steerAgentTask: vi.fn(async () => ({ kind: "accepted" }) as const),
    closeAgentTaskInput: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (_handler: (event: AgentTaskStatusEvent) => void) => {
      return () => undefined;
    }),
    subscribeAgentTaskOutput: vi.fn(async (_handler: (event: AgentTaskOutputEvent) => void) => {
      return () => undefined;
    }),
  };
  const worktree = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, taskId: string) => {
      await worktreeGate;
      return {
        worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
        branch: `agent/${taskId}`,
        trusted: true,
      };
    }),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };
  const threadStore: AgentThreadStoreGateway = {
    loadAgentThreads: vi.fn(async ({ rootKey }: { readonly rootKey: string }) => ({
      threads: options.savedThreads.filter((thread) => thread.owner.rootKey === rootKey),
      unreadable: [],
      evicted: 0,
    })),
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
    getDiff: vi.fn(async () => Promise.reject(new Error("diff not stubbed"))),
    stageFiles: vi.fn(async () => Promise.reject(new Error("stage not stubbed"))),
    commit: vi.fn(async () => Promise.reject(new Error("commit not stubbed"))),
  };
  let nextLeaseToken = 0;
  const lease = {
    acquireAgentRootLease: vi.fn(async (request: { rootPath: string }) => {
      nextLeaseToken += 1;
      const workspaceId =
        descriptors.get(request.rootPath)?.workspaceId ?? workspaceIdFor(request.rootPath);
      leasedWorkspaceIds.set(request.rootPath, workspaceId);
      return { leaseToken: nextLeaseToken, workspaceId };
    }),
    releaseAgentRootLease: vi.fn(async (request: { readonly leaseToken: number }) => ({
      kind: "released" as const,
      leaseToken: request.leaseToken,
    })),
  };
  const agentProviderGateway = {
    currentAgentProviderPolicy: vi.fn(
      async ({ provider }: { provider: "claudeCode" | "codex" }) => ({
        kind: "unregistered" as const,
        provider,
      }),
    ),
    registerAgentProviderPolicy: vi.fn(
      async (request: { provider: "claudeCode" | "codex"; settingsRevision: number }) => ({
        provider: request.provider,
        settingsRevision: request.settingsRevision,
        providerGeneration: 1,
      }),
    ),
    checkAgentProviderUpdates: async () => ({
      update: { kind: "checksDisabled" as const },
      checkedAtEpochMs: 0,
    }),
    probeAgentProviderHealth: vi.fn(async () => ({
      installedVersion: "1.0.0",
      auth: { kind: "unknown" as const },
      update: { kind: "checksDisabled" as const },
      checkedAtEpochMs: 1,
    })),
    updateAgentProvider: vi.fn(async () => ({
      kind: "failed" as const,
      reason: "authorityChanged" as const,
      outputTail: "",
      outputTruncated: false,
    })),
  };
  const workbenchOptions: WorkbenchAgentsOptions = {
    agentProviderGateway,
    agentCliDiscoveryGateway: {
      discoverAgentClis: vi.fn(async () => ({
        claudeCode: { kind: "notFound" as const },
        codex: { kind: "notFound" as const },
      })),
    },
    agentTaskGateway: agent as unknown as AgentTaskGateway,
    agentThreadStoreGateway: threadStore,
    gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
    agentModeActive: true,
    agentProjectGateways: {
      settingsGateway: { loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()) },
      trustGateway: {
        getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
        setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      },
      repositoryDiscoveryGateway: { detectRepositories: vi.fn(async () => [""]) },
      agentRootLeaseGateway: lease,
      descriptorForRoot: (rootPath) => descriptors.get(rootPath) ?? null,
    },
    appSettingsRef,
    applyAppSettings: (settings) => {
      Object.assign(appSettings, settings);
      appSettingsRef.current = appSettings;
    },
    settingsPersistenceGateway: { saveAppSettings: vi.fn(async () => undefined) },
    settingsHydrated: true,
    workspaceSettingsRef: { current: defaultWorkspaceSettings() },
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
    onActiveWorkspaceTrustChanged: vi.fn(),
    prompter: { confirm: () => true, prompt: () => null },
    reportError: vi.fn(),
    revealTerminal: vi.fn(),
    setSettingsInitialSection: vi.fn(),
    setSettingsOpen: vi.fn(),
    get workspaceId() {
      return descriptors.get(activeRoot)?.workspaceId ?? null;
    },
    get workspaceRoot() {
      return activeRoot;
    },
    terminalGateway: {
      stop: vi.fn(async (sessionId) => ({ kind: "stopped" as const, sessionId })),
    },
    workspaceTrust: null,
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: WorkbenchAgentsSurface | null = null;

  function Harness() {
    current = useWorkbenchAgents(workbenchOptions);
    return null;
  }

  const render = (): void => act(() => root.render(createElement(Harness)));
  const hook = (): WorkbenchAgentsSurface => {
    expect(current).not.toBeNull();
    return current as WorkbenchAgentsSurface;
  };
  const project = (rootKey: string) =>
    hook().agentProjects.projects.find((candidate) => candidate.rootKey === rootKey);
  render();

  return {
    agent,
    worktree,
    hook,
    project,
    async settleRestoredProject() {
      await waitForReact(() => {
        expect(project(RESTORED_ROOT)?.trust).toBe("trusted");
        expect(project(RESTORED_ROOT)?.repositories.length).toBeGreaterThan(0);
        expect(hook().agentProjects.launchIdentityForProject(RESTORED_ROOT)).not.toBeNull();
        expect(hook().providerManagement.admissionAuthority("claudeCode").disposition.kind).toBe(
          "ready",
        );
        expect(hook().threads).toHaveLength(options.savedThreads.length);
      });
    },
    holdStart() {
      const gate = createDeferred();
      startGate = gate.promise;
      return gate;
    },
    holdWorktree() {
      const gate = createDeferred();
      worktreeGate = gate.promise;
      return gate;
    },
    openWorkspace(rootPath: string, workspaceId?: string) {
      descriptors.set(
        rootPath,
        descriptorFor(
          rootPath,
          workspaceId ?? leasedWorkspaceIds.get(rootPath) ?? workspaceIdFor(rootPath),
        ),
      );
      activeRoot = rootPath;
      render();
    },
    closeTab(rootPath: string) {
      appSettings.workspaceTabs = appSettings.workspaceTabs.filter((tab) => tab !== rootPath);
      render();
    },
    lastTurnStatus(threadId: string) {
      const thread = hook().threads.find((view) => view.thread.threadId === threadId)?.thread;
      return thread?.turns[thread.turns.length - 1]?.status;
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
