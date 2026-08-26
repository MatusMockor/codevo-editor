// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type WorkspaceSettings,
} from "../domain/settings";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import {
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

describe("useWorkbenchControllerAgents layout surface", () => {
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
      bottomPanel: false,
      rightPanelWidth: 540,
      bottomPanelHeight: 280,
    });
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

interface HarnessOverrides {
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
    releaseAgentRootLease: vi.fn(async () => undefined),
  };

  let options: WorkbenchControllerAgentsOptions = {
    agentThreadStoreGateway: threadStore,
    appSettingsRef,
    editorSessionOwnerKey: overrides.editorSessionOwnerKey ?? ROOT_A,
    options: {
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
    settingsGateway: { loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()) },
    workspaceIdentityByRootRef: { current: {} },
    workspaceIdentityDescriptor: { workspaceId: "workspace-a" },
    workspaceRoot: overrides.workspaceRoot === undefined ? ROOT_A : overrides.workspaceRoot,
    workspaceSettingsRef,
    workspaceTrustGateway: {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
    },
  };

  let latestResult: WorkbenchControllerAgentsSurface | null = null;
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  function Harness() {
    latestResult = useWorkbenchControllerAgents(options);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    persisted: () => persisted,
    result: getResult,
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
