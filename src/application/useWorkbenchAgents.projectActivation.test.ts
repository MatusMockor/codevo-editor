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
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import { defaultAppSettings, defaultWorkspaceSettings, type AppSettings } from "../domain/settings";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import { agentLaunchReplacedBeforeSendNotice } from "./agentProjectAuthority";
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

type Boundary = "inspect" | "start" | "acknowledge" | "worktree" | "probe";
const FOLLOW_UP_BOUNDARIES = [
  ["while it is being prepared", "inspect"],
  ["before the backend accepts it", "start"],
  ["between acceptance and acknowledgement", "acknowledge"],
  ["after it is running", null],
] as const;
const NEW_THREAD_BOUNDARIES = [
  ["during its repository probe", "probe"],
  ["while its worktree is created", "worktree"],
  ["before the backend accepts it", "start"],
] as const;

async function sendAcrossActivation(
  harness: ReturnType<typeof renderWorkbenchAgents>,
  boundary: Boundary | null,
  activate: () => Promise<void>,
): Promise<boolean> {
  const gate = boundary === null ? null : harness.hold(boundary);
  let sent: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    sent = harness.hook().sendFollowUp({ threadId: THREAD_ID, prompt: "Continue", launch: LAUNCH });
    await Promise.resolve();
  });
  if (gate === null) await act(async () => void (await sent));
  if (gate !== null) await waitForReact(() => expect(gate.entered()).toBeGreaterThan(0));
  if (boundary === "inspect") expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
  await activate();
  let result = false;
  await act(async () => {
    gate?.release();
    result = await sent;
  });
  return result;
}

describe("useWorkbenchAgents sends across a project activation", () => {
  it.each(FOLLOW_UP_BOUNDARIES)(
    "keeps a follow-up %s when its restored project becomes the active workspace",
    async (_label, boundary) => {
      const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
      await harness.settleRestoredProject();
      expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(agentRootOwnerId(RESTORED_ROOT));

      const sent = await sendAcrossActivation(harness, boundary, async () => {
        harness.openWorkspace(RESTORED_ROOT);
        await waitForReact(() => {
          expect(harness.project(RESTORED_ROOT)?.origin).toBe("active-tab");
          expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(workspaceIdFor(RESTORED_ROOT));
        });
      });

      expect(sent).toBe(true);
      expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
      expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
      expect(harness.lastTurnStatus(THREAD_ID)).toEqual({ kind: "pending" });
      harness.unmount();
    },
  );

  it.each(FOLLOW_UP_BOUNDARIES)(
    "keeps a turn sent in the active project %s when a thread of another project is selected",
    async (_label, boundary) => {
      const harness = renderWorkbenchAgents({ savedThreads: [restoredThread(ACTIVE_ROOT)] });
      await harness.settleRestoredProject();

      const sent = await sendAcrossActivation(harness, boundary, async () => {
        harness.openWorkspace(RESTORED_ROOT);
        await waitForReact(() =>
          expect(harness.project(ACTIVE_ROOT)?.origin).toBe("background-tab"),
        );
      });

      expect(sent).toBe(true);
      expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
      expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
      expect(harness.lastTurnStatus(THREAD_ID)).toEqual({ kind: "pending" });
      harness.unmount();
    },
  );

  it.each(NEW_THREAD_BOUNDARIES)(
    "starts a new thread %s when its restored project becomes the active workspace",
    async (_label, boundary) => {
      const harness = renderWorkbenchAgents({ savedThreads: [] });
      await harness.settleRestoredProject();
      const gate = harness.hold(boundary);

      let started: Promise<{ readonly threadId: string } | null> = Promise.resolve(null);
      await act(async () => {
        started = harness.hook().startThread(newThreadRequest());
        await Promise.resolve();
      });
      await waitForReact(() => expect(gate.entered()).toBeGreaterThan(0));
      harness.openWorkspace(RESTORED_ROOT);
      await waitForReact(() =>
        expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(workspaceIdFor(RESTORED_ROOT)),
      );
      await act(async () => {
        gate.release();
        expect(await started).not.toBeNull();
      });

      expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
      expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
      expect(harness.worktree.removeWorktree).not.toHaveBeenCalled();
      harness.unmount();
    },
  );
});

