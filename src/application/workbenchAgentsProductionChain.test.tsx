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
import { emptyGitStatus, type GitGateway } from "../domain/git";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";
import { AgentModeView } from "../components/agentMode/AgentModeView";
import { useAgentModelFavorites } from "./useAgentModelFavorites";
import { normalizeAgentModelFavoriteKeys } from "../domain/agentSettings";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
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
import type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";

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
    const agentProviderGateway = fakeAgentProviderGateway();
    const gitWorktreeGateway = fakeGitWorktreeGateway();
    const { getWorkbench } = renderController({
      agentTaskGateway: agentTaskGateway.gateway,
      agentProviderGateway,
      gitGateway: cleanRepositoryGitGateway(),
      gitWorktreeGateway: gitWorktreeGateway.gateway,
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      workspaceIdentityGateway: identityGateway(),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
    await waitForReact(() =>
      expect(getWorkbench().agents.providerManagement.authority("claudeCode")).not.toBeNull(),
    );
    await act(async () => {
      await expect(getWorkbench().agents.refreshIsolationStatus("/workspace-a")).resolves.toEqual(
        expect.objectContaining({ kind: "ready" }),
      );
    });
    await waitForReact(() =>
      expect(getWorkbench().agents.isolationPreview("/workspace-a").repositoryStatus?.kind).toBe(
        "ready",
      ),
    );
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
    expect(started?.agentCliKind).toBe("claudeCode");
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

  it("rolls a favorite back when the real app-settings persistence command rejects", async () => {
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a"],
    };
    const settingsGateway = memorySettingsGateway(appSettings);
    let rejectFavoriteSave: ((error: unknown) => void) | null = null;
    const saveAppSettings = vi.fn(async (settings: AppSettings) => {
      if (settings.agentModelFavoritesRevision === 0) return;
      if (rejectFavoriteSave !== null) return;
      await new Promise<void>((_resolve, reject) => {
        rejectFavoriteSave = reject;
      });
    });
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
      appSettings,
      settingsGateway: { ...settingsGateway, saveAppSettings },
      workspaceIdentityGateway: identityGateway(["workspace-owner-a", "workspace-owner-b"]),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    let favorite = false;

    function FavoriteProbe() {
      const favorites = useAgentModelFavorites({
        keys: getWorkbench().appSettings.agentModelFavoriteKeys,
        revision: getWorkbench().appSettings.agentModelFavoritesRevision,
        save: async (keys, revision) => {
          const workbench = getWorkbench();
          await workbench.saveWorkbenchSettings(
            {
              ...workbench.appSettings,
              agentModelFavoriteKeys: normalizeAgentModelFavoriteKeys(keys),
              agentModelFavoritesRevision: revision,
            },
            workbench.workspaceSettings,
            workbench.workspaceTrust?.trusted ?? null,
            "reportAndReject",
          );
        },
      });
      favorite = favorites.isFavorite("claudeCode/opus");
      return (
        <button onClick={() => favorites.toggle("claudeCode/opus")} type="button">
          Toggle favorite
        </button>
      );
    }

    act(() => panelRoot?.render(<FavoriteProbe />));
    await act(async () => {
      getPanelHost().querySelector("button")?.click();
      await flushAsyncTurns();
    });
    expect(favorite).toBe(true);
    let reopenWorkspace!: Promise<boolean>;
    act(() => {
      reopenWorkspace = getWorkbench().openWorkspaceRoot("/workspace-a");
    });
    await act(async () => Promise.resolve());
    expect(rejectFavoriteSave).not.toBeNull();
    await act(async () => {
      rejectFavoriteSave?.(new Error("settings unavailable"));
      await reopenWorkspace;
      await flushAsyncTurns();
    });
    expect(getWorkbench().workspaceIdentityDescriptor?.workspaceId).toBe("workspace-owner-b");

    expect(saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: 1,
      }),
    );
    expect(favorite).toBe(false);
    expect(getWorkbench().appSettings.agentModelFavoriteKeys).toEqual([]);
    expect(getWorkbench().appSettings.agentModelFavoritesRevision).toBe(0);
  });

  it("opens and closes the editor inside the agent right panel", async () => {
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      workspaceIdentityGateway: identityGateway(),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentWorkbench.layout.rightPanel).toBe("open"));
    expect(getWorkbench().agentWorkbench.effectiveLayout).toBe("agent");
    expect(getWorkbench().agentWorkbench.layout.activeSurface).toBe("files");

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "toggleRightPanel" });
      await Promise.resolve();
    });
    await waitForReact(() =>
      expect(getWorkbench().agentWorkbench.layout.rightPanel).toBe("closed"),
    );
    expect(getWorkbench().agentModeActive).toBe(true);
  });

  it("keeps the previously selected sidebar view across a panel round trip", async () => {
    const { getWorkbench } = renderController({
      agentTaskGateway: fakeAgentTaskGateway().gateway,
      gitWorktreeGateway: fakeGitWorktreeGateway().gateway,
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
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
      getWorkbench().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentWorkbench.layout.rightPanel).toBe("open"));

    await act(async () => {
      getWorkbench().agentWorkbench.dispatch({ kind: "toggleRightPanel" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
    expect(getWorkbench().sidebarView).toBe("git");
  });

  it("starts each workspace tab in the agent layout across A -> B -> A", async () => {
    const appSettings: AppSettings = {
      ...defaultAppSettings(),
      agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
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
      getWorkbench().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
      await Promise.resolve();
    });
    await waitForReact(() => expect(getWorkbench().agentWorkbench.layout.rightPanel).toBe("open"));

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
    await waitForReact(() => expect(getWorkbench().agentModeActive).toBe(true));
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
    const preferences =
      workbench.appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
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
          providerEnabled={{
            claudeCode: preferences.claudeCode.enabled,
            codex: preferences.codex.enabled,
          }}
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

function fakeAgentProviderGateway(): NonNullable<
  WorkbenchControllerOptions["agentProviderGateway"]
> {
  return {
    currentAgentProviderPolicy: async ({ provider }) => ({ kind: "unregistered", provider }),
    registerAgentProviderPolicy: async (request) => ({
      provider: request.provider,
      settingsRevision: request.settingsRevision,
      providerGeneration: 1,
    }),
    probeAgentProviderHealth: async () => ({
      installedVersion: "1.0.0",
      auth: { kind: "unknown" },
      update: { kind: "checksDisabled" },
      checkedAtEpochMs: 1,
    }),
    updateAgentProvider: async () => ({
      kind: "failed",
      reason: "admissionRefused",
      outputTail: "",
      outputTruncated: false,
    }),
  };
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

function cleanRepositoryGitGateway(): GitGateway {
  const status = (rootPath: string) => ({
    ...emptyGitStatus(rootPath),
    branch: "main",
    isRepository: true,
  });
  return {
    blame: vi.fn(async () => []),
    branchList: vi.fn(async () => []),
    commit: vi.fn(async (rootPath) => status(rootPath)),
    createBranch: vi.fn(async () => undefined),
    currentBranch: vi.fn(async () => "main"),
    fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: relativePath,
        relativePath,
        status: "modified" as const,
      },
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
    })),
    fileHistory: vi.fn(async () => []),
    getDiff: vi.fn(async (_rootPath, change) => ({
      change,
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
    })),
    getFileHunks: vi.fn(async () => []),
    getStatus: vi.fn(async (rootPath) => status(rootPath)),
    push: vi.fn(async (rootPath) => status(rootPath)),
    revertFiles: vi.fn(async (rootPath) => status(rootPath)),
    stageFiles: vi.fn(async (rootPath) => status(rootPath)),
    stageHunk: vi.fn(async (rootPath) => status(rootPath)),
    stashApply: vi.fn(async () => undefined),
    stashDrop: vi.fn(async () => undefined),
    stashList: vi.fn(async () => []),
    stashPop: vi.fn(async () => undefined),
    stashSave: vi.fn(async () => undefined),
    stashShow: vi.fn(async () => ""),
    switchBranch: vi.fn(async () => undefined),
    unstageFiles: vi.fn(async (rootPath) => status(rootPath)),
    unstageHunk: vi.fn(async (rootPath) => status(rootPath)),
  };
}

function identityGateway(
  workspaceIds: ReadonlyArray<string> = ["workspace-a"],
): WorkbenchWorkspaceGateways["identity"] & WorkspaceIdentityDescriptorResolver {
  const descriptors = new Map<string, WorkspaceIdentityDescriptor>();
  let opened = 0;
  const nextDescriptor = (): WorkspaceIdentityDescriptor => ({
    ...workspaceDescriptorA(),
    workspaceId: workspaceIds[Math.min(opened, workspaceIds.length - 1)] ?? "workspace-a",
  });
  return {
    descriptorForPath: (path) => match(path, descriptors)?.descriptor ?? null,
    getDescriptor: vi.fn(async () => nativeDescriptor(nextDescriptor())),
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
      const resolved = nextDescriptor();
      opened += 1;
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
