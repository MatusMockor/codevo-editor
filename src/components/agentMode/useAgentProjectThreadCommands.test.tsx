// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupedEnvironmentProjects,
  newThreadEnvironmentProjectRootKey,
} from "./agentEnvironmentProjects";
import { agentProjectGroups } from "./agentModePresentation";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  useAgentProjectThreadCommands,
  type AgentProjectThreadCommands,
  type AgentProjectThreadCommandsOptions,
} from "./useAgentProjectThreadCommands";

describe("new-thread command draft launch ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  let commands: AgentProjectThreadCommands;
  let options: AgentProjectThreadCommandsOptions;
  const projectRootKey = "/workspace/app";

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    options = {
      navigation: {
        newThreadTarget: () => ({ projectRootKey, repositoryRoot: projectRootKey }),
        setProjectScope: vi.fn(() => true),
        scopeEntries: [],
      },
      groups: [],
      composer: {
        clearSelection: vi.fn(),
        clearDraftTarget: vi.fn(),
        resetDraftLaunch: vi.fn(),
        resetProjectDraftLaunch: vi.fn(),
      },
      picker: null,
      activeProjectRootKey: () => projectRootKey,
      onBeforeProjectChange: vi.fn(),
      onSelectProjectEnvironment: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness() {
    commands = useAgentProjectThreadCommands(options);
    return null;
  }

  function mount(): void {
    act(() => root.render(<Harness />));
  }

  it("resets the current draft with its exact selected repository scope", () => {
    mount();
    act(() => commands.createInCurrentProject());

    expect(options.composer.resetDraftLaunch).toHaveBeenCalledExactlyOnceWith(projectRootKey);
    expect(options.composer.resetProjectDraftLaunch).not.toHaveBeenCalled();
    expect(options.navigation.setProjectScope).not.toHaveBeenCalled();
    expect(options.composer.clearSelection).toHaveBeenCalledOnce();
  });

  it("resets a newly selected project without inheriting the previous precise scope", () => {
    mount();
    act(() => expect(commands.newThreadInProject(projectRootKey)).toBe(true));

    expect(options.navigation.setProjectScope).toHaveBeenCalledExactlyOnceWith(projectRootKey);
    expect(options.composer.resetProjectDraftLaunch).toHaveBeenCalledExactlyOnceWith(
      projectRootKey,
    );
    expect(options.composer.resetDraftLaunch).not.toHaveBeenCalled();
    expect(options.composer.clearSelection).toHaveBeenCalledOnce();
  });

  it("leaves draft launches intact when selecting the project fails", () => {
    options = {
      ...options,
      navigation: { ...options.navigation, setProjectScope: () => false },
    };
    mount();
    act(() => expect(commands.newThreadInProject(projectRootKey)).toBe(false));

    expect(options.composer.resetProjectDraftLaunch).not.toHaveBeenCalled();
    expect(options.composer.resetDraftLaunch).not.toHaveBeenCalled();
    expect(options.composer.clearSelection).not.toHaveBeenCalled();
  });

  it("preserves an old precise remote draft when a new project scope has ambiguous server members", () => {
    const local = projectFixture({ rootKey: projectRootKey, rootPath: projectRootKey });
    const remote = projectFixture({
      rootKey: "remote:linux:runner:first",
      rootPath: "remote:linux:runner:first",
      ownerId: "first",
    });
    const second = projectFixture({
      rootKey: "remote:linux:runner:second",
      rootPath: "remote:linux:runner:second",
      ownerId: "second",
    });
    const projects = [local, remote, second];
    const groups = groupedEnvironmentProjects(
      agentProjectGroups(projects, [], []),
      projects,
      new Map([
        [remote.rootKey, local.rootKey],
        [second.rootKey, local.rootKey],
      ]),
    );
    const exactScope = {
      kind: "repository" as const,
      projectRootKey: remote.rootKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    };
    const choices = new Set([remote.rootKey]);
    options = {
      ...options,
      groups,
      composer: {
        ...options.composer,
        resetDraftLaunch: (rootKey) => {
          const target = newThreadEnvironmentProjectRootKey(
            rootKey,
            groups,
            projects,
            "linux",
            exactScope,
          );
          if (target !== null) choices.delete(target);
        },
        resetProjectDraftLaunch: (rootKey) => {
          const target = newThreadEnvironmentProjectRootKey(rootKey, groups, projects, "linux");
          if (target !== null) choices.delete(target);
        },
      },
    };
    mount();
    act(() => expect(commands.newThreadInProject(projectRootKey)).toBe(true));
    expect(choices.has(remote.rootKey)).toBe(true);

    act(() => commands.createInCurrentProject());
    expect(choices.has(remote.rootKey)).toBe(false);
  });
});