describe("useWorkbenchAgents genuine replacements during a start", () => {
  it("abandons an accepted follow-up when its project tab is closed", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();

    const sent = await sendAcrossActivation(harness, "start", async () => {
      harness.closeTab(RESTORED_ROOT);
      await waitForReact(() =>
        expect(harness.project(RESTORED_ROOT)?.origin).toBe("closed-tab-live-tasks"),
      );
    });

    expect(sent).toBe(false);
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("abandons an accepted follow-up when the same root is registered as a different workspace", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();

    const sent = await sendAcrossActivation(harness, "start", async () => {
      harness.openWorkspace(RESTORED_ROOT, "workspace-replacement");
      await waitForReact(() =>
        expect(
          harness.hook().agentProjects.launchIdentityForProject(RESTORED_ROOT)?.workspaceId,
        ).toBe("workspace-replacement"),
      );
    });

    expect(sent).toBe(false);
    expect(harness.agent.stopAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.lastTurnStatus(THREAD_ID)).toEqual({
      kind: "failed",
      message: agentTurnStartAbandonedMessage("workspaceReplaced"),
    });
    harness.unmount();
  });

  it("says the workspace was registered again when a prepared start meets a replacement of the open root", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [] });
    await harness.settleRestoredProject();
    const gate = harness.hold("worktree");

    let started: Promise<{ readonly threadId: string } | null> = Promise.resolve(null);
    await act(async () => {
      started = harness.hook().startThread(newThreadRequest());
      await Promise.resolve();
    });
    await waitForReact(() => expect(gate.entered()).toBeGreaterThan(0));
    harness.openWorkspace(RESTORED_ROOT, "workspace-replacement");
    await waitForReact(() =>
      expect(
        harness.hook().agentProjects.launchIdentityForProject(RESTORED_ROOT)?.workspaceId,
      ).toBe("workspace-replacement"),
    );
    await act(async () => {
      gate.release();
      expect(await started).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toBe(
      agentLaunchReplacedBeforeSendNotice("workspaceReplaced"),
    );
    harness.unmount();
  });

  it("stays silent when a prepared start loses its project tab", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [] });
    await harness.settleRestoredProject();
    const gate = harness.hold("worktree");

    let started: Promise<{ readonly threadId: string } | null> = Promise.resolve(null);
    await act(async () => {
      started = harness.hook().startThread(newThreadRequest());
      await Promise.resolve();
    });
    await waitForReact(() => expect(gate.entered()).toBeGreaterThan(0));
    harness.closeTab(RESTORED_ROOT);
    await waitForReact(() => expect(harness.project(RESTORED_ROOT)).toBeUndefined());
    await act(async () => {
      gate.release();
      expect(await started).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("leaves no thread of a closed project after repeated promotions with failed reloads", async () => {
    const harness = renderWorkbenchAgents({ savedThreads: [restoredThread()] });
    await harness.settleRestoredProject();
    harness.failReloads();

    harness.openWorkspace(RESTORED_ROOT);
    await waitForReact(() =>
      expect(harness.project(RESTORED_ROOT)?.ownerId).toBe(workspaceIdFor(RESTORED_ROOT)),
    );
    expect(harness.hook().threads).toHaveLength(1);
    harness.openWorkspace(RESTORED_ROOT, "workspace-replacement");
    await waitForReact(() =>
      expect(harness.project(RESTORED_ROOT)?.ownerId).toBe("workspace-replacement"),
    );
    expect(harness.project(RESTORED_ROOT)?.runtimeOwnerIds).not.toContain(
      agentRootOwnerId(RESTORED_ROOT),
    );

    harness.closeTab(RESTORED_ROOT);
    harness.openWorkspace(ACTIVE_ROOT);
    await waitForReact(() => expect(harness.project(RESTORED_ROOT)).toBeUndefined());
    expect(harness.hook().threads).toHaveLength(0);
    harness.unmount();
  });
});

function newThreadRequest() {
  return {
    projectRootKey: RESTORED_ROOT,
    repositoryRoot: RESTORED_ROOT,
    prompt: "Refactor the API",
    isolation: "worktree",
    unsafeInPlaceConfirmationKey: null,
    launch: LAUNCH,
  } as const;
}

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
  const gates = new Map<Boundary, { readonly opened: Promise<void>; entered: number }>();
  const pass = async (boundary: Boundary): Promise<void> => {
    const gate = gates.get(boundary);
    if (gate === undefined) return;
    gate.entered += 1;
    await gate.opened;
  };
  let reloadsFail = false;
  let loads = 0;

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      await pass("start");
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => pass("acknowledge")),
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
  const sessions: AgentThreadSessionGateway = {
    interruptAgentTask: vi.fn(async () => Promise.reject(new Error("interrupt not stubbed"))),
    inspectAgentThreadSession: vi.fn(async () => {
      await pass("inspect");
      return Promise.reject(new Error("No session to inspect."));
    }),
    endAgentThreadSession: vi.fn(async () => false),
    stopAgentBackgroundTask: vi.fn(async () => Promise.reject(new Error("stop not stubbed"))),
    subscribeAgentSessionEnded: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTasks: vi.fn(async () => () => undefined),
  };
  const worktree = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, taskId: string) => {
      await pass("worktree");
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
    loadAgentThreads: vi.fn(async ({ rootKey }: { readonly rootKey: string }) => {
      loads += 1;
      if (reloadsFail) throw new Error("Saved agent history is unavailable.");
      return {
        threads: options.savedThreads.filter((thread) => thread.owner.rootKey === rootKey),
        unreadable: [],
        evicted: 0,
      };
    }),
    saveAgentThread: vi.fn(async () => undefined),
    deleteAgentThread: vi.fn(async () => undefined),
  };
  const git = {
    getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => {
      await pass("probe");
      return { branch: "main", changes: [], isRepository: true, rootPath };
    }),
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
    agentThreadSessionGateway: sessions,
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
    hold(boundary: Boundary) {
      const opened = createDeferred();
      const gate = { opened: opened.promise, entered: 0 };
      gates.set(boundary, gate);
      return {
        entered: () => gate.entered,
        release: () => {
          gates.delete(boundary);
          opened.resolve();
        },
      };
    },
    failReloads() {
      expect(loads).toBeGreaterThan(0);
      reloadsFail = true;
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
