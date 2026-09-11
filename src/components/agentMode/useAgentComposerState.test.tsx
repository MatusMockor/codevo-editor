// @vitest-environment jsdom

import { act, StrictMode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import { defaultAgentLaunchOptions, type AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  FIXTURE_NESTED_ROOT,
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import {
  NOT_REPOSITORY_COMPOSER_CAPTION,
  NOT_REPOSITORY_WORKTREE_ONLY_CAPTION,
  useAgentComposerState,
  type AgentComposerState,
} from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";
import { COMPOSER_REPOSITORY_PREFERENCE_KEY } from "./useAgentComposerRepositoryPreference";

interface Captured {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
}

describe("useAgentComposerState", () => {
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

  it("targets the active-tab project and starts a thread with the composed payload", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    const refreshIsolationStatus = vi.fn(async () => undefined);
    render(threadsSurfaceFixture({ startThread, refreshIsolationStatus }));

    const props = current().composer.composerProps;
    expect(current().composer.target).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    expect(current().composer.composerLabel).toBe("app");
    expect(props.mode).toEqual({ kind: "new" });
    expect(props.submitBlocked).toBe(true);
    expect(refreshIsolationStatus).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT);

    act(() => current().composer.composerProps.onPromptChange("Refactor the parser"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);

    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    expect(refreshIsolationStatus).toHaveBeenLastCalledWith(
      FIXTURE_NESTED_ROOT,
      SURFACE_FIXTURE_ROOT,
    );

    const launch = defaultAgentLaunchOptions("claudeCode");
    await act(async () => {
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false });
    });

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: FIXTURE_NESTED_ROOT,
      prompt: "Refactor the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch,
      dangerousLaunchConfirmed: false,
    });
    expect(current().composer.composerProps.prompt).toBe("");
    expect(current().navigation.selectedThreadId).toBe("agt-new");
  });

  it("restores a deliberate nested selection after remount and lets root replace that memory", () => {
    render(threadsSurfaceFixture());
    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    act(() => root.unmount());
    root = createRoot(host);
    render(threadsSurfaceFixture());
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    act(() => current().composer.composerProps.onSelectRepository(SURFACE_FIXTURE_ROOT));
    act(() => current().composer.clearSelection());
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("does not use a remembered repository through an untrusted project or missing membership", () => {
    localStorage.setItem(
      COMPOSER_REPOSITORY_PREFERENCE_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ projectRootKey: SURFACE_FIXTURE_ROOT, repositoryRoot: FIXTURE_NESTED_ROOT }],
      }),
    );
    render(threadsSurfaceFixture(), [projectFixture({ trust: "untrusted" })]);
    expect(current().composer.target).toBeNull();
    render(threadsSurfaceFixture(), [projectFixture({ repositories: [] })]);
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("rejects a retained repository callback after trust or owner generation changes", () => {
    render(threadsSurfaceFixture());
    const choose = current().composer.composerProps.onSelectRepository;
    render(threadsSurfaceFixture(), [projectFixture({ trust: "untrusted" })]);
    act(() => choose(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBeNull();
    render(threadsSurfaceFixture(), [projectFixture({ generation: 9 })]);
    act(() => choose(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBeNull();
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("rejects old new-thread repository callbacks through a same-project follow-up and back", () => {
    const agents = threadsSurfaceFixture({ threads: [surfaceThreadView()] });
    render(agents);
    const choose = current().composer.composerProps.onSelectRepository;
    act(() => current().navigation.selectThread("agt-1"));
    act(() => choose(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBeNull();
    act(() => current().composer.clearSelection());
    act(() => choose(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBeNull();
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("prevents an unmounted composer's callback from overwriting a replacement's root preference", () => {
    render(threadsSurfaceFixture());
    const choose = current().composer.composerProps.onSelectRepository;
    act(() => root.unmount());
    root = createRoot(host);
    render(threadsSurfaceFixture());
    act(() => current().composer.composerProps.onSelectRepository(SURFACE_FIXTURE_ROOT));
    const stored = localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    act(() => choose(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBe(stored);
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("keeps a live repository callback usable after StrictMode repeats effect setup", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Harness
            agents={threadsSurfaceFixture()}
            projects={[projectFixture()]}
            providerEnabled={{ claudeCode: true, codex: true }}
          />
        </StrictMode>,
      ),
    );
    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toContain(FIXTURE_NESTED_ROOT);
  });

  it("expires repository interactions through root A B A without rejecting routine republishing", () => {
    render(threadsSurfaceFixture());
    const first = current().composer.composerProps.onSelectRepository;
    render(threadsSurfaceFixture());
    act(() => first(FIXTURE_NESTED_ROOT));
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    act(() => current().composer.composerProps.onSelectRepository(SURFACE_FIXTURE_ROOT));
    const stored = localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    act(() => first(FIXTURE_NESTED_ROOT));
    expect(localStorage.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY)).toBe(stored);
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("lets an explicit rail root replace a nested choice under the same automatic project scope", () => {
    render(threadsSurfaceFixture());
    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("restores each project's preference across A B A and preserves a deliberate root scope", () => {
    const otherRoot = "/workspace/other";
    const otherNested = `${otherRoot}/api`;
    const other = projectFixture({
      rootKey: otherRoot,
      rootPath: otherRoot,
      ownerId: "other-owner",
      repositories: [fixtureRepository(otherRoot, ""), fixtureRepository(otherNested, "api")],
    });
    render(threadsSurfaceFixture());
    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    render(threadsSurfaceFixture(), [other]);
    expect(current().composer.target?.repositoryRoot).toBe(otherRoot);
    act(() => current().composer.composerProps.onSelectRepository(otherNested));
    render(threadsSurfaceFixture(), [projectFixture({ generation: 3 })]);
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );
    expect(current().composer.target?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
    render(threadsSurfaceFixture(), [{ ...other, generation: 4 }]);
    expect(current().composer.target?.repositoryRoot).toBe(otherNested);
  });

  it("shows a quiet checking caption without the in-place risk confirmation", () => {
    render(
      threadsSurfaceFixture({
        isolationPreview: (repositoryRoot) => ({
          repositoryRoot,
          repositoryStatus: { kind: "checking" },
          recommended: { kind: "worktree", reason: "status-unknown" },
          inPlaceGuard: { kind: "unsafe", reasons: ["status-unknown"] },
          inPlaceAllowed: true,
          confirmationKey: null,
        }),
      }),
    );

    expect(current().composer.composerProps.isolationReason).toBe("Checking repository...");
    expect(current().composer.composerProps.guard).toEqual({ kind: "safe" });
    expect(current().composer.composerProps.submitBlocked).toBe(true);
  });

  it("targets a plain project folder in place with a truthful status and no repository risk", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-folder" }));
    const nested = `${SURFACE_FIXTURE_ROOT}/pa-ai-be`;
    const folder = projectFixture({ repositories: [fixtureRepository(nested, "pa-ai-be")] });
    render(
      threadsSurfaceFixture({
        startThread,
        isolationPreview: (repositoryRoot) => ({
          repositoryRoot,
          repositoryStatus: { kind: "notRepository" },
          recommended: { kind: "in-place" },
          inPlaceGuard: { kind: "safe" },
          inPlaceAllowed: true,
          confirmationKey: "folder-key",
        }),
      }),
      [folder],
    );

    expect(current().composer.target).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    expect(current().composer.composerLabel).toBe("app");
    const props = current().composer.composerProps;
    expect(props.isolation).toBe("in-place");
    expect(props.worktreeAvailable).toBe(false);
    expect(props.isolationReason).toBe(NOT_REPOSITORY_COMPOSER_CAPTION);
    expect(props.guard).toEqual({ kind: "safe" });
    expect(props.target).toEqual({
      projectLabel: "app",
      projectRoot: SURFACE_FIXTURE_ROOT,
      repositoryOptions: [{ repositoryRoot: nested, label: "pa-ai-be" }],
      selectedRepositoryRoot: SURFACE_FIXTURE_ROOT,
    });

    act(() => current().composer.composerProps.onIsolationChange("worktree"));
    expect(current().composer.composerProps.isolation).toBe("in-place");

    act(() => current().composer.composerProps.onPromptChange("Wire the services"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);
    const launch = defaultAgentLaunchOptions("claudeCode");
    await act(async () => {
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false });
    });

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      prompt: "Wire the services",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch,
      dangerousLaunchConfirmed: false,
    });
  });

  it("blocks a plain folder in a background project that can only use worktrees", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other/api", "api")],
    });
    render(
      threadsSurfaceFixture({
        isolationPreview: (repositoryRoot) => ({
          repositoryRoot,
          repositoryStatus: { kind: "notRepository" },
          recommended: { kind: "worktree", reason: "policy" },
          inPlaceGuard: { kind: "safe" },
          inPlaceAllowed: false,
          confirmationKey: null,
        }),
      }),
      [background],
    );
    act(() => current().composer.startNewThread("/workspace/other", "/workspace/other"));
    act(() => current().composer.composerProps.onPromptChange("Go"));

    expect(current().composer.composerProps.isolation).toBe("worktree");
    expect(current().composer.composerProps.submitBlocked).toBe(true);
    expect(current().composer.composerProps.isolationReason).toBe(
      NOT_REPOSITORY_WORKTREE_ONLY_CAPTION,
    );

    act(() => current().composer.composerProps.onSelectRepository("/workspace/other/api"));
    expect(current().composer.target?.repositoryRoot).toBe("/workspace/other/api");
  });

  it("surfaces the actionable repository probe failure and keeps dispatch blocked", () => {
    render(
      threadsSurfaceFixture({
        isolationPreview: (repositoryRoot) => ({
          repositoryRoot,
          repositoryStatus: {
            kind: "failed",
            message: "Repository status check failed: permission denied",
          },
          recommended: { kind: "worktree", reason: "status-unknown" },
          inPlaceGuard: { kind: "unsafe", reasons: ["status-unknown"] },
          inPlaceAllowed: true,
          confirmationKey: null,
        }),
      }),
    );

    expect(current().composer.composerProps.isolationReason).toBe(
      "Repository status check failed: permission denied",
    );
    expect(current().composer.composerProps.guard).toEqual({ kind: "safe" });
    expect(current().composer.composerProps.submitBlocked).toBe(true);
  });

  it("re-probes when the selected repository is rebound to a new owner generation", () => {
    const refreshIsolationStatus = vi.fn(async () => ({ kind: "stale" as const }));
    const agents = threadsSurfaceFixture({ refreshIsolationStatus });

    render(agents, [projectFixture({ ownerId: "owner-a", generation: 1 })]);
    expect(refreshIsolationStatus).toHaveBeenCalledTimes(1);

    render(agents, [projectFixture({ ownerId: "owner-b", generation: 2 })]);
    expect(refreshIsolationStatus).toHaveBeenCalledTimes(2);

    render(agents, [projectFixture({ ownerId: "owner-a", generation: 3 })]);
    expect(refreshIsolationStatus).toHaveBeenCalledTimes(3);
  });

  it("refreshes repository eligibility at the exact current target after Git is added or removed", () => {
    let diskIsRepository = false;
    let probedIsRepository = false;
    const refreshIsolationStatus = vi.fn(async () => {
      probedIsRepository = diskIsRepository;
    });
    const agents = threadsSurfaceFixture({
      refreshIsolationStatus,
      isolationPreview: (repositoryRoot) => ({
        repositoryRoot,
        repositoryStatus: probedIsRepository ? { kind: "ready" } : { kind: "notRepository" },
        recommended: { kind: "in-place" },
        inPlaceGuard: { kind: "safe" },
        inPlaceAllowed: true,
        confirmationKey: "repository-key",
      }),
    });
    const projects = [projectFixture()];
    render(agents, projects);
    expect(current().composer.composerProps.worktreeAvailable).toBe(false);
    diskIsRepository = true;
    act(() => current().composer.composerProps.onRefreshIsolation?.());
    expect(refreshIsolationStatus).toHaveBeenLastCalledWith(
      SURFACE_FIXTURE_ROOT,
      SURFACE_FIXTURE_ROOT,
    );
    render(agents, projects);
    expect(current().composer.composerProps.worktreeAvailable).toBe(true);
    act(() => current().composer.composerProps.onIsolationChange("worktree"));
    expect(current().composer.composerProps.isolation).toBe("worktree");

    diskIsRepository = false;
    act(() => current().composer.composerProps.onRefreshIsolation?.());
    render(agents, projects);
    expect(current().composer.composerProps.worktreeAvailable).toBe(false);
    expect(current().composer.composerProps.isolation).toBe("in-place");
    expect(current().composer.composerProps.isolationReason).toBe(NOT_REPOSITORY_COMPOSER_CAPTION);

    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    act(() => current().composer.composerProps.onRefreshIsolation?.());
    expect(refreshIsolationStatus).toHaveBeenLastCalledWith(
      FIXTURE_NESTED_ROOT,
      SURFACE_FIXTURE_ROOT,
    );
  });

  it("keeps the prompt when the thread does not start", async () => {
    render(threadsSurfaceFixture({ startThread: async () => null }));
    act(() => current().composer.composerProps.onPromptChange("Keep me"));

    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(current().composer.composerProps.prompt).toBe("Keep me");
    expect(current().navigation.selectedThreadId).toBeNull();
  });

  it("keeps prompt edits made while a submission is pending", async () => {
    let resolveStart: ((value: { threadId: string }) => void) | null = null;
    const pendingStart = new Promise<{ threadId: string }>((resolve) => {
      resolveStart = resolve;
    });
    render(threadsSurfaceFixture({ startThread: () => pendingStart }));
    act(() => current().composer.composerProps.onPromptChange("First prompt"));
    act(() => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(current().composer.composerProps.prompt).toBe("");
    act(() => current().composer.composerProps.onPromptChange("Second prompt"));

    await act(async () => {
      resolveStart?.({ threadId: "agt-new" });
      await pendingStart;
    });

    expect(current().composer.composerProps.prompt).toBe("Second prompt");
    expect(current().navigation.selectedThreadId).toBe("agt-new");
  });

  it("does not publish a completed start after the project owner generation changes", async () => {
    let resolveStart: ((value: { threadId: string }) => void) | null = null;
    const pendingStart = new Promise<{ threadId: string }>((resolve) => {
      resolveStart = resolve;
    });
    const agents = threadsSurfaceFixture({ startThread: () => pendingStart });
    render(agents, [projectFixture({ generation: 1 })]);
    act(() => current().composer.composerProps.onPromptChange("Keep exact owner"));
    act(() => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    render(agents, [projectFixture({ generation: 2 })]);
    await act(async () => {
      resolveStart?.({ threadId: "agt-stale" });
      await pendingStart;
    });

    expect(current().composer.composerProps.prompt).toBe("Keep exact owner");
    expect(current().navigation.selectedThreadId).toBeNull();
  });

  it("sends a follow-up for the selected thread and clears the prompt on success", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render(threadsSurfaceFixture({ threads: [surfaceThreadView()], sendFollowUp }));

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode.kind).toBe("followUp");
    act(() => current().composer.composerProps.onPromptChange("Continue"));

    const launch = defaultAgentLaunchOptions("claudeCode");
    await act(async () => {
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: true });
    });

    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Continue",
      launch,
      dangerousLaunchConfirmed: true,
    });
    expect(current().composer.composerProps.prompt).toBe("");
  });

  it("keeps a selected follow-up blocked until its provider is ready", async () => {
    const sendFollowUp = vi.fn(async () => true);
    const unavailable = threadsSurfaceFixture({
      agentCliConfigured: false,
      threads: [surfaceThreadView()],
      sendFollowUp,
    });
    render(unavailable);

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("First send after launch"));
    expect(current().composer.composerProps.mode).toMatchObject({
      kind: "followUp",
      blockedReason: "No agent CLI is configured. Set the agent CLI path in settings.",
    });
    expect(current().composer.composerProps.submitBlocked).toBe(true);

    await act(async () => {
      await current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(sendFollowUp).not.toHaveBeenCalled();

    render({ ...unavailable, agentCliConfigured: true });
    expect(current().navigation.selectedThreadId).toBe("agt-1");
    expect(current().composer.composerProps.mode).toMatchObject({
      kind: "followUp",
      blockedReason: null,
    });
    expect(current().composer.composerProps.submitBlocked).toBe(false);
  });

  it("captions an imported follow-up exactly like a native one", () => {
    const original = surfaceThreadView();
    render(threadsSurfaceFixture({ threads: [original] }));
    act(() => current().navigation.selectThread("agt-1"));
    const nativeCaption = current().composer.composerProps.isolationReason;

    const imported = {
      ...original,
      thread: {
        ...original.thread,
        externalOrigin: {
          provider: "claudeCode" as const,
          sessionId: "34fbe185-9c1d-4e6a-8b21-7f3a5d90c412",
          importedAtEpochMs: 1_700_000_000_000,
        },
      },
    };
    render(threadsSurfaceFixture({ threads: [imported] }));

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.isolationReason).toBe(nativeCaption);
    expect(current().composer.composerProps.isolationReason ?? "").not.toMatch(
      /imported sessions/u,
    );

    act(() => current().navigation.clearSelectedThread());
    expect(current().composer.composerProps.isolationReason ?? "").not.toMatch(
      /imported sessions/u,
    );
  });

  it("keeps a follow-up bound to the provider that owns the selected thread", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render(
      threadsSurfaceFixture({
        agentCliKind: "codex",
        threads: [surfaceThreadView()],
        sendFollowUp,
      }),
    );

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.launchProvider).toBe("claudeCode");
    expect(current().composer.composerProps.mode).toMatchObject({
      kind: "followUp",
      blockedReason: null,
    });
  });

  it("falls back to the first enabled provider without changing persisted selection", () => {
    const agents = threadsSurfaceFixture({ agentCliKind: "codex" });
    render(agents, [projectFixture()], { claudeCode: true, codex: false });

    expect(agents.agentCliKind).toBe("codex");
    expect(current().composer.composerProps.launchProvider).toBe("claudeCode");
    expect(current().composer.composerProps.launch.provider).toBe("claudeCode");
  });

  it("keeps a successfully dispatched follow-up cleared when its owner is rebound", async () => {
    let resolveFollowUp: ((value: boolean) => void) | null = null;
    const pendingFollowUp = new Promise<boolean>((resolve) => {
      resolveFollowUp = resolve;
    });
    const original = surfaceThreadView();
    const agents = threadsSurfaceFixture({
      threads: [original],
      sendFollowUp: () => pendingFollowUp,
    });
    render(agents);
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Keep follow-up"));
    act(() => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(current().composer.composerProps.prompt).toBe("");

    const replacement = {
      ...original,
      thread: {
        ...original.thread,
        owner: { ...original.thread.owner, rootKey: "/workspace/replaced" },
      },
    };
    render({ ...agents, threads: [replacement] });
    await act(async () => {
      resolveFollowUp?.(true);
      await pendingFollowUp;
    });

    expect(current().composer.composerProps.prompt).toBe("");
  });

  it("uses the current checkout choice as confirmation and forwards the safety key", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render(
      threadsSurfaceFixture({
        startThread,
        isolationPreview: (repositoryRoot) => ({
          repositoryRoot,
          recommended: { kind: "in-place" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
          inPlaceAllowed: true,
          confirmationKey: "confirm-1",
        }),
      }),
      [projectFixture({ isolationPolicy: "in-place" })],
    );
    act(() => current().composer.composerProps.onPromptChange("Go"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);

    act(() => current().composer.composerProps.onIsolationChange("worktree"));
    expect(current().composer.composerProps.isolation).toBe("worktree");

    act(() => current().composer.composerProps.onIsolationChange("in-place"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: true,
      });
    });

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ isolation: "in-place", unsafeInPlaceConfirmationKey: "confirm-1" }),
    );
  });

  it("defaults a new thread to the local checkout under automatic policy", () => {
    const agents = threadsSurfaceFixture({
      isolationPreview: (repositoryRoot) => ({
        repositoryRoot,
        recommended: { kind: "worktree", reason: "dirty-tree" },
        inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
        inPlaceAllowed: true,
        confirmationKey: "confirm-local",
      }),
    });

    render(agents, [projectFixture({ isolationPolicy: "auto" })]);
    act(() => current().composer.composerProps.onPromptChange("Go"));

    expect(current().composer.composerProps.isolation).toBe("in-place");
    expect(current().composer.composerProps.guard).toEqual({
      kind: "unsafe",
      reasons: ["dirty-tree"],
    });
    expect(current().composer.composerProps.submitBlocked).toBe(false);
  });

  it("honors an explicit workspace worktree policy", () => {
    render(threadsSurfaceFixture(), [projectFixture({ isolationPolicy: "worktree" })]);

    expect(current().composer.composerProps.isolation).toBe("worktree");
  });

  it("forces worktree isolation for background-tab projects", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other", "")],
    });
    render(threadsSurfaceFixture(), [background]);

    act(() => current().composer.startNewThread("/workspace/other", "/workspace/other"));

    expect(current().composer.composerProps.isolation).toBe("worktree");
    expect(current().composer.composerProps.worktreeOnly).toBe(true);
    expect(current().composer.composerProps.worktreeOnlyReason).not.toBeNull();
  });

  it("seeds the launch from the remembered project launch and lets the user change it", () => {
    const remembered: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "default",
    };
    render(threadsSurfaceFixture({ lastUsedLaunch: () => remembered }));

    expect(current().composer.composerProps.launch).toEqual({
      ...remembered,
      effort: "high",
      context: "1m",
    });

    act(() =>
      current().composer.composerProps.onLaunchChange(defaultAgentLaunchOptions("claudeCode")),
    );
    expect(current().composer.composerProps.launch).toEqual({
      ...defaultAgentLaunchOptions("claudeCode"),
      mode: "bypassPermissions",
      effort: "high",
    });
  });

  it("migrates legacy CLI-default launch values before they reach the composer", () => {
    render(
      threadsSurfaceFixture({
        lastUsedLaunch: () => ({
          provider: "claudeCode",
          model: "default",
          mode: "default",
          effort: "default",
        }),
      }),
    );

    expect(current().composer.composerProps.launch).toEqual({
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    });
  });

  it.each<AgentLaunchOptions>([
    {
      provider: "claudeCode",
      model: "fable",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    },
    { provider: "codex", model: "gpt-5.6-sol", mode: "dangerFullAccess" },
  ])("retains $model while an existing untrusted project becomes ready", async (launch) => {
    const startThread = vi.fn(async () => ({ threadId: "new-model-thread" }));
    const agents = threadsSurfaceFixture({ startThread });
    render(agents, [projectFixture({ trust: "untrusted" })]);
    expect(current().composer.target).toBeNull();
    act(() => current().composer.composerProps.onLaunchChange(launch));
    expect(current().composer.composerProps.launch).toEqual(launch);
    act(() => current().composer.composerProps.onPromptChange("Use this model"));
    expect(current().composer.composerProps.submitBlocked).toBe(true);
    await act(async () =>
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false }),
    );
    expect(startThread).not.toHaveBeenCalled();
    render(threadsSurfaceFixture({ startThread }), [projectFixture({ trust: "untrusted" })]);
    expect(current().composer.composerProps.launch).toEqual(launch);
    render(agents, [projectFixture()]);
    expect(current().composer.composerProps.launch).toEqual(launch);
    expect(current().composer.composerProps.submitBlocked).toBe(false);
    await act(async () =>
      current().composer.composerProps.onSubmit({
        launch: current().composer.composerProps.launch,
        dangerousLaunchConfirmed: false,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ launch }));
  });

  it("keeps an untrusted project's model draft scoped away from another project", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "other-owner",
      origin: "background-tab",
      trust: "untrusted",
    });
    render(threadsSurfaceFixture(), [projectFixture({ trust: "untrusted" }), background]);
    const launch: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-5.6-sol",
      mode: "dangerFullAccess",
    };
    act(() => current().composer.composerProps.onLaunchChange(launch));
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: background.rootKey,
        repositoryRoot: background.rootPath,
      }),
    );
    expect(current().composer.composerProps.launch.provider).toBe("claudeCode");
    expect(current().composer.target).toBeNull();
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );
    expect(current().composer.composerProps.launch).toEqual(launch);
    expect(current().composer.target).toBeNull();
  });

  it("lets an empty composer retain a model draft without permitting submission", () => {
    render(threadsSurfaceFixture(), []);
    const launch: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-5.6-sol",
      mode: "dangerFullAccess",
    };
    act(() => current().composer.composerProps.onLaunchChange(launch));
    act(() => current().composer.composerProps.onPromptChange("Draft"));
    expect(current().composer.composerProps.launch).toEqual(launch);
    expect(current().composer.composerProps.submitBlocked).toBe(true);
  });

  it("keeps a provider selected from the new-thread model picker", () => {
    render(threadsSurfaceFixture(), undefined, { claudeCode: true, codex: true });
    expect(current().composer.composerProps.launchProvider).toBe("claudeCode");

    act(() =>
      current().composer.composerProps.onLaunchChange({
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: "dangerFullAccess",
      }),
    );

    expect(current().composer.composerProps.launchProvider).toBe("codex");
    expect(current().composer.composerProps.launch).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      mode: "dangerFullAccess",
    });
  });

  it("clears the selected thread and unsafe confirmation when starting fresh", () => {
    render(threadsSurfaceFixture({ threads: [surfaceThreadView()] }));
    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode.kind).toBe("followUp");

    act(() => current().composer.clearSelection());

    expect(current().navigation.selectedThreadId).toBeNull();
    expect(current().composer.composerProps.mode).toEqual({ kind: "new" });
  });

  it("clears the explicit composer selection when starting fresh", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other", "")],
    });
    render(threadsSurfaceFixture(), [projectFixture(), background]);

    act(() => current().composer.startNewThread("/workspace/other", "/workspace/other"));
    expect(current().composer.target?.projectRootKey).toBe("/workspace/other");

    act(() => current().composer.clearSelection());

    expect(current().composer.target?.projectRootKey).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("lets repository scope replace a stale selection synchronously", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other", "")],
    });
    render(threadsSurfaceFixture(), [projectFixture(), background]);

    act(() => current().composer.startNewThread(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT));
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: "/workspace/other",
        repositoryRoot: "/workspace/other",
      }),
    );

    expect(current().composer.target).toEqual({
      projectRootKey: "/workspace/other",
      repositoryRoot: "/workspace/other",
    });
    expect(current().composer.composerLabel).toBe("other");
  });

  it("does not rebind a selection after its project is removed and re-added at the same roots", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    const first = projectFixture({ generation: 1 });
    render(threadsSurfaceFixture({ startThread }), [first]);
    act(() => current().composer.startNewThread(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT));

    render(threadsSurfaceFixture({ startThread }), []);
    expect(current().composer.target).toBeNull();

    render(threadsSurfaceFixture({ startThread }), [projectFixture({ generation: 2 })]);
    expect(current().composer.target).toBeNull();
    act(() => current().composer.composerProps.onPromptChange("Do not rebind"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(startThread).not.toHaveBeenCalled();
  });

  it("keeps a missing explicit new-thread target from falling back to the active project", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render(threadsSurfaceFixture({ startThread }));

    act(() => current().composer.startNewThread("/workspace/gone", "/workspace/gone"));
    expect(current().composer.target).toBeNull();
    act(() => current().composer.composerProps.onPromptChange("Do not retarget"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(startThread).not.toHaveBeenCalled();
  });

  it("does not resurrect a shadowed selection after the scope moves to another project", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other", "")],
    });
    render(threadsSurfaceFixture({ startThread }), [projectFixture(), background]);
    act(() => current().composer.startNewThread("/workspace/other", "/workspace/other"));
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: "/workspace/other",
        repositoryRoot: "/workspace/other",
      }),
    );
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );

    expect(current().composer.target).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    act(() => current().composer.composerProps.onPromptChange("Use the active owner"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );
  });

  it("keeps an explicit composer selection when projects republish under the same scope", () => {
    const background = projectFixture({
      rootKey: "/workspace/other",
      rootPath: "/workspace/other",
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository("/workspace/other", "")],
    });
    const agents = threadsSurfaceFixture();
    render(agents, [projectFixture(), background]);

    act(() => current().composer.startNewThread("/workspace/other", "/workspace/other"));
    expect(current().composer.target?.projectRootKey).toBe("/workspace/other");

    render(agents, [projectFixture({ trust: "trusted" }), { ...background }]);

    expect(current().navigation.railScope?.projectRootKey).toBe(SURFACE_FIXTURE_ROOT);
    expect(current().composer.target?.projectRootKey).toBe("/workspace/other");
  });

  it("keeps the scoped composer alive when the project owner generation is replaced", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    const agents = threadsSurfaceFixture({ startThread });
    render(agents, [projectFixture({ generation: 1 })]);
    act(() =>
      current().navigation.setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );

    render(agents, [projectFixture({ ownerId: "owner-b", generation: 2 })]);
    expect(current().navigation.composerScope).toEqual({
      kind: "repository",
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-b",
      generation: 2,
    });
    expect(current().composer.target).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });

    act(() => current().composer.composerProps.onPromptChange("Use the live owner"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
    expect(startThread).toHaveBeenCalledTimes(1);
  });

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture()],
    providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>> = {
      claudeCode: true,
      codex: true,
    },
  ): void {
    act(() => {
      root.render(
        <Harness agents={agents} projects={projects} providerEnabled={providerEnabled} />,
      );
    });
  }

  function current(): Captured {
    expect(captured).not.toBeNull();
    return captured as Captured;
  }

  function Harness({
    agents,
    projects,
    providerEnabled,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>>;
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
      providerEnabled,
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    captured = { composer, navigation };
    return null;
  }
});
