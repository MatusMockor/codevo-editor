// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentWorkbenchLayout } from "../../application/useAgentWorkbenchLayout";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { agentWorkbenchHydration } from "../../application/useWorkbenchControllerAgents";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import {
  defaultAgentProviderPreferences,
  type PersistedAgentProviderSettingsAuthority,
} from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import {
  initialAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import {
  defaultAppSettings,
  normalizeWorkspaceSettings,
  terminalThemeForAppTheme,
  WORKSPACE_SESSION_VERSION,
} from "../../domain/settings";
import type {
  RevealPathGateway,
  RevealPathRequest,
} from "../../infrastructure/tauriRevealPathGateway";
import {
  recordedLayoutState,
  type RecordedAgentWorkbenchLayout,
} from "./agentWorkbenchChromeTestFixtures";
import {
  ADD_PROJECT_REFUSED_REASON,
  AgentWorkbenchScreen,
  type AgentWorkbenchScreenProps,
  type AgentWorkbenchScreenWorkbench,
} from "./AgentWorkbenchScreen";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/api";

describe("AgentWorkbenchScreen", () => {
  let host: HTMLDivElement;
  let root: Root;
  let reveals: RevealPathRequest[];
  let revealPathGateway: RevealPathGateway;
  let directoryListingGateway: DirectoryListingGateway;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    reveals = [];
    revealPathGateway = {
      revealPath: async (request) => {
        reveals.push(request);
      },
    };
    directoryListingGateway = {
      listDirectoryEntries: async () => ({
        path: "/Users/dev",
        parent: "/Users",
        entries: [{ name: "Developer", kind: "directory", hidden: false }],
        truncated: false,
      }),
      revealDirectory: async () => undefined,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("resets the view state on a workspace A -> B -> A switch", () => {
    render(createWorkbench(ROOT_A));

    click('[data-thread-id="agt-1"]');
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();

    render(createWorkbench(ROOT_B));
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();

    render(createWorkbench(ROOT_A));
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
  });

  it("projects the workbench scripts and keymap onto the thread header controls", () => {
    render(createWorkbench(ROOT_A));
    click('[data-thread-id="agt-1"]');

    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="dev (running elsewhere)"]'),
    ).not.toBeNull();
    expect(host.querySelector('button[aria-label="Toggle terminal panel (⌘J)"]')).not.toBeNull();
  });

  it("keeps provider runtime UI on persisted authority until registration succeeds", () => {
    const preferences = defaultAgentProviderPreferences();
    const initialPreferences = {
      ...preferences,
      codex: { ...preferences.codex, enabled: false },
    };
    let authorities: Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>> = {
      claudeCode: providerAuthority("claudeCode", 1, true),
      codex: providerAuthority("codex", 1, false),
    };
    let selectedProviderAuthority: AgentProviderManagementSurface["selectedProviderAuthority"] = {
      settingsRevision: 1,
      provider: "claudeCode",
    };
    const management = providerManagement({
      authority: (provider) => authorities[provider] ?? null,
      admissionAuthority: (provider) => ({
        provider,
        revision: 1,
        disposition: { kind: "ready" },
        cliPath: `/usr/local/bin/${provider}`,
        providerGeneration: 1,
      }),
    });
    Object.defineProperty(management, "selectedProviderAuthority", {
      get: () => selectedProviderAuthority,
    });
    const persistedAgents = {
      ...surface(ROOT_A),
      agentCliKind: "claudeCode" as const,
      providerManagement: management,
    };
    const persistedSettings = {
      ...defaultAppSettings(),
      agentCliKind: "claudeCode" as const,
      agentProviderPreferences: initialPreferences,
    };

    render(createWorkbench(ROOT_A, { agents: persistedAgents, appSettings: persistedSettings }));

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("Claude (default)");
    expect(prompt().disabled).toBe(false);
    click('button[aria-label="Agent model"]');
    expect(host.querySelector('button[aria-label="Claude Code models"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Codex models"]')).toBeNull();

    authorities = {};
    const pendingPreferences = {
      ...initialPreferences,
      claudeCode: { ...initialPreferences.claudeCode, enabled: false },
    };
    const pendingAgents = { ...persistedAgents, agentCliKind: "codex" as const };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("Claude (default)");
    expect(modelPicker().disabled).toBe(false);
    expect(prompt().disabled).toBe(false);
    expect(host.querySelector('button[aria-label="Claude Code models"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Codex models"]')).toBeNull();

    authorities = {
      claudeCode: providerAuthority("claudeCode", 2, true),
      codex: providerAuthority("codex", 1, false),
    };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(modelPicker().textContent).toContain("Claude (default)");
    expect(prompt().disabled).toBe(false);

    selectedProviderAuthority = { settingsRevision: 3, provider: "codex" };
    authorities = {
      claudeCode: providerAuthority("claudeCode", 2, false),
      codex: providerAuthority("codex", 1, false),
    };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(providerFooter("claudeCode")).toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("Codex (default)");
    expect(modelPicker().disabled).toBe(true);
    expect(prompt().disabled).toBe(true);

    selectedProviderAuthority = null;
    authorities = {};
    render(
      createWorkbench(ROOT_A, {
        agents: persistedAgents,
        appSettings: persistedSettings,
      }),
    );

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(modelPicker().textContent).toContain("Claude (default)");
    expect(prompt().disabled).toBe(false);
  });

  it("toggles the bottom panel through the controller authority only", () => {
    const layout = recordedLayoutState();
    const hidden = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false });
    render(hidden);

    click('button[aria-label="Toggle terminal panel (⌘J)"]');
    expect(hidden.showBottomPanelView).toHaveBeenCalledWith("terminal");
    expect(hidden.hideBottomPanel).not.toHaveBeenCalled();

    const visible = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: true });
    render(visible);
    click('button[aria-label="Toggle terminal panel (⌘J)"]');
    expect(visible.hideBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("opens the terminal view when the controller shows the panel in the agent layout", () => {
    const layout = recordedLayoutState();
    render(createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false }));

    const opened = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: true });
    render(opened);
    expect(opened.showBottomPanelView).toHaveBeenCalledWith("terminal");

    const closed = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false });
    render(closed);
    expect(closed.showBottomPanelView).not.toHaveBeenCalled();
    expect(layout.actions).toEqual([]);
  });

  it("keeps a view the controller opened together with the panel", () => {
    const layout = recordedLayoutState();
    render(createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false }));

    const problems = createWorkbench(ROOT_A, {
      agentWorkbench: layout,
      bottomPanelView: "problems",
      bottomPanelVisible: true,
    });
    render({ ...problems, bottomPanelView: "terminal" });
    expect(problems.showBottomPanelView).not.toHaveBeenCalled();
  });

  it("applies a persisted open bottom panel once at hydration", () => {
    const layout = recordedLayoutState();
    const workbench = createWorkbench(ROOT_A, {
      agentWorkbench: layout,
      bottomPanelVisible: false,
    });
    render(workbench);
    expect(workbench.showBottomPanelView).not.toHaveBeenCalled();

    const hydrated = createWorkbench(ROOT_A, {
      agentWorkbench: recordedLayoutState({}, true),
      bottomPanelVisible: false,
    });
    render(hydrated);
    expect(hydrated.showBottomPanelView).toHaveBeenCalledWith("terminal");

    const settled = createWorkbench(ROOT_A, {
      agentWorkbench: recordedLayoutState({}, true),
      bottomPanelView: "terminal",
      bottomPanelVisible: true,
    });
    render(settled);
    render({ ...settled, bottomPanelVisible: false });
    render({ ...settled, bottomPanelVisible: false });
    expect(settled.showBottomPanelView).not.toHaveBeenCalled();
    expect(layout.actions).toEqual([]);
  });

  it("restores the persisted terminal panel from the normalized workspace settings", async () => {
    const settings = normalizeWorkspaceSettings({
      session: {
        version: WORKSPACE_SESSION_VERSION,
        agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
      },
    });
    expect(settings.session.agentWorkbench?.bottomPanel).toBe(true);

    const workbench = createWorkbench(ROOT_A, { bottomPanelVisible: false });
    function Hydrated({ terminalShown }: { readonly terminalShown: boolean }) {
      const { agentWorkbench } = useAgentWorkbenchLayout({
        workspaceOwnerKey: ROOT_A,
        hasWorkspace: true,
        bottomPanelVisible: terminalShown,
        hydration: agentWorkbenchHydration(ROOT_A, settings),
      });
      return (
        <AgentWorkbenchScreen
          {...defaultProps({
            ...workbench,
            agentWorkbench,
            bottomPanelView: terminalShown ? "terminal" : "problems",
            bottomPanelVisible: terminalShown,
          })}
        />
      );
    }

    await act(async () => root.render(<Hydrated terminalShown={false} />));

    expect(workbench.showBottomPanelView).toHaveBeenCalledTimes(1);
    expect(workbench.showBottomPanelView).toHaveBeenCalledWith("terminal");

    await act(async () => root.render(<Hydrated terminalShown={true} />));
    await act(async () => root.render(<Hydrated terminalShown={true} />));

    expect(workbench.showBottomPanelView).toHaveBeenCalledTimes(1);
  });

  it("does not leak a persisted open panel across a workspace switch", () => {
    render(
      createWorkbench(ROOT_A, {
        agentWorkbench: recordedLayoutState({}, true),
        bottomPanelVisible: true,
      }),
    );

    const other = createWorkbench(ROOT_B, {
      agentWorkbench: recordedLayoutState(),
      bottomPanelVisible: true,
    });
    render(other);

    expect(other.showBottomPanelView).not.toHaveBeenCalled();
  });

  it("expands the editor with the scripts sidebar from the scripts menu", async () => {
    const layout = recordedLayoutState();
    const workbench = createWorkbench(ROOT_A, { agentWorkbench: layout });
    render(workbench);
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Choose a script"]');
    await act(async () => {});
    clickMenuItem("Open Scripts and Tasks");

    expect(layout.actions).toContainEqual({ kind: "expandEditor" });
    expect(workbench.setSidebarView).toHaveBeenCalledWith("scripts");
  });

  it("reveals a worktree path through the injected gateway", async () => {
    render(createWorkbench(ROOT_A));
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Open options"]');
    await act(async () => {});
    clickMenuItem("Reveal in Finder");
    await act(async () => {});

    expect(reveals).toEqual([{ rootPath: ROOT_A, path: ROOT_A }]);
  });

  it("reports a reveal outside the project roots in the notice bar", async () => {
    render(createWorkbench(ROOT_A, { agents: surface(ROOT_A, "/elsewhere/agt-1") }));
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Open options"]');
    await act(async () => {});
    clickMenuItem("Reveal in Finder");
    await act(async () => {});

    expect(reveals).toEqual([]);
    expect(host.textContent).toContain("Unable to reveal that path in the file manager.");
  });

  it("opens the browsed directory through the workspace open flow", async () => {
    const workbench = createWorkbench(ROOT_A);
    render(workbench);

    click('button[aria-label="Add project"]');
    await act(async () => {});

    const input = host.querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
      );
    });

    expect(workbench.openWorkspaceRoot).toHaveBeenCalledWith("/Users/dev");
  });

  it("reports the refusal when the workspace open flow declines the directory", async () => {
    const workbench = createWorkbench(ROOT_A, { openWorkspaceRoot: vi.fn(async () => false) });
    render(workbench);

    click('button[aria-label="Add project"]');
    await act(async () => {});

    const input = host.querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
      );
    });
    await act(async () => {});

    expect(workbench.openWorkspaceRoot).toHaveBeenCalledWith("/Users/dev");
    expect(host.textContent).toContain(ADD_PROJECT_REFUSED_REASON);
  });

  function render(workbench: AgentWorkbenchScreenWorkbench): void {
    act(() => root.render(<AgentWorkbenchScreen {...defaultProps(workbench)} />));
  }

  function defaultProps(workbench: AgentWorkbenchScreenWorkbench): AgentWorkbenchScreenProps {
    return { ...baseProps(workbench), directoryListingGateway, revealPathGateway };
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }

  function modelPicker(): HTMLButtonElement {
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Agent model"]');
    expect(picker).not.toBeNull();
    return picker!;
  }

  function prompt(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>("#agent-prompt");
    expect(textarea).not.toBeNull();
    return textarea!;
  }

  function providerFooter(provider: AgentCliKind): HTMLElement | null {
    return host.querySelector(`[data-provider="${provider}"]`);
  }

  function clickMenuItem(label: string): void {
    const item = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item, `Missing menu item ${label}`).not.toBeUndefined();
    act(() => item?.click());
  }
});

