// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import {
  createSessionRestoreFlushRegistry,
  type SessionRestoreFlushRegistry,
} from "../../application/sessionRestorePersistence";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  AGENT_PROJECT_SELECTION_STORAGE_KEY,
  BrowserAgentProjectSelectionPreference,
} from "../../infrastructure/browserAgentProjectSelectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";
import { useRestoredAgentNavigationSession } from "./useRestoredAgentNavigationSession";

const OTHER_ROOT = "/workspace/api";
const CLONE_ROOT = "/workspace/app-clone";
const NO_LINKS: ReadonlyMap<string, string> = new Map();

type MemoryStorage = KeyValueStorage & { readonly values: Map<string, string> };

describe("agent thread selection restore across relaunch", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentThreadNavigation | null;
  let storage: MemoryStorage;
  let registry: SessionRestoreFlushRegistry;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    storage = memoryStorage();
    registry = createSessionRestoreFlushRegistry();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("reopens the thread that was selected when the app quit once its project loads", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    relaunch();

    render(surface([], new Set()), [project({ ownerId: "workspace-run-2" })]);
    expect(current().selectedThreadId).toBeNull();

    const reloaded = [view("agt-1", "workspace-run-2"), view("agt-2", "workspace-run-2")];
    render(surface(reloaded), [project({ ownerId: "workspace-run-2" })]);

    expect(current().selectedThreadId).toBe("agt-2");
    expect(current().railScope?.projectRootKey).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("restores immediately when the threads are already loaded at mount", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-1"));
    relaunch();

    render(surface([view("agt-1"), view("agt-2")]));

    expect(current().selectedThreadId).toBe("agt-1");
  });

  it("keeps the new-thread composer when that is where the user left the project", () => {
    render(surface([view("agt-1")]));
    act(() => current().selectThread("agt-1"));
    act(() => current().clearSelectedThread());
    relaunch();

    render(surface([view("agt-1")]));

    expect(current().selectedThreadId).toBeNull();
  });

  it("drops the restore when the loaded project no longer has the thread", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    relaunch();

    render(surface([view("agt-1")]));
    expect(current().selectedThreadId).toBeNull();
    render(surface([view("agt-1"), view("agt-2")]));

    expect(current().selectedThreadId).toBeNull();
  });

  it.each([
    ["archived", (thread: AgentThreadView) => archived(thread)],
    [
      "moved to another repository",
      (thread: AgentThreadView) => inRepository(thread, "/elsewhere"),
    ],
  ])("refuses to restore a thread that was %s", (_label, mutate) => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    relaunch();

    render(surface([view("agt-1"), mutate(view("agt-2"))]));

    expect(current().selectedThreadId).toBeNull();
  });

  it("never restores into an untrusted project and waits while trust is unknown", () => {
    render(surface([view("agt-1")]));
    act(() => current().selectThread("agt-1"));
    relaunch();

    render(surface([view("agt-1")]), [project({ trust: "unknown" })]);
    expect(current().selectedThreadId).toBeNull();
    render(surface([view("agt-1")]), [project({ trust: "trusted" })]);
    expect(current().selectedThreadId).toBe("agt-1");

    relaunch();
    render(surface([view("agt-1")]), [project({ trust: "untrusted" })]);
    render(surface([view("agt-1")]), [project({ trust: "trusted" })]);
    expect(current().selectedThreadId).toBeNull();
  });

  it("does nothing when the remembered project is gone", () => {
    render(surface([view("agt-1")]));
    act(() => current().selectThread("agt-1"));
    relaunch();

    render(surface([viewIn("agt-9", OTHER_ROOT)]), [otherProject()]);

    expect(current().selectedThreadId).toBeNull();
    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);
  });

  it("lets a user choice made while the project is still loading win over the restore", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    relaunch();

    render(surface([view("agt-1")], new Set()));
    act(() => current().selectThread("agt-1"));
    render(surface([view("agt-1"), view("agt-2")]));
    expect(current().selectedThreadId).toBe("agt-1");

    relaunch();
    render(surface([], new Set()));
    act(() => current().clearSelectedThread());
    render(surface([view("agt-1"), view("agt-2")]));
    expect(current().selectedThreadId).toBeNull();
  });

  it("restores the last thread of another project when the user switches to it", () => {
    const projects = [project(), otherProject()];
    const threads = [view("agt-1"), viewIn("agt-api", OTHER_ROOT)];
    render(surface(threads, new Set([SURFACE_FIXTURE_ROOT, OTHER_ROOT])), projects);
    act(() => current().selectThread("agt-api"));
    act(() => current().selectThread("agt-1"));
    relaunch();

    render(surface(threads, new Set([SURFACE_FIXTURE_ROOT, OTHER_ROOT])), projects);
    expect(current().selectedThreadId).toBe("agt-1");
    act(() => expect(current().setProjectScope(OTHER_ROOT)).toBe(true));

    expect(current().selectedThreadId).toBe("agt-api");
  });

  it("waits for every member of a merged project group before giving up", () => {
    const projects = [grouped(SURFACE_FIXTURE_ROOT), grouped(CLONE_ROOT)];
    const cloneThread = viewIn("agt-clone", CLONE_ROOT);
    const both = new Set([SURFACE_FIXTURE_ROOT, CLONE_ROOT]);
    render(surface([view("agt-1"), cloneThread], both), projects);
    act(() => current().selectThread("agt-clone"));
    expect(current().railScope?.memberProjectRootKeys).toEqual([SURFACE_FIXTURE_ROOT, CLONE_ROOT]);
    relaunch();

    render(surface([view("agt-1")], new Set([SURFACE_FIXTURE_ROOT])), projects);
    expect(current().selectedThreadId).toBeNull();
    render(surface([view("agt-1"), cloneThread], both), projects);

    expect(current().selectedThreadId).toBe("agt-clone");
  });

  it("keeps the remembered thread for the next launch when this launch refuses it", () => {
    render(surface([view("agt-1")]));
    act(() => current().selectThread("agt-1"));
    relaunch();

    render(surface([view("agt-1")]), [project({ trust: "untrusted" })]);
    expect(current().selectedThreadId).toBeNull();
    relaunch();

    render(surface([view("agt-1")]));
    expect(current().selectedThreadId).toBe("agt-1");
  });

  it("keeps the fresh composer of a re-added project instead of restoring over it", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    relaunch();

    render(surface([], new Set()), [otherProject()]);
    render(surface([], new Set()), [otherProject(), project()]);
    act(() => {
      current().setProjectScope(SURFACE_FIXTURE_ROOT);
      current().setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      });
      current().clearSelectedThread();
    });
    render(surface([view("agt-1"), view("agt-2")]), [otherProject(), project()]);

    expect(current().railScope?.projectRootKey).toBe(SURFACE_FIXTURE_ROOT);
    expect(current().selectedThreadId).toBeNull();
  });

  it("forgets a deleted thread so it is not restored", () => {
    render(surface([view("agt-1"), view("agt-2")]));
    act(() => current().selectThread("agt-2"));
    act(() => current().forgetThread("agt-2"));
    relaunch();

    expect(storage.values.get(AGENT_PROJECT_SELECTION_STORAGE_KEY) ?? "").not.toContain("agt-2");
    render(surface([view("agt-1"), view("agt-2")]));
    expect(current().selectedThreadId).toBeNull();
  });

  it("starts from defaults when the persisted selection is corrupt", () => {
    storage.values.set(AGENT_PROJECT_SELECTION_STORAGE_KEY, '{"version":1,"selections":"x"}');

    render(surface([view("agt-1")]));

    expect(current().selectedThreadId).toBeNull();
  });

  function relaunch(): void {
    act(() => root.unmount());
    registry.flushAll();
    root = createRoot(host);
    captured = null;
  }

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [project()],
  ): void {
    act(() => {
      root.render(
        <Harness agents={agents} projects={projects} registry={registry} storage={storage} />,
      );
    });
  }

  function current(): AgentThreadNavigation {
    expect(captured).not.toBeNull();
    return captured as AgentThreadNavigation;
  }

  function Harness({
    agents,
    projects,
    registry: flushRegistry,
    storage: backing,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly registry: SessionRestoreFlushRegistry;
    readonly storage: KeyValueStorage;
  }) {
    const preference = useMemo(
      () => new BrowserAgentProjectSelectionPreference(backing),
      [backing],
    );
    const session = useRestoredAgentNavigationSession(preference, { registry: flushRegistry });
    const groups = useMemo(
      () =>
        groupedEnvironmentProjects(
          agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
          projects,
          NO_LINKS,
        ),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    captured = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
      session,
    });
    return <div ref={captured.centerRef} />;
  }
});

