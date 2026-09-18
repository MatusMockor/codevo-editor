// @vitest-environment jsdom

import { act, StrictMode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSteerOutcome,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import {
  createAgentComposerDraftStore,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import { defaultAgentLaunchOptions, type AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  composerAttachmentsSurfaceFixture,
  FIXTURE_NESTED_ROOT,
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import {
  AGENT_COMPOSER_PROMPT_ID,
  NOT_REPOSITORY_COMPOSER_CAPTION,
  NOT_REPOSITORY_WORKTREE_ONLY_CAPTION,
  useAgentComposerState,
  type AgentComposerPromptRestore,
  type AgentComposerState,
} from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";
import { COMPOSER_REPOSITORY_PREFERENCE_KEY } from "./useAgentComposerRepositoryPreference";

const ALL_PROVIDERS: Readonly<Record<"claudeCode" | "codex", boolean>> = {
  claudeCode: true,
  codex: true,
};

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

  it.each(["claudeCode", "codex"] as const)(
    "selects conversation-scoped attachments for %s across A B A and new",
    (provider) => {
      const base = surfaceThreadView();
      const a = surfaceThreadView({
        thread: {
          ...base.thread,
          threadId: "thread-a",
          provider: { kind: provider, sessionId: "session-abcdefgh" },
        },
      });
      const b = surfaceThreadView({
        thread: {
          ...base.thread,
          threadId: "thread-b",
          provider: { kind: provider, sessionId: "session-ijklmnop" },
        },
      });
      const forDraft = vi.fn((key: string) =>
        composerAttachmentsSurfaceFixture({ refusal: `draft:${key}` }),
      );
      render(
        threadsSurfaceFixture({
          threads: [a, b],
          attachments: composerAttachmentsSurfaceFixture({ forDraft }),
        }),
      );
      act(() => current().navigation.selectThread("thread-a"));
      expect(current().composer.composerProps.attachments?.refusal).toBe("draft:thread-a");
      act(() => current().navigation.selectThread("thread-b"));
      expect(current().composer.composerProps.attachments?.refusal).toBe("draft:thread-b");
      act(() => current().navigation.selectThread("thread-a"));
      expect(current().composer.composerProps.attachments?.refusal).toBe("draft:thread-a");
      act(() => current().navigation.clearSelectedThread());
      expect(current().composer.composerProps.attachments?.refusal).toBe(
        `draft:new:${SURFACE_FIXTURE_ROOT}`,
      );
    },
  );

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

  it("publishes a new draft revision even when batched edits return to the original text", () => {
    render(threadsSurfaceFixture());
    const initial = current().composer.composerProps.promptRevision;
    act(() => {
      current().composer.composerProps.onPromptChange("temporary");
      current().composer.composerProps.onPromptChange("");
    });
    expect(current().composer.composerProps.prompt).toBe("");
    expect(current().composer.composerProps.promptRevision).toBe((initial ?? 0) + 2);
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

  it("steers the running Claude turn instead of blocking the composer", async () => {
    const steer = vi.fn(async () => "sent" as const);
    const sendFollowUp = vi.fn(async () => true);
    const stop = vi.fn(async () => undefined);
    render(threadsSurfaceFixture({ threads: [steerableThreadView()], steer, sendFollowUp, stop }));

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode).toEqual({ kind: "steer", threadId: "agt-1" });
    expect(current().composer.composerProps.running).toBe(true);

    act(() => current().composer.composerProps.onPromptChange("also run the tests"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);

    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(steer).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "also run the tests",
      delivery: "queued",
    });
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(current().composer.composerProps.prompt).toBe("");

    act(() => current().composer.composerProps.onStop?.());
    expect(stop).toHaveBeenCalledWith("agt-1");
  });

  it("shows the running launch even if a next-turn preference is changed", () => {
    const thread = steerableThreadView();
    render(threadsSurfaceFixture({ threads: [thread] }));
    act(() => current().navigation.selectThread("agt-1"));
    const runningLaunch = current().composer.composerProps.launch;
    act(() =>
      current().composer.composerProps.onLaunchChange({
        provider: "claudeCode",
        mode: "bypassPermissions",
        effort: "high",
        model: "opus",
      }),
    );
    expect(current().composer.composerProps.launch).toEqual(runningLaunch);
  });

  it("keeps one steer in flight per thread and ignores the next submit until it settles", async () => {
    let releaseSteer: ((outcome: AgentSteerOutcome) => void) | null = null;
    const pendingSteer = new Promise<AgentSteerOutcome>((resolve) => {
      releaseSteer = resolve;
    });
    const steer = vi.fn(() => pendingSteer);
    render(threadsSurfaceFixture({ threads: [steerableThreadView()], steer }));

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("first"));
    act(() => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(current().composer.composerProps.dispatching).toBe(true);
    expect(current().composer.composerProps.submitBlocked).toBe(true);

    act(() => current().composer.composerProps.onPromptChange("second"));
    act(() => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(steer).toHaveBeenCalledTimes(1);
    expect(current().composer.composerProps.prompt).toBe("second");

    await act(async () => {
      releaseSteer?.("sent");
      await pendingSteer;
    });

    expect(current().composer.composerProps.dispatching).toBe(false);
    expect(current().composer.composerProps.submitBlocked).toBe(false);
  });

  it.each([false, true])(
    "does not restore a refused steer after changing selection (return: %s)",
    async (returnToOrigin) => {
      let settle: (outcome: AgentSteerOutcome) => void = () => undefined;
      const pending = new Promise<AgentSteerOutcome>((resolve) => {
        settle = resolve;
      });
      const first = steerableThreadView();
      const second = { ...first, thread: { ...first.thread, threadId: "agt-2" } };
      render(threadsSurfaceFixture({ threads: [first, second], steer: vi.fn(() => pending) }));
      act(() => current().navigation.selectThread("agt-1"));
      act(() => current().composer.composerProps.onPromptChange("Only for A"));
      act(() =>
        current().composer.composerProps.onSubmit({
          launch: defaultAgentLaunchOptions("claudeCode"),
          dangerousLaunchConfirmed: false,
        }),
      );
      act(() => current().navigation.selectThread("agt-2"));
      if (returnToOrigin) act(() => current().navigation.selectThread("agt-1"));
      await act(async () => {
        settle("kept");
        await pending;
      });
      expect(current().composer.composerProps.prompt).toBe("");
    },
  );

  it("keeps the text in the composer when the steer was refused", async () => {
    const steer = vi.fn(async () => "kept" as const);
    render(threadsSurfaceFixture({ threads: [steerableThreadView()], steer }));

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("wait for me"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(steer).toHaveBeenCalledTimes(1);
    expect(current().composer.composerProps.prompt).toBe("wait for me");
  });

  it("clears the composer when the steer was deferred to the next turn", async () => {
    const steer = vi.fn(async () => "deferred" as const);
    render(threadsSurfaceFixture({ threads: [steerableThreadView()], steer }));

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("and then ship it"));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(current().composer.composerProps.prompt).toBe("");
  });

  it("allows queueing for a running Codex CLI turn that cannot be steered", () => {
    const codex = steerableThreadView("codex");
    render(threadsSurfaceFixture({ agentCliKind: "codex", threads: [codex] }));

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode).toEqual({
      kind: "steer",
      threadId: "agt-1",
    });
    expect(current().composer.composerProps.running).toBe(true);
    act(() => current().composer.composerProps.onPromptChange("next task"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);
  });

  it("continues a server thread through the original composer without a local session", async () => {
    const original = surfaceThreadView();
    const sendFollowUp = vi.fn(async () => true);
    render(
      threadsSurfaceFixture({
        agentCliConfigured: false,
        threads: [
          {
            ...original,
            thread: {
              ...original.thread,
              provider: { ...original.thread.provider, sessionId: null },
            },
            execution: {
              kind: "remote",
              serverId: "server",
              runnerId: "runner",
              projectId: "project",
              conversationId: "conversation",
              latestTaskId: "task",
              resume: { available: true, reason: null },
            },
          },
        ],
        sendFollowUp,
      }),
    );
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Continue on the server"));
    expect(current().composer.composerProps.mode).toEqual({
      kind: "followUp",
      blockedReason: null,
    });
    expect(current().composer.composerProps.worktreeOnly).toBe(true);
    expect(current().composer.composerProps.submitBlocked).toBe(false);
    const launch = defaultAgentLaunchOptions("claudeCode");
    await act(async () =>
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false }),
    );
    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Continue on the server",
      launch,
      dangerousLaunchConfirmed: false,
    });
  });

  it("keeps new server conversations in worktrees even when their project is the active tab", async () => {
    const remoteRoot = "remote:server:runner:project";
    const remoteProject = projectFixture({ rootKey: remoteRoot, isolationPolicy: "worktree" });
    const startThread = vi.fn(async () => ({ threadId: "remote-thread" }));
    render(threadsSurfaceFixture({ startThread }), [remoteProject]);
    act(() => current().composer.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(current().composer.composerProps.worktreeOnly).toBe(true);
    expect(current().composer.composerProps.worktreeOnlyReason).toBeNull();
    act(() => current().composer.composerProps.onIsolationChange("in-place"));
    expect(current().composer.composerProps.isolation).toBe("worktree");
    act(() => current().composer.composerProps.onPromptChange("Run remotely"));
    await act(async () =>
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ isolation: "worktree", projectRootKey: remoteRoot }),
    );
  });

  it("defaults capable server projects to their checkout and allows choosing a worktree", async () => {
    const remoteRoot = "remote:server:runner:project";
    const remoteProject = projectFixture({ rootKey: remoteRoot, isolationPolicy: "in-place" });
    const startThread = vi.fn(async () => ({ threadId: "remote-thread" }));
    render(threadsSurfaceFixture({ startThread }), [remoteProject]);
    act(() => current().composer.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(current().composer.composerProps.worktreeOnly).toBe(false);
    expect(current().composer.composerProps.isolation).toBe("in-place");
    act(() => current().composer.composerProps.onIsolationChange("worktree"));
    expect(current().composer.composerProps.isolation).toBe("worktree");
    act(() => current().composer.composerProps.onPromptChange("Run remotely"));
    await act(async () =>
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ isolation: "worktree" }));
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

  it("restores the typed draft for the same target after the composer is unmounted", () => {
    const drafts = createAgentComposerDraftStore();
    render(threadsSurfaceFixture(), [projectFixture()], ALL_PROVIDERS, drafts);

    act(() => current().composer.composerProps.onPromptChange("Refactor the parser"));
    expect(current().composer.composerProps.prompt).toBe("Refactor the parser");

    act(() => root.unmount());
    root = createRoot(host);
    captured = null;
    render(threadsSurfaceFixture(), [projectFixture()], ALL_PROVIDERS, drafts);

    expect(current().composer.composerProps.prompt).toBe("Refactor the parser");
    expect(current().composer.composerProps.submitBlocked).toBe(false);
  });

  it("keeps a draft per composer target and re-seeds the prompt when the target changes", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );

    act(() => current().composer.composerProps.onPromptChange("New thread draft"));

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode.kind).toBe("followUp");
    expect(current().composer.composerProps.prompt).toBe("");

    act(() => current().composer.composerProps.onPromptChange("Follow-up draft"));

    act(() => current().composer.clearSelection());
    expect(current().composer.composerProps.prompt).toBe("New thread draft");

    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.prompt).toBe("Follow-up draft");
  });

  it("clears the stored draft once the turn is accepted and keeps it when it is refused", async () => {
    const drafts = createAgentComposerDraftStore();
    const sendFollowUp = vi.fn(async () => true);
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()], sendFollowUp }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Continue"));
    expect(drafts.readDraft("agt-1")).toBe("Continue");

    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: true,
      });
    });

    expect(current().composer.composerProps.prompt).toBe("");
    expect(drafts.readDraft("agt-1")).toBe("");
  });

  it("stores a refused follow-up under its own thread after the composer moved on", async () => {
    const drafts = createAgentComposerDraftStore();
    let settle: (sent: boolean) => void = () => undefined;
    const sendFollowUp = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()], sendFollowUp }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Continue"));
    act(() =>
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: true,
      }),
    );
    act(() => current().composer.clearSelection());
    expect(current().composer.composerProps.prompt).toBe("");

    await act(async () => settle(false));

    expect(drafts.readDraft("agt-1")).toBe("Continue");
    expect(current().composer.composerProps.prompt).toBe("");
  });

  it("adopts the typed prompt for a target that gains identity only when it has no draft", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture(),
      [projectFixture({ trust: "untrusted" })],
      ALL_PROVIDERS,
      drafts,
    );
    expect(current().composer.target).toBeNull();

    act(() => current().composer.composerProps.onPromptChange("Typed before trust"));
    render(threadsSurfaceFixture(), [projectFixture()], ALL_PROVIDERS, drafts);

    expect(current().composer.composerProps.prompt).toBe("Typed before trust");
    expect(drafts.readDraft(`new:${SURFACE_FIXTURE_ROOT}`)).toBe("Typed before trust");
  });

  it("prefers the stored draft over the text typed while the target had no identity", () => {
    const drafts = createAgentComposerDraftStore();
    drafts.writeDraft(`new:${SURFACE_FIXTURE_ROOT}`, "Stored draft");
    render(
      threadsSurfaceFixture(),
      [projectFixture({ trust: "untrusted" })],
      ALL_PROVIDERS,
      drafts,
    );

    act(() => current().composer.composerProps.onPromptChange("Typed before trust"));
    render(threadsSurfaceFixture(), [projectFixture()], ALL_PROVIDERS, drafts);

    expect(current().composer.composerProps.prompt).toBe("Stored draft");
    expect(drafts.readDraft(`new:${SURFACE_FIXTURE_ROOT}`)).toBe("Stored draft");
  });

  it("restores the draft when the thread refuses the follow-up", async () => {
    const drafts = createAgentComposerDraftStore();
    const sendFollowUp = vi.fn(async () => false);
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()], sendFollowUp }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );

    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Continue"));

    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: true,
      });
    });

    expect(current().composer.composerProps.prompt).toBe("Continue");
    expect(drafts.readDraft("agt-1")).toBe("Continue");
  });

  it("restores a taken queued message into the focused composer of the same thread", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );
    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.prompt).toBe("");

    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 1, draftKey: "agt-1", text: "and then ship it" },
    );

    expect(current().composer.composerProps.prompt).toBe("and then ship it");
    expect(drafts.readDraft("agt-1")).toBe("and then ship it");
    const field = host.querySelector<HTMLTextAreaElement>(`textarea#${AGENT_COMPOSER_PROMPT_ID}`);
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe("and then ship it".length);
    expect(field?.selectionEnd).toBe("and then ship it".length);
  });

  it("appends a taken queued message after a blank line when the composer holds unsent text", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("half a thought\n\n"));

    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 1, draftKey: "agt-1", text: "and then ship it" },
    );

    const merged = "half a thought\n\nand then ship it";
    expect(current().composer.composerProps.prompt).toBe(merged);
    expect(drafts.readDraft("agt-1")).toBe(merged);
    const field = host.querySelector<HTMLTextAreaElement>(`textarea#${AGENT_COMPOSER_PROMPT_ID}`);
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(merged.length);
  });

  it("applies each taken queued message once and appends the next one below it", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );
    act(() => current().navigation.selectThread("agt-1"));

    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 1, draftKey: "agt-1", text: "first queued" },
    );
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 1, draftKey: "agt-1", text: "first queued" },
    );

    expect(current().composer.composerProps.prompt).toBe("first queued");

    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 2, draftKey: "agt-1", text: "second queued" },
    );

    expect(current().composer.composerProps.prompt).toBe("first queued\n\nsecond queued");
    expect(drafts.readDraft("agt-1")).toBe("first queued\n\nsecond queued");
  });

  it("ignores a restore aimed at another composer target and keeps the typed draft", () => {
    const drafts = createAgentComposerDraftStore();
    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
    );
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("keep me"));

    render(
      threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      [projectFixture()],
      ALL_PROVIDERS,
      drafts,
      { token: 1, draftKey: "agt-other", text: "foreign text" },
    );

    expect(current().composer.composerProps.prompt).toBe("keep me");
    expect(drafts.readDraft("agt-other")).toBe("");
  });

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture()],
    providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>> = {
      claudeCode: true,
      codex: true,
    },
    drafts?: AgentComposerDraftStore,
    promptRestore: AgentComposerPromptRestore | null = null,
  ): void {
    act(() => {
      root.render(
        <Harness
          agents={agents}
          projects={projects}
          providerEnabled={providerEnabled}
          drafts={drafts}
          promptRestore={promptRestore}
        />,
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
    drafts,
    promptRestore = null,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>>;
    readonly drafts?: AgentComposerDraftStore;
    readonly promptRestore?: AgentComposerPromptRestore | null;
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
      drafts,
      groups,
      projects,
      promptRestore,
      providerEnabled,
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    captured = { composer, navigation };
    return (
      <textarea
        id={AGENT_COMPOSER_PROMPT_ID}
        onChange={(event) => composer.composerProps.onPromptChange(event.target.value)}
        value={composer.composerProps.prompt}
      />
    );
  }
});

function steerableThreadView(provider: AgentCliKind = "claudeCode"): AgentThreadView {
  const base = surfaceThreadView();
  const running: AgentTurn = {
    turnId: "agt-1-t1",
    prompt: "Refactor the parser",
    status: { kind: "running" },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: defaultAgentLaunchOptions(provider),
    cliVersion: null,
  };
  return {
    ...base,
    lifecycle: "running",
    thread: {
      ...base.thread,
      provider: { ...base.thread.provider, kind: provider },
      turns: [running],
    },
  };
}
