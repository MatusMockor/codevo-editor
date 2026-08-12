// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import type { AgentWorktreeReceipt, GitWorktreeGateway } from "../domain/gitWorktree";
import { defaultAppSettings } from "../domain/settings";
import { WorkbenchSidebar } from "../components/WorkbenchSidebar";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
} from "../test/workbenchControllerTestHarness";
import type {
  NativeWorkspaceDescriptor,
  WorkspaceIdentityDescriptor,
} from "./workspaceIdentityGatewayPort";
import type { WorkspaceIdentityDescriptorResolver } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { WorkbenchWorkspaceGateways } from "./workbenchControllerContracts";

describe("workbench agents production chain", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
  let panelHost: HTMLDivElement | null = null;
  let panelRoot: Root | null = null;

  beforeEach(() => {
    panelHost = document.createElement("div");
    document.body.append(panelHost);
    panelRoot = createRoot(panelHost);
  });

  afterEach(async () => {
    const mountedRoot = panelRoot;
    const mountedHost = panelHost;
    panelRoot = null;
    panelHost = null;
    if (mountedRoot) {
      await act(async () => {
        mountedRoot.unmount();
        await Promise.resolve();
      });
    }
    mountedHost?.remove();
  });

  it("renders the Agents sidebar tab and dispatch reaches the gateway through the real hook chain", async () => {
    const agentTaskGateway = fakeAgentTaskGateway();
    const gitWorktreeGateway = fakeGitWorktreeGateway();
    const { getWorkbench } = renderController({
      agentTaskGateway: agentTaskGateway.gateway,
      gitWorktreeGateway: gitWorktreeGateway.gateway,
      appSettings: {
        ...defaultAppSettings(),
        agentCliPath: "/usr/local/bin/claude",
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      workspaceIdentityGateway: identityGateway(),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));

    await act(async () => {
      getWorkbench().setSidebarView("agents");
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().sidebarView).toBe("agents"));

    renderSidebar(getWorkbench());
    const host = getPanelHost();
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map(
      (tab) => tab.textContent ?? "",
    );
    expect(tabs).toContain("Agents");
    expect(host.querySelector('section[aria-label="Agents"]')).not.toBeNull();

    let dispatched = false;
    await act(async () => {
      dispatched = await getWorkbench().agents.dispatch({
        repositoryRoot: "/workspace-a",
        prompt: "Fix the failing unit test.",
        isolation: "worktree",
        unsafeInPlaceConfirmed: false,
      });
    });
    await flushAsyncTurns();

    expect(dispatched).toBe(true);
    expect(gitWorktreeGateway.added).toHaveLength(1);
    expect(gitWorktreeGateway.added[0]?.repositoryRoot).toBe("/workspace-a");
    expect(agentTaskGateway.started).toHaveLength(1);
    const started = agentTaskGateway.started[0];
    expect(started.repositoryRoot).toBe("/workspace-a");
    expect(started.workspaceId).toBe("workspace-a");
    expect(started.isolation).toBe("worktree");
    expect(started.cwd).toBe(`/workspace-a/.worktrees/${started.taskId}`);
    expect(started.prompt).toBe("Fix the failing unit test.");
    expect(agentTaskGateway.acknowledged).toEqual([started.taskId]);
    expect(getWorkbench().agents.tasks).toHaveLength(1);
    expect(getWorkbench().agents.tasks[0]?.record.owner.taskId).toBe(started.taskId);
  });

  function getPanelHost(): HTMLDivElement {
    if (!panelHost) {
      throw new Error("Panel host was not mounted.");
    }
    return panelHost;
  }

  function renderSidebar(workbench: WorkbenchController): void {
    const mountedRoot = panelRoot;
    if (!mountedRoot) {
      throw new Error("Panel root was not mounted.");
    }
    act(() => {
      mountedRoot.render(
        <WorkbenchSidebar
          activeFileRevealSignal={0}
          fileStatusesByPath={{}}
          onOpenWorkspace={() => undefined}
          onResizeStart={() => undefined}
          onShowGit={() => undefined}
          workbench={workbench}
        />,
      );
    });
  }
});

