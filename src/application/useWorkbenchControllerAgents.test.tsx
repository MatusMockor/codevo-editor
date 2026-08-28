// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  initialAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeWorkspaceSession,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSettings,
} from "../domain/settings";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import { WorkspaceTrustIntentCoordinator } from "./workspaceTrustIntentCoordinator";
import {
  loadWorkspaceTrustForOwner,
  useWorkbenchControllerAgents,
  type WorkbenchControllerAgentsOptions,
  type WorkbenchControllerAgentsSurface,
} from "./useWorkbenchControllerAgents";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

const ROOT_A = "/ws/a";
const ROOT_B = "/ws/b";

describe("loadWorkspaceTrustForOwner", () => {
  it("drops a late workspace-open result after an agent trust grant", async () => {
    let resolveTrust!: (trust: { rootPath: string; trusted: boolean }) => void;
    const pendingTrust = new Promise<{ rootPath: string; trusted: boolean }>((resolve) => {
      resolveTrust = resolve;
    });
    const revisionByOwnerRef = { current: { "workspace-a": 0 } };
    const publish = vi.fn();
    const loading = loadWorkspaceTrustForOwner({
      gateway: {
        getTrust: vi.fn(() => pendingTrust),
        setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
      },
      isCurrent: () => true,
      ownerId: "workspace-a",
      publish,
      reportError: vi.fn(),
      revisionByOwnerRef,
      rootPath: ROOT_A,
    });

    revisionByOwnerRef.current["workspace-a"] = 1;
    resolveTrust({ rootPath: ROOT_A, trusted: false });
    await loading;

    expect(publish).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchControllerAgents layout surface", () => {
  it("advances active trust authority when the agent project grants trust", async () => {
    const harness = renderAgents();
    harness.rerender({ workspaceTrust: { rootPath: ROOT_A, trusted: false } });
    await harness.settle();

    await act(async () => {
      await harness.result().agentProjects.trustProject(ROOT_A);
    });

    expect(harness.workspaceTrustRevisionByOwnerRef.current["workspace-a"]).toBe(1);
    expect(
      harness.workspaceTrustIntentCoordinator.request(
        createWorkspaceRuntimeOwner("workspace-a", ROOT_A),
        ROOT_A,
        false,
      ).revision,
    ).toBe(2);
    expect(harness.setWorkspaceTrust).toHaveBeenCalled();
    harness.unmount();
  });

  it("forces the expanded editor without a workspace", () => {
    const harness = renderAgents({ workspaceRoot: null, editorSessionOwnerKey: null });

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("editor-expanded");
    harness.unmount();
  });

  it("keeps the agent layout unavailable without a root lease gateway", () => {
    const harness = renderAgents({ withLeaseGateway: false });

    expect(harness.result().agentModeActive).toBe(false);
    harness.unmount();
  });

  it("serves the agent layout for a leased workspace", () => {
    const harness = renderAgents();

    expect(harness.result().agentModeActive).toBe(true);
    expect(harness.result().agentWorkbench.layout.activeSurface).toBeNull();
    harness.unmount();
  });

  it("registers provider policy only after exact app settings hydration", async () => {
    const harness = renderAgents();
    expect(harness.agentProviderGateway.registerAgentProviderPolicy).not.toHaveBeenCalled();

    act(() => harness.result().markAppSettingsHydrated(true));
    await harness.settle();

    expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("dispatches layout actions and derives the agent mode flag", () => {
    const harness = renderAgents();

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    expect(harness.result().agentWorkbench.layout.activeSurface).toBe("diff");

    act(() => harness.result().agentWorkbench.dispatch({ kind: "toggleEditorExpanded" }));
    expect(harness.result().agentModeActive).toBe(false);
    harness.unmount();
  });

  it("persists the layout into the workspace session", async () => {
    const harness = renderAgents();

    act(() =>
      harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "terminal" }),
    );
    await harness.settle();

    const saved = harness.persisted();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.rootPath).toBe(ROOT_A);
    expect(saved[0]?.settings.session.agentWorkbench).toEqual({
      layout: "agent",
      rightPanel: "open",
      openSurfaces: ["terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
      rail: "expanded",
      rightPanelWidth: 540,
      bottomPanelHeight: 280,
      bottomPanel: false,
    });
    harness.unmount();
  });

  it("persists the bottom panel visibility the controller owns", async () => {
    const harness = renderAgents({ bottomPanelVisible: false });

    harness.rerender({ bottomPanelVisible: true });
    await harness.settle();

    const saved = harness.persisted();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.rootPath).toBe(ROOT_A);
    expect(saved[0]?.settings.session.agentWorkbench?.bottomPanel).toBe(true);
    harness.unmount();
  });

  it("keeps the persisted bottom panel out of another workspace across A to B to A", async () => {
    const harness = renderAgents({ bottomPanelVisible: false });

    harness.rerender({ bottomPanelVisible: true });
    await harness.settle();
    expect(harness.persisted()).toHaveLength(1);

    harness.rerender({
      workspaceRoot: ROOT_B,
      editorSessionOwnerKey: ROOT_B,
      bottomPanelVisible: false,
      persistedAgentWorkbenchLayout: {
        ownerKey: ROOT_B,
        layout: normalizedAgentWorkbench(false),
      },
    });
    await harness.settle();
    expect(harness.result().agentWorkbench.persistedBottomPanel).toBe(false);

    harness.rerender({
      workspaceRoot: ROOT_A,
      editorSessionOwnerKey: ROOT_A,
      bottomPanelVisible: false,
      persistedAgentWorkbenchLayout: { ownerKey: ROOT_A, layout: normalizedAgentWorkbench(true) },
    });
    await harness.settle();

    expect(harness.result().agentWorkbench.persistedBottomPanel).toBe(true);
    expect(harness.persisted().map((entry) => entry.rootPath)).toEqual([ROOT_A]);
    harness.unmount();
  });

  it("hydrates workspace A and never leaks it into workspace B", async () => {
    const harness = renderAgents({
      persistedAgentWorkbenchLayout: {
        ownerKey: ROOT_A,
        layout: {
          layout: "agent",
          rightSurface: "diff",
          bottomPanel: true,
          rightPanelWidth: 700,
          bottomPanelHeight: 300,
        },
      },
    });
    await harness.settle();
    expect(harness.result().agentWorkbench.layout.activeSurface).toBe("diff");

    harness.rerender({
      workspaceRoot: ROOT_B,
      editorSessionOwnerKey: ROOT_B,
      persistedAgentWorkbenchLayout: null,
    });
    await harness.settle();
    expect(harness.result().agentWorkbench.layout.activeSurface).toBeNull();
    expect(harness.result().agentWorkbench.layout.rightPanelWidth).toBe(540);

    harness.rerender({
      workspaceRoot: ROOT_A,
      editorSessionOwnerKey: ROOT_A,
      persistedAgentWorkbenchLayout: {
        ownerKey: ROOT_A,
        layout: {
          layout: "agent",
          rightSurface: "diff",
          bottomPanel: true,
          rightPanelWidth: 700,
          bottomPanelHeight: 300,
        },
      },
    });
    await harness.settle();

    expect(harness.result().agentWorkbench.layout.activeSurface).toBe("diff");
    expect(harness.result().agentWorkbench.layout.rightPanelWidth).toBe(700);
    expect(harness.persisted()).toEqual([]);
    harness.unmount();
  });

  it("opens the files surface through the agent editor bridge", () => {
    const harness = renderAgents();

    act(() => harness.result().agentWorkbench.dispatch({ kind: "expandEditor" }));
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("editor-expanded");

    act(() => harness.result().agentWorkbench.dispatch({ kind: "collapseEditor" }));
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("agent");
    harness.unmount();
  });
});

function normalizedAgentWorkbench(bottomPanel: boolean): unknown {
  return normalizeWorkspaceSession({
    agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, bottomPanel),
    version: WORKSPACE_SESSION_VERSION,
  }).agentWorkbench;
}

