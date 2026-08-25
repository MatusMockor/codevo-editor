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
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";
import { AgentModeView } from "../components/agentMode/AgentModeView";
import { chromeFixture } from "../components/agentMode/agentWorkbenchChromeTestFixtures";
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

  it("starts in the agent layout and dispatches a thread through the real hook chain", async () => {
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
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
    expect(getWorkbench().agentWorkbench.effectiveLayout).toBe("agent");
    expect(getWorkbench().sidebarView).toBe("files");

    renderAgentMode(getWorkbench());
    const host = getPanelHost();
    expect(host.querySelector('section[aria-label="Agent mode"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="Agent threads"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="Search threads"]')).not.toBeNull();

    await typePrompt(host, "Fix the failing unit test.");
    await submitComposer(host);
    await flushAsyncTurns();

    expect(gitWorktreeGateway.added).toHaveLength(1);
    expect(gitWorktreeGateway.added[0]?.repositoryRoot).toBe("/workspace-a");
    expect(agentTaskGateway.started).toHaveLength(1);
    const started = agentTaskGateway.started[0];
    expect(started?.repositoryRoot).toBe("/workspace-a");
    expect(started?.workspaceId).toBe("workspace-a");
    expect(started?.isolation).toBe("worktree");
    const threadId = gitWorktreeGateway.added[0]?.taskId ?? "";
    expect(started?.taskId).not.toBe(threadId);
    expect(started?.cwd).toBe(`/workspace-a/.worktrees/${threadId}`);
    expect(started?.resumeSessionId).toBeNull();
    expect(started?.prompt).toBe("Fix the failing unit test.");
    expect(agentTaskGateway.acknowledged).toEqual([started?.taskId]);
    expect(getWorkbench().agents.threads).toHaveLength(1);
    expect(getWorkbench().agents.threads[0]?.thread.threadId).toBe(threadId);
    expect(getWorkbench().agents.threads[0]?.thread.turns[0]?.turnId).toBe(started?.taskId);
    expect(getWorkbench().agents.threads[0]?.lifecycle).toBe("running");

    renderAgentMode(getWorkbench());
    expect(host.textContent).toContain("Fix the failing unit test.");
  });

  it("expands the editor and collapses back to the agent layout", async () => {
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
      appSettings: {
        ...defaultAppSettings(),
        agentCliPath: "/usr/local/bin/claude",
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      workspaceIdentityGateway: identityGateway(),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "expandEditor" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(false));
    expect(getWorkbench().agentWorkbench.effectiveLayout).toBe("editor-expanded");

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "collapseEditor" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
  });

  it("keeps the previously selected sidebar view across an expand round trip", async () => {
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
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
      getWorkbench().setSidebarView("git");
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().sidebarView).toBe("git"));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "toggleEditorExpanded" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(false));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "toggleEditorExpanded" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
    expect(getWorkbench().sidebarView).toBe("git");
  });

  it("keeps the layout per workspace tab across A -> B -> A", async () => {
    const appSettings: AppSettings = {
      ...defaultAppSettings(),
      agentCliPath: "/usr/local/bin/claude",
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
      appSettings,
      settingsGateway: memorySettingsGateway(appSettings),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "expandEditor" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(false));

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(false));
  });

  function getPanelHost(): HTMLDivElement {
    expect(panelHost).not.toBeNull();
    return panelHost ?? document.createElement("div");
  }

  async function typePrompt(host: HTMLDivElement, value: string): Promise<void> {
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(textarea).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        value,
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submitComposer(host: HTMLDivElement): Promise<void> {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  function renderAgentMode(workbench: WorkbenchController): void {
    const mountedRoot = panelRoot;
    expect(mountedRoot).not.toBeNull();
    act(() => {
      mountedRoot?.render(
        <AgentModeView
          agents={workbench.agents}
          chrome={chromeFixture({ layout: workbench.agentWorkbench })}
          onReleaseProject={(projectRootKey) =>
            void workbench.agents.agentProjects.releaseProject(projectRootKey)
          }
          onTrustProject={(projectRootKey) =>
            void workbench.agents.agentProjects.trustProject(projectRootKey)
          }
          overflowRootPaths={workbench.agents.agentProjects.overflowRootPaths}
          projects={workbench.agents.agentProjects.projects}
          workspaceRoot={workbench.workspaceRoot}
        />,
      );
    });
  }
});

function memorySettingsGateway(appSettings: AppSettings): SettingsGateway {
  const workspaceSettingsByIdentity = new Map<string, WorkspaceSettings>();
  const key = (identity: string | WorkspaceSettingsIdentity): string => JSON.stringify(identity);
  return {
    loadAppSettings: async () => appSettings,
    saveAppSettings: async () => undefined,
    loadWorkspaceSettings: async (identity) =>
      workspaceSettingsByIdentity.get(key(identity)) ?? defaultWorkspaceSettings(),
    saveWorkspaceSettings: async (identity, settings) => {
      workspaceSettingsByIdentity.set(key(identity), settings);
    },
  };
}

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