function baseProps(workbench: AgentWorkbenchScreenWorkbench): AgentWorkbenchScreenProps {
  return {
    activeFileRevealSignal: 0,
    fileChanges: null,
    fileStatusesByPath: {},
    files: { readDirectory: async () => [] },
    monacoTheme: "calm-dark",
    onResizeRightPanelStart: () => undefined,
    onTrustWorkspace: () => undefined,
    terminalGateway: {
      acknowledgeStart: async () => undefined,
      listProfiles: async () => [],
      resize: async () => undefined,
      start: async () => ({ kind: "starting", sessionId: 1 }),
      stop: async (sessionId) => ({ kind: "stopped", sessionId }),
      stopRoot: async () => undefined,
      stopAll: async () => undefined,
      subscribeOutput: async () => () => undefined,
      writeInput: async () => undefined,
    },
    terminalTheme: terminalThemeForAppTheme("dark"),
    workbench,
    workspaceTrusted: true,
  };
}

type MockedWorkbench = AgentWorkbenchScreenWorkbench & {
  readonly openWorkspaceRoot: ReturnType<typeof vi.fn>;
  readonly agentWorkbench: RecordedAgentWorkbenchLayout;
  readonly hideBottomPanel: ReturnType<typeof vi.fn>;
  readonly setSidebarView: ReturnType<typeof vi.fn>;
  readonly showBottomPanelView: ReturnType<typeof vi.fn>;
};

