// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadStartRequest,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { COMPOSER_REPOSITORY_PREFERENCE_KEY } from "./useAgentComposerRepositoryPreference";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

const ROOT_B = "/workspace/other";
const WORKTREE_A = `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-a-new`;
const WORKTREE_A_OLD = `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-a-old`;
const WORKTREE_B = `${ROOT_B}/.worktrees/agt-b`;

const PROJECT_A = projectFixture();
const PROJECT_B = projectFixture({
  rootKey: ROOT_B,
  rootPath: ROOT_B,
  ownerId: "agent-root:other",
  label: "other",
  repositories: [fixtureRepository(ROOT_B, "")],
});

function worktreeThread(
  threadId: string,
  rootKey: string,
  ownerId: string,
  worktreePath: string,
  updatedAtEpochMs: number,
  overrides: Partial<AgentThreadView> = {},
): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ship: {
      kind: "pushed",
      status: null,
      receipt: { remote: "origin", branch: `agent/${threadId}`, compareUrl: null },
    },
    ...overrides,
    thread: {
      ...base.thread,
      threadId,
      owner: { rootKey, ownerId, repositoryRoot: rootKey },
      target: { isolation: "worktree", worktreePath },
      updatedAtEpochMs,
      ...(overrides.thread ?? {}),
    },
  });
}

const THREAD_A_NEW = worktreeThread(
  "agt-a-new",
  SURFACE_FIXTURE_ROOT,
  PROJECT_A.ownerId,
  WORKTREE_A,
  300,
);
const THREAD_A_OLD = worktreeThread(
  "agt-a-old",
  SURFACE_FIXTURE_ROOT,
  PROJECT_A.ownerId,
  WORKTREE_A_OLD,
  100,
);
const THREAD_B = worktreeThread("agt-b", ROOT_B, PROJECT_B.ownerId, WORKTREE_B, 900);

const LAUNCH = defaultAgentLaunchOptions("claudeCode");

interface Captured {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
}

