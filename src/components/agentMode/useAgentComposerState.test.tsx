// @vitest-environment jsdom

import { act } from "react";
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
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

interface Captured {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
}

describe("useAgentComposerState", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: Captured | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
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
    expect(refreshIsolationStatus).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);

    act(() => current().composer.composerProps.onPromptChange("Refactor the parser"));
    expect(current().composer.composerProps.submitBlocked).toBe(false);

    act(() => current().composer.composerProps.onSelectRepository(FIXTURE_NESTED_ROOT));
    expect(current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);

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

  it("requires the unsafe in-place confirmation key and forwards it on start", async () => {
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
    );
    act(() => current().composer.composerProps.onPromptChange("Go"));
    expect(current().composer.composerProps.submitBlocked).toBe(true);

    act(() => current().composer.composerProps.onUnsafeConfirmedChange(true));
    expect(current().composer.composerProps.unsafeConfirmed).toBe(true);
    expect(current().composer.composerProps.submitBlocked).toBe(false);

    act(() => current().composer.composerProps.onIsolationChange("worktree"));
    expect(current().composer.composerProps.isolation).toBe("worktree");
    expect(current().composer.composerProps.unsafeConfirmed).toBe(false);

    act(() => current().composer.composerProps.onIsolationChange("in-place"));
    act(() => current().composer.composerProps.onUnsafeConfirmedChange(true));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ isolation: "in-place", unsafeInPlaceConfirmationKey: "confirm-1" }),
    );
    expect(current().composer.composerProps.unsafeConfirmed).toBe(false);
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

  it("seeds the launch from the remembered project launch and resets the dangerous confirmation on change", () => {
    const remembered: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "default",
    };
    render(threadsSurfaceFixture({ lastUsedLaunch: () => remembered }));

    expect(current().composer.composerProps.launch).toEqual(remembered);

    act(() => current().composer.composerProps.onDangerousConfirmedChange(true));
    expect(current().composer.composerProps.dangerousConfirmed).toBe(true);

    act(() =>
      current().composer.composerProps.onLaunchChange(defaultAgentLaunchOptions("claudeCode")),
    );
    expect(current().composer.composerProps.launch).toEqual(
      defaultAgentLaunchOptions("claudeCode"),
    );
    expect(current().composer.composerProps.dangerousConfirmed).toBe(false);
  });

  it("clears the selected thread and unsafe confirmation when starting fresh", () => {
    render(threadsSurfaceFixture({ threads: [surfaceThreadView()] }));
    act(() => current().navigation.selectThread("agt-1"));
    expect(current().composer.composerProps.mode.kind).toBe("followUp");

    act(() => current().composer.clearSelection());

    expect(current().navigation.selectedThreadId).toBeNull();
    expect(current().composer.composerProps.mode).toEqual({ kind: "new" });
  });

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture()],
  ): void {
    act(() => {
      root.render(<Harness agents={agents} projects={projects} />);
    });
  }

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
    const groups = agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees);
    const navigation = useAgentThreadNavigation({ agents, groups });
    const composer = useAgentComposerState({
      agents,
      groups,
      projects,
      railScope: navigation.railScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectThread,
    });
    captured = { composer, navigation };
    return null;
  }
});