function createWorkbench(
  workspaceRoot: string,
  overrides: Partial<AgentWorkbenchScreenWorkbench> = {},
): MockedWorkbench {
  const nodePackageScripts = {
    scripts: [
      {
        key: "package.json:dev",
        manifestRelativePath: "package.json",
        packageName: "app",
        packageManager: "npm",
        packageRootRelativePath: "",
        scriptName: "dev",
      },
    ],
    truncated: false,
    available: true,
    error: null,
    pending: true,
    task: {
      runId: "run-1",
      workspaceId: "workspace-app",
      manifestRelativePath: "package.json",
      scriptName: "dev",
      status: "acquiring-terminal",
      sessionId: null,
    },
    run: vi.fn(() => true),
    stop: vi.fn(),
  } as unknown as AgentWorkbenchScreenWorkbench["nodePackageScripts"];

  return {
    activePath: null,
    agentWorkbench: recordedLayoutState(),
    agents: surface(workspaceRoot),
    appSettings: defaultAppSettings(),
    bottomPanelView: "problems",
    bottomPanelVisible: false,
    hideBottomPanel: vi.fn(),
    nodePackageScripts,
    openPinnedFile: vi.fn(),
    openProblemNotice: vi.fn(async () => true),
    openWorkspaceRoot: vi.fn(async () => true),
    previewFile: vi.fn(),
    setSidebarView: vi.fn(),
    showBottomPanelView: vi.fn(),
    workspaceIdentityDescriptor: {
      canonicalRoot: workspaceRoot,
      caseSensitive: true,
      selectedPath: workspaceRoot,
      unicodeNormalizationPolicy: "preserved",
      workspaceId: "workspace-app",
    } as AgentWorkbenchScreenWorkbench["workspaceIdentityDescriptor"],
    workspaceRoot,
    ...overrides,
  } as MockedWorkbench;
}

