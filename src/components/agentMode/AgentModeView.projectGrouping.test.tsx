// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveAgentProjectGroupingMode,
  saveAgentProjectGroupingOverride,
} from "../../application/agentProjectGroupingPreference";
import type { AgentThreadStartRequest, AgentThreadView } from "../../application/agentThreadPorts";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const APP = "/workspace/app";
const CLONE = "/workspace/app-clone";
const DOCS = "/workspace/docs";
const IDENTITY = "github.com/acme/app";

function project(rootKey: string, label: string, repositoryIdentity?: string) {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${label}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }),
  });
}

function threadIn(threadId: string, rootKey: string, label: string): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: label,
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${label}`, repositoryRoot: rootKey },
    },
  });
}

const projects: ReadonlyArray<AgentProjectDescriptor> = [
  project(APP, "app", IDENTITY),
  project(CLONE, "app-clone", IDENTITY),
  project(DOCS, "docs"),
];
const threads = [
  threadIn("a1", APP, "app"),
  threadIn("c1", CLONE, "app-clone"),
  threadIn("d1", DOCS, "docs"),
];

const startThread = vi.fn(async (request: AgentThreadStartRequest) => ({
  threadId: `agt-${request.projectRootKey}`,
}));

function props(): AgentModeViewProps {
  return {
    agents: {
      ...threadsSurfaceFixture({
        startThread,
        threads,
        repositories: projects.map((entry) => fixtureRepository(entry.rootKey, "")),
      }),
      providerManagement: unconfiguredAgentProviderManagement(),
    },
    projects,
    workspaceRoot: APP,
    overflowRootPaths: [],
    providerEnabled: { claudeCode: true, codex: true },
    chrome: chromeFixture(),
    onTrustProject: () => undefined,
    onReleaseProject: () => undefined,
  };
}

describe("agent sidebar project grouping modes", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    startThread.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function railGroups(): ReadonlyArray<ReadonlyArray<string>> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].map((group) =>
      [...group.querySelectorAll<HTMLElement>("[data-thread-id]")]
        .map((row) => row.dataset.threadId ?? "")
        .sort(),
    );
  }

  function openComposerIn(rootKey: string): void {
    let opened = false;
    act(() => {
      opened = workbenchAgentPaletteProvider.current()?.newThreadIn(rootKey) ?? false;
    });
    expect(opened).toBe(true);
  }

  function submitButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('button[type="submit"]');
  }

  async function submitPrompt(prompt: string): Promise<void> {
    const field = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(field).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        prompt,
      );
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  function startedOwners(): ReadonlyArray<ReadonlyArray<string>> {
    return startThread.mock.calls.map(([request]) => [
      request.prompt,
      request.projectRootKey,
      request.repositoryRoot,
    ]);
  }

  it("groups checkouts of one repository by default", () => {
    act(() => root.render(<AgentModeView {...props()} />));
    expect(railGroups()).toEqual([["a1", "c1"], ["d1"]]);
  });

  it("applies a stored separate mode and follows live setting changes", () => {
    saveAgentProjectGroupingMode("separate");
    act(() => root.render(<AgentModeView {...props()} />));
    expect(railGroups()).toEqual([["a1"], ["c1"], ["d1"]]);
    act(() => {
      saveAgentProjectGroupingMode("repository");
    });
    expect(railGroups()).toEqual([["a1", "c1"], ["d1"]]);
    act(() => {
      saveAgentProjectGroupingOverride(CLONE, "separate");
    });
    expect(railGroups()).toEqual([["a1"], ["c1"], ["d1"]]);
    act(() => {
      saveAgentProjectGroupingOverride(CLONE, null);
    });
    expect(railGroups()).toEqual([["a1", "c1"], ["d1"]]);
  });

  it("never guesses a member of a grouped project and starts in the exact project once separate", async () => {
    act(() => root.render(<AgentModeView {...props()} />));
    expect(railGroups()).toEqual([["a1", "c1"], ["d1"]]);
    openComposerIn(CLONE);
    expect(host.querySelector("form")?.textContent).toContain(
      "Choose a project in the rail to start a thread.",
    );
    expect(submitButton()?.disabled).toBe(true);
    await submitPrompt("grouped clone");
    expect(startThread).not.toHaveBeenCalled();

    act(() => {
      saveAgentProjectGroupingOverride(CLONE, "separate");
    });
    expect(railGroups()).toEqual([["a1"], ["c1"], ["d1"]]);
    openComposerIn(CLONE);
    expect(host.querySelector('[aria-label="New thread in app-clone"]')).not.toBeNull();
    await submitPrompt("separate clone");
    openComposerIn(APP);
    expect(host.querySelector('[aria-label="New thread in app"]')).not.toBeNull();
    await submitPrompt("separate app");
    expect(startedOwners()).toEqual([
      ["separate clone", CLONE, CLONE],
      ["separate app", APP, APP],
    ]);
  });
});