function surface(
  threads: ReadonlyArray<AgentThreadView>,
  loaded: ReadonlySet<string> = new Set([SURFACE_FIXTURE_ROOT]),
): AgentThreadsSurface {
  return threadsSurfaceFixture({ threads, loadedProjectRootKeys: loaded });
}

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return projectFixture(overrides);
}

function grouped(rootKey: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${rootKey}`,
    repositoryIdentity: "github.com/acme/app",
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function otherProject(): AgentProjectDescriptor {
  return projectFixture({
    rootKey: OTHER_ROOT,
    rootPath: OTHER_ROOT,
    ownerId: `agent-root:${OTHER_ROOT}`,
    label: "api",
    repositories: [fixtureRepository(OTHER_ROOT, "")],
  });
}

function view(threadId: string, ownerId = "agent-root:app"): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({ thread: { ...base, threadId, owner: { ...base.owner, ownerId } } });
}

function viewIn(threadId: string, rootKey: string): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
    },
  });
}

function archived(view: AgentThreadView): AgentThreadView {
  return surfaceThreadView({ thread: { ...view.thread, archived: true } });
}

function inRepository(view: AgentThreadView, repositoryRoot: string): AgentThreadView {
  return surfaceThreadView({
    thread: { ...view.thread, owner: { ...view.thread.owner, repositoryRoot } },
  });
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