function surface(
  workspaceRoot: string,
  worktreePath: string | null = null,
): WorkbenchAgentsSurface {
  return {
    ...threadsSurface(workspaceRoot, worktreePath),
    providerManagement: providerManagement(),
    agentProjects: {
      projects: [project(workspaceRoot)],
      overflowRootPaths: [],
      refreshProject: async () => undefined,
      trustProject: async () => undefined,
      releaseProject: async () => undefined,
      ensureProjectLease: async () => true,
      launchIdentityForProject: () => ({ workspaceId: "workspace-id", generation: 1 }),
      noteDispatchTrustRejected: () => undefined,
    },
  };
}

function providerManagement(
  overrides: Partial<AgentProviderManagementSurface> = {},
): AgentProviderManagementSurface {
  return {
    providers: {
      claudeCode: {
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 0,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    }),
    authority: () => null,
    dismissToast: () => undefined,
    dismissUpdate: async () => false,
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
    ...overrides,
  };
}

function providerAuthority(
  provider: AgentCliKind,
  settingsRevision: number,
  enabled: boolean,
): PersistedAgentProviderSettingsAuthority {
  return {
    provider,
    settingsRevision,
    preference: {
      enabled,
      healthCheckIntervalSeconds: 300,
      checkForUpdates: false,
      dismissedUpdateVersion: null,
    },
    cliPath: `/usr/local/bin/${provider}`,
  };
}