describe("useAgentComposerState previous worktree", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: Captured | null;

  beforeEach(() => {
    localStorage.removeItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
    localStorage.removeItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    act(() => root.unmount());
    host.remove();
  });

  function current(): Captured {
    expect(captured).not.toBeNull();
    return captured as Captured;
  }

  function Harness({
    agents,
    projects,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  }) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    const navigation = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
    });
    const composer = useAgentComposerState({
      agents,
      groups,
      projects,
      providerEnabled: { claudeCode: true, codex: true },
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    captured = { composer, navigation };
    return null;
  }

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [PROJECT_A, PROJECT_B],
  ): void {
    act(() => root.render(<Harness agents={agents} projects={projects} />));
  }

  function draftIn(project: AgentProjectDescriptor): void {
    act(() => current().composer.startNewThread(project.rootKey, project.rootPath));
  }

  function choice() {
    return current().composer.composerProps.previousWorktree ?? null;
  }

  async function submit(prompt: string): Promise<void> {
    act(() => current().composer.composerProps.onPromptChange(prompt));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: LAUNCH,
        dangerousLaunchConfirmed: false,
      });
    });
  }

  it("offers the most recent worktree of the draft project, unselected", () => {
    render(threadsSurfaceFixture({ threads: [THREAD_A_OLD, THREAD_B, THREAD_A_NEW] }));
    draftIn(PROJECT_A);

    expect(choice()?.available).toEqual({
      threadId: "agt-a-new",
      worktreePath: WORKTREE_A,
      branch: "agent/agt-a-new",
    });
    expect(choice()?.selected).toBe(false);
    expect(current().composer.composerProps.isolation).toBe("in-place");
  });

  it("starts the new thread in the selected previous worktree", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-started" }));
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW], startThread }));
    draftIn(PROJECT_A);

    act(() => choice()?.onSelect());

    expect(choice()?.selected).toBe(true);
    expect(current().composer.composerProps.isolation).toBe("worktree");
    await submit("Continue there");
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        reuseWorktree: { worktreePath: WORKTREE_A },
      }),
    );
  });

  it.each(["worktree", "in-place"] as const)(
    "clears the selection when the checkout is changed to %s",
    async (isolation) => {
      const startThread = vi.fn(async (_request: AgentThreadStartRequest) => ({
        threadId: "agt-started",
      }));
      render(threadsSurfaceFixture({ threads: [THREAD_A_NEW], startThread }));
      draftIn(PROJECT_A);
      act(() => choice()?.onSelect());

      act(() => current().composer.composerProps.onIsolationChange(isolation));

      expect(choice()?.selected).toBe(false);
      expect(current().composer.composerProps.isolation).toBe(isolation);
      await submit("Fresh checkout");
      const request = startThread.mock.calls[0]?.[0];
      expect(request?.isolation).toBe(isolation);
      expect(request?.reuseWorktree).toBeUndefined();
    },
  );

  it("keeps the selected worktree when a newer worktree thread appears", async () => {
    const startThread = vi.fn(async (_request: AgentThreadStartRequest) => ({
      threadId: "agt-started",
    }));
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW], startThread }));
    draftIn(PROJECT_A);
    act(() => choice()?.onSelect());

    const newer = worktreeThread(
      "agt-a-newer",
      SURFACE_FIXTURE_ROOT,
      PROJECT_A.ownerId,
      `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-a-newer`,
      800,
    );
    render(threadsSurfaceFixture({ threads: [newer, THREAD_A_NEW], startThread }));

    expect(choice()?.selected).toBe(true);
    expect(choice()?.available.worktreePath).toBe(WORKTREE_A);
    await submit("Stay in the chosen worktree");
    expect(startThread.mock.calls[0]?.[0].reuseWorktree).toEqual({ worktreePath: WORKTREE_A });
  });

  it("keeps the selection while another thread of the project still uses that worktree", () => {
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW] }));
    draftIn(PROJECT_A);
    act(() => choice()?.onSelect());

    const archived = {
      ...THREAD_A_NEW,
      thread: { ...THREAD_A_NEW.thread, archived: true },
    };
    const reuser = worktreeThread(
      "agt-a-reuser",
      SURFACE_FIXTURE_ROOT,
      PROJECT_A.ownerId,
      WORKTREE_A,
      200,
    );
    render(threadsSurfaceFixture({ threads: [archived, reuser] }));

    expect(choice()?.selected).toBe(true);
    expect(choice()?.available).toEqual({
      threadId: "agt-a-reuser",
      worktreePath: WORKTREE_A,
      branch: "agent/agt-a-reuser",
    });
  });

  it("resets the selection across an A to B to A project switch", () => {
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW, THREAD_B] }));
    draftIn(PROJECT_A);
    act(() => choice()?.onSelect());

    draftIn(PROJECT_B);
    expect(choice()?.available.threadId).toBe("agt-b");
    expect(choice()?.selected).toBe(false);

    draftIn(PROJECT_A);
    expect(choice()?.available.threadId).toBe("agt-a-new");
    expect(choice()?.selected).toBe(false);
  });

  it("drops the selection when its worktree stops being eligible and does not revive it", () => {
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW, THREAD_A_OLD] }));
    draftIn(PROJECT_A);
    act(() => choice()?.onSelect());

    const removed = { ...THREAD_A_NEW, worktreeRemoved: true };
    render(threadsSurfaceFixture({ threads: [removed, THREAD_A_OLD] }));
    expect(choice()?.available.threadId).toBe("agt-a-old");
    expect(choice()?.selected).toBe(false);
    expect(current().composer.composerProps.isolation).toBe("worktree");

    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW, THREAD_A_OLD] }));
    expect(choice()?.available.threadId).toBe("agt-a-new");
    expect(choice()?.selected).toBe(false);
  });

  it("excludes another owner's, an archived, and a remote worktree", () => {
    const foreignOwner = worktreeThread(
      "agt-foreign",
      SURFACE_FIXTURE_ROOT,
      "workspace-foreign",
      `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-foreign`,
      999,
    );
    const archived = worktreeThread(
      "agt-archived",
      SURFACE_FIXTURE_ROOT,
      PROJECT_A.ownerId,
      `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-archived`,
      998,
      { thread: { ...THREAD_A_NEW.thread, threadId: "agt-archived", archived: true } },
    );
    render(threadsSurfaceFixture({ threads: [foreignOwner, archived, THREAD_A_OLD] }));
    draftIn(PROJECT_A);

    expect(choice()?.available.threadId).toBe("agt-a-old");
  });

  it("offers nothing for a follow-up, a remote draft, or a project without worktrees", () => {
    render(threadsSurfaceFixture({ threads: [THREAD_A_NEW] }));
    act(() => current().navigation.selectThread("agt-a-new"));
    expect(choice()).toBeNull();

    const remoteRoot = "remote:server:runner:project";
    const remoteProject = projectFixture({ rootKey: remoteRoot, isolationPolicy: "worktree" });
    const remoteThread = worktreeThread(
      "agt-remote",
      remoteRoot,
      remoteProject.ownerId,
      `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-remote`,
      500,
    );
    render(threadsSurfaceFixture({ threads: [remoteThread] }), [remoteProject]);
    act(() => current().composer.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(choice()).toBeNull();

    render(threadsSurfaceFixture({ threads: [THREAD_B] }));
    draftIn(PROJECT_A);
    expect(choice()).toBeNull();
  });
});
