// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import { AgentModeScreen } from "./AgentModeScreen";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/api";

describe("AgentModeScreen", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("resets the view state on a workspace A -> B -> A switch", () => {
    const agents = surface();
    render(agents, ROOT_A);

    click('[data-thread-id="agt-1"]');
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();

    render(agents, ROOT_B);
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();

    render(agents, ROOT_A);
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
  });

  it("keeps the view state while the workspace root stays the same", () => {
    const agents = surface();
    render(agents, ROOT_A);

    click('[data-thread-id="agt-1"]');
    render(agents, ROOT_A);

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
  });

  function render(agents: WorkbenchAgentsSurface, workspaceRoot: string): void {
    act(() => root.render(<AgentModeScreen agents={agents} workspaceRoot={workspaceRoot} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }
});

function surface(): WorkbenchAgentsSurface {
  return {
    ...threadsSurface(),
    agentProjects: {
      projects: [project()],
      overflowRootPaths: [],
      refreshProject: async () => undefined,
      trustProject: async () => undefined,
      releaseProject: async () => undefined,
      ensureProjectLease: async () => true,
      noteDispatchTrustRejected: () => undefined,
    },
  };
}

function project(): AgentProjectDescriptor {
  return {
    rootKey: ROOT_A,
    rootPath: ROOT_A,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT_A, repositoryRelativePath: "" },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function threadsSurface(): AgentThreadsSurface {
  return {
    threads: [threadView()],
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT_A, repositoryRelativePath: "" },
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

function threadView(): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT_A, ownerId: "agent-root:app", repositoryRoot: ROOT_A },
    target: { isolation: "in-place", worktreePath: null },
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