function project(root: string): AgentProjectDescriptor {
  return {
    rootKey: root,
    rootPath: root,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: root, repositoryRelativePath: "" },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function threadsSurface(root: string, worktreePath: string | null): AgentThreadsSurface {
  return {
    threads: [threadView(root, worktreePath)],
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: root, repositoryRelativePath: "" },
    ],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    agentCliKind: "claudeCode",
    agentCliVersion: null,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    pendingTurnCount: () => 0,
    isolationPreview: (repositoryRoot: string) => ({
      repositoryRoot,
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: true,
      confirmationKey: null,
    }),
    refreshIsolationStatus: async () => undefined,
    startThread: async () => ({ threadId: "agt-default" }),
    sendFollowUp: async () => true,
    stop: async () => undefined,
    togglePin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
    hasLiveTasksForOwner: () => false,
    stopProjectTasks: async () => undefined,
    releaseProjectTasks: () => undefined,
    removeOrphanedWorktree: async () => undefined,
    pruneOrphanedWorktrees: async () => undefined,
    showChanges: async () => undefined,
    hideChanges: () => undefined,
    showFileDiff: async () => undefined,
    hideFileDiff: () => undefined,
    removeWorktree: async () => undefined,
    refreshShipStatus: async () => undefined,
    commitThreadChanges: async () => undefined,
    pushThreadBranch: async () => undefined,
    openThreadCompareUrl: async () => undefined,
    integrateThreadBranch: async () => undefined,
    removeThreadWorktree: async () => undefined,
    resetThreadShip: () => undefined,
    openChangedFile: async () => undefined,
    openChangedFileDiff: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    markThreadViewed: () => undefined,
    markThreadUnread: () => undefined,
    renameThread: () => undefined,
    threadCopyDetail: () => null,
    lastUsedLaunch: () => null,
  };
}

function threadView(root: string, worktreePath: string | null): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: root, ownerId: "agent-root:app", repositoryRoot: root },
    target:
      worktreePath === null
        ? { isolation: "in-place", worktreePath: null }
        : { isolation: "worktree", worktreePath },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "Refactor the parser",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_700_000_000_000,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