interface HarnessOverrides {
  readonly bottomPanelVisible?: boolean;
  readonly workspaceRoot?: string | null;
  readonly editorSessionOwnerKey?: string | null;
  readonly withLeaseGateway?: boolean;
  readonly persistedAgentWorkbenchLayout?: WorkbenchControllerAgentsOptions["persistedAgentWorkbenchLayout"];
}

function renderAgents(overrides: HarnessOverrides = {}) {
  const persisted: Array<{ rootPath: string; settings: WorkspaceSettings }> = [];
  const workspaceSettingsRef = { current: defaultWorkspaceSettings() };
  const appSettingsRef = { current: defaultAppSettings() };
  const threadStore: AgentThreadStoreGateway = {
    loadAgentThreads: vi.fn(async () => ({ threads: [], unreadable: [], evicted: 0 })),
    saveAgentThread: vi.fn(async () => undefined),
    deleteAgentThread: vi.fn(async () => undefined),
  };
  const agentTaskGateway = {
    startAgentTask: vi.fn(async () => ({ taskId: "task" })),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async () => () => undefined),
    subscribeAgentTaskOutput: vi.fn(async () => () => undefined),
  } as unknown as AgentTaskGateway;
  const gitWorktreeGateway = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async () => ({
      worktreePath: "/ws/a/.worktrees/task",
      branch: "agent/task",
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  } as unknown as GitWorktreeGateway;
  const leaseGateway = {
    acquireAgentRootLease: vi.fn(async () => ({ leaseToken: 1 })),
    releaseAgentRootLease: vi.fn(async (request: { readonly leaseToken: number }) => ({
      kind: "released" as const,
      leaseToken: request.leaseToken,
    })),
  };
  const setWorkspaceTrust = vi.fn();
  const workspaceTrustRevisionByOwnerRef = { current: {} as Record<string, number> };
  const workspaceTrustIntentCoordinator = new WorkspaceTrustIntentCoordinator();
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
    probeAgentProviderHealth: vi.fn(async () => ({
      installedVersion: "1.0.0",
      auth: { kind: "unknown" as const },
      update: { kind: "checksDisabled" as const },
      checkedAtEpochMs: 1,
    })),
    updateAgentProvider: vi.fn(async () => ({
      kind: "failed" as const,
      reason: "admissionRefused" as const,
      outputTail: "",
      outputTruncated: false,
    })),
  };

  let options: WorkbenchControllerAgentsOptions = {
    applyAppSettings: (settings) => {
      appSettingsRef.current = settings;
    },
    agentThreadStoreGateway: threadStore,
    appSettingsRef,
    bottomPanelVisible: overrides.bottomPanelVisible ?? false,
    setBottomPanelView: vi.fn(),
    setBottomPanelVisible: vi.fn(),
    editorSessionOwnerKey: overrides.editorSessionOwnerKey ?? ROOT_A,
    options: {
      agentProviderGateway,
      agentRootLeaseGateway: overrides.withLeaseGateway === false ? undefined : leaseGateway,
      agentTaskGateway,
      gitWorktreeGateway,
    },
    openFileRef: { current: async () => true },
    openGitChange: async () => undefined,
    gitGateway: {
      getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getDiff: vi.fn(async () => Promise.reject(new Error("diff not stubbed"))),
      detectRepositories: vi.fn(async () => []),
      stageFiles: vi.fn(async () => Promise.reject(new Error("stage not stubbed"))),
      commit: vi.fn(async () => Promise.reject(new Error("commit not stubbed"))),
      deleteBranch: vi.fn(async () => Promise.reject(new Error("delete not stubbed"))),
    },
    gitRepositoryMappings: [],
    gitRepositoryStatuses: [],
    openDocuments: [],
    persistedAgentWorkbenchLayout: overrides.persistedAgentWorkbenchLayout ?? null,
    persistWorkspaceSettings: async (rootPath, settings) => {
      persisted.push({ rootPath, settings });
      workspaceSettingsRef.current = settings;
    },
    prompter: { confirm: () => true, prompt: () => null },
    reportError: vi.fn(),
    setSettingsInitialSection: vi.fn(),
    setSettingsOpen: vi.fn(),
    setWorkspaceTrust,
    settingsGateway: {
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async () => undefined),
    },
    workspaceIdentityByRootRef: { current: {} },
    workspaceIdentityDescriptor: { workspaceId: "workspace-a" },
    workspaceRoot: overrides.workspaceRoot === undefined ? ROOT_A : overrides.workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust: { rootPath: ROOT_A, trusted: true },
    workspaceTrustGateway: {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
    },
    terminalGateway: {
      stop: vi.fn(async (sessionId) => ({ kind: "stopped" as const, sessionId })),
    },
    workspaceTrustIntentCoordinatorRef: { current: workspaceTrustIntentCoordinator },
    workspaceTrustRevisionByOwnerRef,
  };

  let latestResult: WorkbenchControllerAgentsSurface | null = null;
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  function Harness() {
    latestResult = useWorkbenchControllerAgents(options);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    agentProviderGateway,
    persisted: () => persisted,
    result: getResult,
    setWorkspaceTrust,
    workspaceTrustIntentCoordinator,
    workspaceTrustRevisionByOwnerRef,
    rerender(next: Partial<WorkbenchControllerAgentsOptions>) {
      act(() => {
        options = { ...options, ...next };
        root.render(<Harness />);
      });
    },
    async settle() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount: () => act(() => root.unmount()),
  };

  function getResult(): WorkbenchControllerAgentsSurface {
    if (!latestResult) {
      throw new Error("workbench controller agents hook is not mounted");
    }
    return latestResult;
  }
}