function fakeAgentTaskGateway(): {
  gateway: AgentTaskGateway;
  started: StartAgentTaskRequest[];
  acknowledged: string[];
} {
  const started: StartAgentTaskRequest[] = [];
  const acknowledged: string[] = [];
  const gateway: AgentTaskGateway = {
    startAgentTask: async (request) => {
      started.push(request);
      return { taskId: request.taskId };
    },
    acknowledgeAgentTaskStart: async (request) => {
      acknowledged.push(request.taskId);
    },
    stopAgentTask: async () => undefined,
    stopAgentTasksForRoot: async () => undefined,
    subscribeAgentTaskStatus: async (_handler: (event: AgentTaskStatusEvent) => void) => () =>
      undefined,
    subscribeAgentTaskOutput: async (_handler: (event: AgentTaskOutputEvent) => void) => () =>
      undefined,
  };
  return { gateway, started, acknowledged };
}

function fakeGitWorktreeGateway(): {
  gateway: GitWorktreeGateway;
  added: Array<{ repositoryRoot: string; taskId: string }>;
} {
  const added: Array<{ repositoryRoot: string; taskId: string }> = [];
  const gateway: GitWorktreeGateway = {
    listWorktrees: async () => [],
    addAgentWorktree: async (repositoryRoot, taskId): Promise<AgentWorktreeReceipt> => {
      added.push({ repositoryRoot, taskId });
      return {
        worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
        branch: `agent/${taskId}`,
        trusted: true,
      };
    },
    removeWorktree: async () => undefined,
    pruneWorktrees: async () => [],
  };
  return { gateway, added };
}

function identityGateway(): WorkbenchWorkspaceGateways["identity"] &
  WorkspaceIdentityDescriptorResolver {
  const descriptors = new Map<string, WorkspaceIdentityDescriptor>();
  return {
    descriptorForPath: (path) => match(path, descriptors)?.descriptor ?? null,
    getDescriptor: vi.fn(async () => nativeDescriptor(workspaceDescriptorA())),
    matchForPath: (path, workspaceId) => {
      const resolved = match(path, descriptors, workspaceId);
      if (!resolved) {
        return null;
      }
      return {
        descriptor: resolved.descriptor,
        matchedRoot: resolved.descriptor.selectedPath,
        relativePath: resolved.relativePath,
      };
    },
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async () => {
      const resolved = workspaceDescriptorA();
      descriptors.set(resolved.workspaceId, resolved);
      return resolved;
    }),
    unregister: vi.fn(async () => undefined),
  };
}

function match(
  path: string,
  descriptors: ReadonlyMap<string, WorkspaceIdentityDescriptor>,
  workspaceId?: string,
): { descriptor: WorkspaceIdentityDescriptor; relativePath: string } | null {
  for (const descriptor of descriptors.values()) {
    if (
      (!workspaceId || descriptor.workspaceId === workspaceId) &&
      (path === descriptor.selectedPath || path.startsWith(`${descriptor.selectedPath}/`))
    ) {
      return {
        descriptor,
        relativePath:
          path === descriptor.selectedPath ? "" : path.slice(descriptor.selectedPath.length + 1),
      };
    }
  }
  return null;
}

function workspaceDescriptorA(): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot: "/workspace-a",
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath: "/workspace-a",
    unicodeNormalizationPolicy: "preserved",
    workspaceId: "workspace-a",
  };
}

function nativeDescriptor(value: WorkspaceIdentityDescriptor): NativeWorkspaceDescriptor {
  return {
    canonicalRootPath: value.canonicalRoot,
    caseSensitive: value.caseSensitive,
    selectedRootPath: value.selectedPath,
    unicodeNormalizationPolicy: value.unicodeNormalizationPolicy,
    workspaceId: value.workspaceId,
  };
}
