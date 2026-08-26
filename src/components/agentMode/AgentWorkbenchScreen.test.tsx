// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import { defaultAppSettings, terminalThemeForAppTheme } from "../../domain/settings";
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

  it("mirrors the controller panel visibility into the layout reducer", () => {
    const layout = recordedLayoutState();
    render(createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false }));
    expect(layout.actions).toEqual([]);

    const opened = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: true });
    render(opened);
    expect(layout.actions).toEqual([{ kind: "showBottomPanel" }]);
    expect(opened.showBottomPanelView).toHaveBeenCalledWith("terminal");

    render(createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false }));
    expect(layout.actions).toEqual([{ kind: "showBottomPanel" }, { kind: "hideBottomPanel" }]);
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
      agentWorkbench: recordedLayoutState({ bottomPanel: true }),
      bottomPanelVisible: false,
    });
    render(hydrated);

    expect(hydrated.showBottomPanelView).toHaveBeenCalledWith("terminal");
  });

  it("does not leak a persisted open panel across a workspace switch", () => {
    render(
      createWorkbench(ROOT_A, {
        agentWorkbench: recordedLayoutState({ bottomPanel: true }),
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
    agentProjects: {
      projects: [project(workspaceRoot)],
      overflowRootPaths: [],
      refreshProject: async () => undefined,
      trustProject: async () => undefined,
      releaseProject: async () => undefined,
      ensureProjectLease: async () => true,
      noteDispatchTrustRejected: () => undefined,
    },
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
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
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
