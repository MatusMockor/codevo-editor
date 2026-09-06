// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import { AgentLaunchControls } from "./AgentLaunchControls";
import { agentComposerCheckoutOptions } from "./agentComposerCheckout";
import { useAgentComposerState } from "./useAgentComposerState";
import { agentProjectGroups } from "./agentModePresentation";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";

vi.mock("./AgentLaunchControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentLaunchControls")>();
  return { ...actual, AgentLaunchControls: vi.fn(actual.AgentLaunchControls) };
});

vi.mock("./agentComposerCheckout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentComposerCheckout")>();
  return { ...actual, agentComposerCheckoutOptions: vi.fn(actual.agentComposerCheckoutOptions) };
});

describe("AgentComposer render boundaries", () => {
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
    vi.clearAllMocks();
  });

  it.each([6, 128, 512])("keeps unchanged controls out of %i-repository prompt edits", (count) => {
    const props = fixture(count);
    render(props);
    click("#agent-checkout");
    vi.mocked(AgentLaunchControls).mockClear();
    vi.mocked(agentComposerCheckoutOptions).mockClear();

    for (let index = 1; index <= 20; index += 1) {
      render({ ...props, prompt: `Prompt ${index}`, promptBytes: 9 });
    }

    expect(host.querySelector("textarea")?.value).toBe("Prompt 20");
    expect(host.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    expect(AgentLaunchControls).not.toHaveBeenCalled();
    expect(agentComposerCheckoutOptions).not.toHaveBeenCalled();
  });

  it("updates control authority and callbacks immediately after prompt edits", () => {
    const props = fixture(6);
    render(props);
    render({ ...props, prompt: "Current prompt", promptBytes: 14 });
    const onRefreshIsolation = vi.fn();
    const onSelectRepository = vi.fn();
    const onLaunchChange = vi.fn();
    const launch: AgentComposerProps["launch"] = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "default",
      effort: "default",
    };
    const updated = { ...props, launch, onLaunchChange, onRefreshIsolation, onSelectRepository };
    render(updated);

    const latestLaunch = vi.mocked(AgentLaunchControls).mock.lastCall?.[0];
    expect(latestLaunch?.launch.model).toBe("sonnet");
    expect(latestLaunch?.onLaunchChange).toBe(onLaunchChange);
    click("#agent-checkout");
    expect(onRefreshIsolation).toHaveBeenCalledOnce();
    click('[data-value="root:/workspace/app/repo-1"]');
    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/repo-1");

    render({ ...updated, dispatching: true });
    expect(vi.mocked(AgentLaunchControls).mock.lastCall?.[0].disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("#agent-checkout")?.disabled).toBe(true);
    render({ ...updated, providerEnabled: { claudeCode: false, codex: false } });
    expect(vi.mocked(AgentLaunchControls).mock.lastCall?.[0].disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  });

  it("rebinds checkout selection to the latest target and isolation callbacks", () => {
    const props = fixture(6);
    render(props);
    const onIsolationChange = vi.fn();
    const onSelectRepository = vi.fn();
    const target = {
      projectLabel: "other",
      projectRoot: "/workspace/other",
      selectedRepositoryRoot: "/workspace/other",
      repositoryOptions: [{ repositoryRoot: "/workspace/other/api", label: "api" }],
    };
    render({ ...props, target, onIsolationChange, onSelectRepository, prompt: "Latest" });
    click("#agent-checkout");
    expect(host.querySelector('[data-value="root:/workspace/app/repo-1"]')).toBeNull();
    click('[data-value="root:/workspace/other/api"]');
    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/other/api");
    click("#agent-checkout");
    click('[data-value="worktree"]');
    expect(onIsolationChange).toHaveBeenCalledWith("worktree");
    expect(props.onSelectRepository).not.toHaveBeenCalled();
    expect(props.onIsolationChange).not.toHaveBeenCalled();
  });

  it.each(["ready", "notRepository"] as const)(
    "retains search and page when an opening refresh becomes %s",
    async (settledKind) => {
      const props = fixture(128);
      const target = props.target;
      if (target === null) throw new Error("Expected target fixture");
      let settleRefresh: (() => void) | undefined;
      const refresh = new Promise<void>((resolve) => {
        settleRefresh = resolve;
      });
      let projects = [
        projectFixture({
          repositories: target.repositoryOptions.map((option) =>
            fixtureRepository(option.repositoryRoot, option.label),
          ),
        }),
      ];
      const baseAgents = threadsSurfaceFixture();
      let groups = agentProjectGroups(projects, baseAgents.threads, baseAgents.orphanedWorktrees);
      function RefreshingComposer() {
        const [settled, setSettled] = useState(false);
        const refreshIsolationStatus = useCallback(async () => {
          await refresh;
          setSettled(true);
        }, []);
        const composer = useAgentComposerState({
          agents: {
            ...baseAgents,
            refreshIsolationStatus,
            isolationPreview: (repositoryRoot) => ({
              repositoryRoot,
              repositoryStatus: settled ? { kind: settledKind } : { kind: "checking" },
              recommended: { kind: "in-place" },
              inPlaceGuard: { kind: "safe" },
              inPlaceAllowed: true,
              confirmationKey: null,
            }),
          },
          projects,
          groups,
          providerEnabled: props.providerEnabled,
          railScope: null,
          selectedThread: null,
          onClearSelectedThread: props.onNewThread,
          onThreadStarted: () => undefined,
        });
        return (
          <AgentComposer
            {...composer.composerProps}
            providerEnabled={props.providerEnabled}
            onOpenProviderSettings={props.onOpenProviderSettings}
          />
        );
      }
      act(() => root.render(<RefreshingComposer />));
      click("#agent-checkout");
      const search = host.querySelector<HTMLInputElement>('input[type="search"]');
      if (search === null) throw new Error("Expected search");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      act(() => {
        setter?.call(search, "repo-");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      click('[aria-label="Next repository page"]');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(host.querySelector('[data-value="root:/workspace/app/repo-50"]')).not.toBeNull();
      await act(async () => {
        settleRefresh?.();
        await refresh;
      });
      expect(search.value).toBe("repo-");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(host.querySelector('[data-value="root:/workspace/app/repo-50"]')).not.toBeNull();
      expect(host.querySelector('[data-value="root:/workspace/app/repo-0"]')).toBeNull();
      expect(host.textContent).not.toContain("Checking repository...");
      projects = projects.map((project) => ({ ...project, generation: project.generation + 1 }));
      groups = agentProjectGroups(projects, baseAgents.threads, baseAgents.orphanedWorktrees);
      act(() => root.render(<RefreshingComposer />));
      expect(search.value).toBe("");
      expect(host.querySelector('[data-value="root:/workspace/app/repo-0"]')).not.toBeNull();
    },
  );

  function render(props: AgentComposerProps): void {
    act(() => root.render(<AgentComposer {...props} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }
});

function fixture(count: number): AgentComposerProps {
  return {
    target: {
      projectLabel: "app",
      projectRoot: "/workspace/app",
      selectedRepositoryRoot: "/workspace/app",
      repositoryOptions: Array.from({ length: count }, (_, index) => ({
        repositoryRoot: `/workspace/app/repo-${index}`,
        label: `repo-${index}`,
      })),
    },
    prompt: "",
    promptBytes: 0,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "new" },
    onSelectRepository: vi.fn(),
    onPromptChange: vi.fn(),
    onIsolationChange: vi.fn(),
    onLaunchChange: vi.fn(),
    onNewThread: vi.fn(),
    onOpenProviderSettings: vi.fn(),
    onSubmit: vi.fn(),
  };
}
