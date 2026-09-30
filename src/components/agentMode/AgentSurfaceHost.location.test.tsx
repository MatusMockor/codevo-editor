// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import type { AgentRemoteSurface } from "./agentRemoteSurface";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "./AgentSurfaceHost";
import { agentSurfaceRemoteProjectRootKey } from "./agentSurfaceLocation";
import { NO_AGENT_SURFACE_SCOPE } from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceActivation,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { installResizeObserver } from "./agentSurfaceTerminalTestSupport";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import type { AgentProjectWorkspaceActivation } from "./useAgentProjectWorkspaceSync";

const ROOT = SURFACE_FIXTURE_ROOT;
const OTHER_ROOT = "/workspace/orders";
const REMOTE_SCOPE = { serverId: "srv-1", runnerId: "runner", projectId: "orders" } as const;
const NOTE = '[role="note"][data-agent-surface-location]';

function project(root: string, label: string): AgentProjectDescriptor {
  return {
    rootKey: root,
    rootPath: root,
    ownerId: `agent-root:${root}`,
    label,
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function localThread(root: string, threadId: string, worktreePath: string | null): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ship: {
      kind: "pushed",
      status: null,
      receipt: { remote: "origin", branch: "agent/agt-12", compareUrl: null },
    },
    thread: {
      ...base.thread,
      threadId,
      owner: { rootKey: root, ownerId: `agent-root:${root}`, repositoryRoot: root },
      target: { isolation: worktreePath === null ? "in-place" : "worktree", worktreePath },
    },
  });
}

function remoteThread(): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    repositoryLabel: "orders-api",
    execution: {
      kind: "remote",
      ...REMOTE_SCOPE,
      conversationId: "conversation",
      latestTaskId: "task",
      resume: null,
    },
    thread: {
      ...base.thread,
      threadId: "remote-thread:srv-1:conversation",
      owner: {
        rootKey: agentSurfaceRemoteProjectRootKey(REMOTE_SCOPE),
        ownerId: "remote-owner",
        repositoryRoot: "/srv/orders",
      },
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function remoteSurface(taskId: string | undefined): AgentRemoteSurface {
  return {
    paneKey: "server-conversation",
    scope: { ...REMOTE_SCOPE, taskId },
    capabilities: { files: true, history: true, terminal: true },
    gateway: null,
  };
}

describe("AgentSurfaceHost location line", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function props(
    root: string,
    thread: AgentThreadView | null,
    activation: AgentProjectWorkspaceActivation = surfaceActivation(
      "ready",
      surfaceRepositoryScope(root),
    ),
    liveBranch: string | null = "main",
  ): AgentSurfaceHostProps {
    return {
      chrome: chromeFixture({
        liveCheckoutBranches: new Map([[root, liveBranch]]),
        workspaceActivation: { state: activation, select: () => undefined, retry: () => undefined },
      }),
      projects: [project(ROOT, "editor"), project(OTHER_ROOT, "orders")],
      layout: { openSurfaces: [], activeSurface: null },
      thread,
      threadRootPath: thread?.thread.target.worktreePath ?? (thread === null ? null : root),
      scope: surfaceRepositoryScope(root),
      workspaceRoot: root,
      hidden: false,
      chooserAutoFocus: false,
      agents: {
        showChanges: async () => undefined,
        showFileDiff: async () => undefined,
        hideFileDiff: () => undefined,
        openChangedFile: async () => undefined,
        openChangedFileDiff: async () => undefined,
      },
      layoutControls: null,
      onOpenSurface: () => undefined,
      onActivateSurface: () => undefined,
      onCloseSurfaceTab: () => undefined,
      onTrustScope: () => undefined,
      onSwitchScope: null,
    };
  }

  function render(
    next: AgentSurfaceHostProps,
    wrap: (node: ReactNode) => ReactNode = (node) => node,
  ) {
    act(() => root.render(wrap(<AgentSurfaceHost {...next} />)));
  }

  function note(): HTMLElement | null {
    return host.querySelector<HTMLElement>(NOTE);
  }

  function path(): HTMLElement | null {
    return note()?.querySelector<HTMLElement>("[data-agent-surface-location-path]") ?? null;
  }

  it("names a draft's project root as the local checkout under the tab strip", () => {
    render(props(ROOT, null));
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows Local checkout · main of editor",
    );
    expect(note()?.querySelector("b")?.textContent).toBe("editor");
    expect(note()?.textContent).toContain("Local checkout · main");
    expect(path()?.getAttribute("title")).toBe(ROOT);
    expect(path()?.textContent).toContain(ROOT);
    expect(note()?.querySelector(".lucide-folder")).not.toBeNull();
    const head = host.querySelector("[data-agent-surface-head]");
    expect(head?.compareDocumentPosition(note() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(head?.contains(note())).toBe(false);
  });

  it("names a started local checkout with and without a live branch", () => {
    render(props(ROOT, localThread(ROOT, "thread-a", null)));
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows Local checkout · main of editor",
    );
    render(props(ROOT, localThread(ROOT, "thread-a", null), undefined, null));
    expect(note()?.getAttribute("aria-label")).toBe("Right panel shows Local checkout of editor");
    expect(path()?.getAttribute("title")).toBe(ROOT);
  });

  it("names a worktree thread by branch and worktree path", () => {
    render(props(ROOT, localThread(ROOT, "thread-a", SURFACE_FIXTURE_WORKTREE)));
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows Worktree · agent/agt-12 of editor",
    );
    expect(path()?.getAttribute("title")).toBe(SURFACE_FIXTURE_WORKTREE);
    expect(note()?.querySelector(".lucide-git-branch")).not.toBeNull();
  });

  it("names a server thread and a server draft by server without a path", () => {
    const withServer = (node: ReactNode) => (
      <RemoteRunnerContext.Provider
        value={{
          gateway: new TauriRemoteRunnerGateway(vi.fn()),
          servers: [
            {
              id: "srv-1",
              name: "build-box",
              host: "build-box.example",
              username: "codevo",
              port: 22,
              connected: true,
            },
          ],
          status: "ready",
          error: null,
          selectedServerId: "srv-1",
          selectServer: vi.fn(),
          refresh: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          remove: vi.fn(),
        }}
      >
        {node}
      </RemoteRunnerContext.Provider>
    );
    const remoteProjects = [
      {
        ...project("/srv/orders", "orders-api"),
        rootKey: agentSurfaceRemoteProjectRootKey(REMOTE_SCOPE),
      },
    ];
    render(
      {
        ...props(ROOT, remoteThread()),
        projects: remoteProjects,
        scope: NO_AGENT_SURFACE_SCOPE,
        remoteSurface: remoteSurface("task"),
      },
      withServer,
    );
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows build-box · Server checkout of orders-api",
    );
    expect(path()).toBeNull();
    expect(note()?.querySelector(".lucide-server")).not.toBeNull();
    render(
      {
        ...props(ROOT, null),
        projects: remoteProjects,
        scope: NO_AGENT_SURFACE_SCOPE,
        remoteDraft: true,
        remoteSurface: remoteSurface(undefined),
      },
      withServer,
    );
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows build-box · Server checkout of orders-api",
    );
    render(
      {
        ...props(ROOT, remoteThread()),
        projects: remoteProjects,
        scope: NO_AGENT_SURFACE_SCOPE,
        remoteSurface: remoteSurface("another-task"),
      },
      withServer,
    );
    expect(note()).toBeNull();
  });

  it("does not claim a location while the project is opening or failed", () => {
    const scope = surfaceRepositoryScope(ROOT);
    render(props(ROOT, null, surfaceActivation("pending", scope)));
    expect(note()).toBeNull();
    expect(host.textContent).toContain("Opening project…");
    render(
      props(ROOT, null, {
        ...surfaceActivation("pending", scope),
        kind: "failed",
        message: "Could not open editor.",
      }),
    );
    expect(note()).toBeNull();
    expect(host.textContent).toContain("Could not open editor.");
    render(props(ROOT, null, surfaceActivation("ready", surfaceRepositoryScope(OTHER_ROOT))));
    expect(note()).toBeNull();
    render(props(ROOT, null));
    expect(note()).not.toBeNull();
  });

  it("does not claim a root that is still activated for its previous owner", () => {
    const scope = surfaceRepositoryScope(ROOT);
    for (const owner of [
      { ownerId: "agent-root:previous-owner", generation: scope.generation },
      { ownerId: scope.ownerId, generation: scope.generation + 1 },
    ]) {
      render(props(ROOT, null, { kind: "ready", rootPath: ROOT, owner }));
      expect(note()).toBeNull();
      expect(host.textContent).toContain("Opening project…");
      render(
        props(ROOT, null, {
          kind: "failed",
          rootPath: ROOT,
          owner,
          message: "Could not open the previous owner.",
        }),
      );
      expect(host.textContent).not.toContain("Could not open the previous owner.");
    }
  });

  it("names the chosen previous worktree while the panel still shows the project root", () => {
    render({
      ...props(ROOT, null),
      draftIsolation: "worktree",
      draftPreviousWorktree: {
        threadId: "agt-7",
        worktreePath: `${ROOT}/.worktrees/agt-7`,
        branch: "agent/agt-7",
      },
    });
    expect(note()?.textContent).toContain("Previous worktree (agent/agt-7) · shows project root");
    expect(path()?.getAttribute("title")).toBe(ROOT);
    expect(note()?.getAttribute("aria-label")).toBe(
      `Right panel shows the project root of editor. Sending continues in Previous worktree (agent/agt-7) at ${ROOT}/.worktrees/agt-7.`,
    );
  });

  it("isolates the path with escaped direction marks, never a literal one in the source", () => {
    render(props(ROOT, null));
    expect(path()?.textContent).toBe(`\u200e${ROOT}\u200e`);
    const source = readFileSync("src/components/agentMode/AgentSurfaceLocationLine.tsx", "utf8");
    expect(source).not.toContain("\u200e");
    expect(source).toContain("\\u200e");
  });

  it("repeats the strip's draft pick truthfully", () => {
    render({ ...props(ROOT, null), draftIsolation: "worktree" });
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows the project root of editor. New worktree not created yet.",
    );
    expect(note()?.textContent).toContain("New worktree (not created yet) · shows project root");
    expect(path()?.getAttribute("title")).toBe(ROOT);
    render({ ...props(ROOT, null), draftIsolation: "in-place" });
    expect(note()?.getAttribute("aria-label")).toBe(
      "Right panel shows Local checkout · main of editor",
    );
  });

  it("does not claim a thread whose owner the selected project does not own", () => {
    const foreign = localThread(ROOT, "thread-a", null);
    render(
      props(
        ROOT,
        surfaceThreadView({
          ...foreign,
          thread: {
            ...foreign.thread,
            owner: { ...foreign.thread.owner, ownerId: "agent-root:replaced-owner" },
          },
        }),
      ),
    );
    expect(note()).toBeNull();
  });

  it("follows the selection A to B to A by exact project", () => {
    render(props(ROOT, localThread(ROOT, "thread-a", null)));
    expect(note()?.querySelector("b")?.textContent).toBe("editor");
    render(props(OTHER_ROOT, localThread(OTHER_ROOT, "thread-b", null)));
    expect(note()?.querySelector("b")?.textContent).toBe("orders");
    expect(path()?.getAttribute("title")).toBe(OTHER_ROOT);
    render(props(ROOT, localThread(ROOT, "thread-a", null)));
    expect(note()?.querySelector("b")?.textContent).toBe("editor");
    expect(path()?.getAttribute("title")).toBe(ROOT);
  });
});
