// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadsSurface,
  AgentThreadView,
  ExternalSessionsSurface,
} from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  FIXTURE_NESTED_ROOT,
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { AGENT_THREAD_FIND_DEBOUNCE_MS } from "./useAgentThreadFind";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

const OTHER_ROOT = "/workspace/api";
const THIRD_ROOT = "/workspace/web";

describe("useAgentThreadNavigation", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentThreadNavigation | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("selects threads, marks them viewed, and forgets a removed selection", () => {
    const markThreadViewed = vi.fn();
    render(threadsSurfaceFixture({ threads: [view("agt-1"), view("agt-2")], markThreadViewed }));

    expect(current().selectedThread).toBeNull();
    expect(current().commands.threadSelected()).toBe(false);

    act(() => current().selectThread("agt-2"));
    expect(current().selectedThread?.thread.threadId).toBe("agt-2");
    expect(current().commands.threadSelected()).toBe(true);
    expect(markThreadViewed).toHaveBeenCalledWith("agt-2");

    act(() => current().forgetThread("agt-1"));
    expect(current().selectedThreadId).toBe("agt-2");

    act(() => current().forgetThread("agt-2"));
    expect(current().selectedThreadId).toBeNull();

    act(() => current().selectThread("agt-1"));
    act(() => current().clearSelectedThread());
    expect(current().selectedThreadId).toBeNull();
  });

  it("walks previous, next, and jump slots over the rail order", () => {
    render(threadsSurfaceFixture({ threads: [view("agt-1"), view("agt-2"), view("agt-3")] }));

    act(() => current().commands.nextThread());
    expect(current().selectedThreadId).toBe("agt-1");
    act(() => current().commands.nextThread());
    expect(current().selectedThreadId).toBe("agt-2");
    act(() => current().commands.previousThread());
    expect(current().selectedThreadId).toBe("agt-1");
    act(() => current().commands.jumpToThread(3));
    expect(current().selectedThreadId).toBe("agt-3");
    act(() => current().commands.jumpToThread(9));
    expect(current().selectedThreadId).toBe("agt-3");
  });

  it("scopes the rail to the project and preserves the requested new-thread repository", () => {
    const nested = view("agt-nested", FIXTURE_NESTED_ROOT);
    render(threadsSurfaceFixture({ threads: [view("agt-1"), nested] }));

    expect(current().railScope).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    expect(current().newThreadTarget()).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });

    act(() =>
      current().setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: FIXTURE_NESTED_ROOT,
      }),
    );

    expect(current().newThreadTarget()).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: FIXTURE_NESTED_ROOT,
    });
    act(() => current().commands.jumpToThread(1));
    expect(current().selectedThreadId).toBe("agt-1");
  });

  it("defaults the scope to the first open project and drops it without any project", () => {
    render(threadsSurfaceFixture(), [project(OTHER_ROOT, "api"), projectFixture()]);
    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);

    render(threadsSurfaceFixture(), []);
    expect(current().railScope).toBeNull();
    expect(current().composerScope).toBeNull();
    expect(current().scopeEntries).toEqual([]);
    expect(current().newThreadTarget()).toBeNull();
  });

  it("defaults the scope to the project owning the selected thread", () => {
    const foreign = viewInProject("agt-foreign", OTHER_ROOT);
    render(threadsSurfaceFixture({ threads: [foreign] }), []);
    expect(current().railScope).toBeNull();

    act(() => current().selectThread("agt-foreign"));
    render(threadsSurfaceFixture({ threads: [foreign] }), [
      projectFixture(),
      project(OTHER_ROOT, "api"),
    ]);

    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);
  });

  it("moves the scope to the neighbouring project when the scoped project closes", () => {
    const all = [projectFixture(), project(OTHER_ROOT, "api"), project(THIRD_ROOT, "web")];
    render(threadsSurfaceFixture(), all);
    act(() => current().setRailScope({ projectRootKey: OTHER_ROOT, repositoryRoot: OTHER_ROOT }));
    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);

    render(threadsSurfaceFixture(), [projectFixture(), project(THIRD_ROOT, "web")]);
    expect(current().railScope?.projectRootKey).toBe(THIRD_ROOT);

    render(threadsSurfaceFixture(), [projectFixture()]);
    expect(current().railScope?.projectRootKey).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("keeps the scope on a project that drains after its tab closed", () => {
    const draining = { ...project(OTHER_ROOT, "api"), origin: "closed-tab-live-tasks" as const };
    render(threadsSurfaceFixture(), [projectFixture(), project(OTHER_ROOT, "api")]);
    act(() => current().setRailScope({ projectRootKey: OTHER_ROOT, repositoryRoot: OTHER_ROOT }));

    render(threadsSurfaceFixture(), [projectFixture(), draining]);

    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);
    expect(current().scopeEntries.map((entry) => entry.projectRootKey)).toEqual([
      SURFACE_FIXTURE_ROOT,
      OTHER_ROOT,
    ]);
    expect(current().newThreadTarget()).toBeNull();
  });

  it("keeps the scope when another project closes", () => {
    render(threadsSurfaceFixture(), [
      projectFixture(),
      project(OTHER_ROOT, "api"),
      project(THIRD_ROOT, "web"),
    ]);
    act(() => current().setRailScope({ projectRootKey: OTHER_ROOT, repositoryRoot: OTHER_ROOT }));

    render(threadsSurfaceFixture(), [project(OTHER_ROOT, "api"), project(THIRD_ROOT, "web")]);
    expect(current().railScope?.projectRootKey).toBe(OTHER_ROOT);
    expect(current().composerScope?.kind).toBe("repository");
  });

  it("re-establishes the scope authority when the scoped project owner is replaced", () => {
    render(threadsSurfaceFixture(), [projectFixture({ generation: 1 })]);
    act(() =>
      current().setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    );
    expect(current().composerScope).toEqual({
      kind: "repository",
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: projectFixture().ownerId,
      generation: 1,
    });

    render(threadsSurfaceFixture(), [projectFixture({ ownerId: "owner-b", generation: 2 })]);

    expect(current().railScope).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    expect(current().composerScope).toEqual({
      kind: "repository",
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-b",
      generation: 2,
    });
  });

  it("re-establishes the scope when the scoped repository leaves the project", () => {
    render(threadsSurfaceFixture());
    act(() =>
      current().setRailScope({
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: FIXTURE_NESTED_ROOT,
      }),
    );
    expect(current().railScope?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);

    render(threadsSurfaceFixture(), [
      projectFixture({ repositories: [fixtureRepository(SURFACE_FIXTURE_ROOT, "")] }),
    ]);

    expect(current().railScope?.repositoryRoot).toBe(SURFACE_FIXTURE_ROOT);
    expect(current().composerScope?.kind).toBe("repository");
  });

  it("opens the palette with titles, activates a result with a reveal, and closes it", () => {
    render(
      threadsSurfaceFixture({
        threads: [view("agt-1"), archivedView("agt-old")],
      }),
    );
    expect(current().palette.open).toBe(false);
    expect(current().palette.titles.size).toBe(0);

    act(() => current().commands.searchThreads());
    expect(current().palette.open).toBe(true);
    expect(current().palette.titles.get("agt-1")).toBe("Refactor the parser");
    expect(current().palette.archivedThreadIds.has("agt-1")).toBe(false);
    expect(current().palette.archivedThreadIds.has("agt-old")).toBe(true);

    act(() => current().search.setQuery("parser"));
    expect(current().search.query).toBe("parser");

    act(() =>
      current().palette.activate("agt-1", {
        query: "parser",
        turnId: "agt-1-t1",
        eventIndex: 0,
        start: 0,
        end: 6,
      }),
    );

    expect(current().selectedThreadId).toBe("agt-1");
    expect(current().palette.open).toBe(false);
    expect(current().search.query).toBe("");
    expect(current().find.open).toBe(true);
    expect(current().find.query).toBe("parser");
  });

  it("opens find for the selected thread only and closes it when the selection changes", () => {
    render(threadsSurfaceFixture({ threads: [view("agt-1"), view("agt-2")] }));

    act(() => current().commands.findInThread());
    expect(current().find.open).toBe(false);

    act(() => current().selectThread("agt-1"));
    act(() => current().commands.findInThread());
    act(() => current().find.setQuery("token"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().find.open).toBe(true);
    expect(current().findHitIndex).toBeUndefined();

    act(() => current().selectThread("agt-1"));
    expect(current().find.open).toBe(true);

    act(() => current().selectThread("agt-2"));
    expect(current().find.open).toBe(false);
    expect(current().find.query).toBe("");

    act(() => current().commands.findInThread());
    act(() => current().closeFindBar());
    expect(current().find.open).toBe(false);
  });

  it("reports thread find focus only from inside the selected session", () => {
    render(threadsSurfaceFixture({ threads: [view("agt-1")] }));
    act(() => current().selectThread("agt-1"));
    const sessionTarget = host.querySelector<HTMLButtonElement>("[data-session-target]");
    const composerTarget = host.querySelector<HTMLButtonElement>("[data-composer-target]");
    const findTarget = host.querySelector<HTMLInputElement>("[data-find-target]");
    const railTarget = host.querySelector<HTMLButtonElement>("[data-rail-target]");
    const monacoTarget = host.querySelector<HTMLButtonElement>("[data-monaco-target]");
    expect(sessionTarget).not.toBeNull();
    expect(composerTarget).not.toBeNull();
    expect(findTarget).not.toBeNull();
    expect(railTarget).not.toBeNull();
    expect(monacoTarget).not.toBeNull();

    for (const outsideTarget of [composerTarget, railTarget, monacoTarget]) {
      act(() => outsideTarget?.focus());
      expect(current().commands.threadFindFocused()).toBe(false);
    }

    act(() => sessionTarget?.focus());
    expect(current().commands.threadFindFocused()).toBe(true);

    act(() => findTarget?.focus());
    expect(current().commands.threadFindFocused()).toBe(true);

    act(() => current().clearSelectedThread());
    expect(current().commands.threadFindFocused()).toBe(false);
  });

  it("opens the terminal sessions palette for an open project and closes it on demand", () => {
    render(threadsSurfaceFixture());

    expect(current().terminalSessions.open).toBe(false);
    expect(current().terminalSessions.target).toBeNull();

    act(() => current().terminalSessions.openFor(SURFACE_FIXTURE_ROOT, FIXTURE_NESTED_ROOT));
    expect(current().terminalSessions.open).toBe(true);
    expect(current().terminalSessions.target).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: FIXTURE_NESTED_ROOT,
    });

    act(() => current().terminalSessions.close());
    expect(current().terminalSessions.open).toBe(false);
    expect(current().terminalSessions.target).toBeNull();
  });

  it("refuses to open terminal sessions for an unknown or draining project", () => {
    render(threadsSurfaceFixture());

    act(() => current().terminalSessions.openFor("/somewhere/else", "/somewhere/else"));
    expect(current().terminalSessions.open).toBe(false);

    act(() => current().terminalSessions.openFor(SURFACE_FIXTURE_ROOT, "/somewhere/else"));
    expect(current().terminalSessions.open).toBe(false);

    render(threadsSurfaceFixture(), [projectFixture({ origin: "closed-tab-live-tasks" })]);
    act(() => current().terminalSessions.openFor(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT));
    expect(current().terminalSessions.open).toBe(false);
  });

  it("closes the terminal sessions palette when its project is replaced and stays closed after A to B to A", () => {
    render(threadsSurfaceFixture());
    act(() => current().terminalSessions.openFor(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT));
    expect(current().terminalSessions.open).toBe(true);

    render(threadsSurfaceFixture(), [
      projectFixture({ rootKey: "/workspace/b", rootPath: "/workspace/b", repositories: [] }),
    ]);
    expect(current().terminalSessions.open).toBe(false);

    render(threadsSurfaceFixture(), [projectFixture()]);
    expect(current().terminalSessions.open).toBe(false);
  });

  it("closes the external sessions surface when the palette project drains", () => {
    const externalSessions = { close: vi.fn() };
    render(threadsSurfaceFixture(), [projectFixture()], externalSessions);
    act(() => current().terminalSessions.openFor(SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT));
    expect(current().terminalSessions.open).toBe(true);
    expect(externalSessions.close).not.toHaveBeenCalled();

    render(threadsSurfaceFixture(), [], externalSessions);

    expect(current().terminalSessions.open).toBe(false);
    expect(externalSessions.close).toHaveBeenCalledTimes(1);

    render(threadsSurfaceFixture(), [projectFixture()], externalSessions);
    expect(current().terminalSessions.open).toBe(false);
    expect(externalSessions.close).toHaveBeenCalledTimes(1);
  });

  it("selects a started thread without closing the find bar", () => {
    render(threadsSurfaceFixture({ threads: [view("agt-1"), view("agt-2")] }));

    act(() => current().selectThread("agt-1"));
    act(() => current().commands.findInThread());
    expect(current().find.open).toBe(true);

    act(() => current().selectStartedThread("agt-2"));
    expect(current().selectedThreadId).toBe("agt-2");
    expect(current().find.open).toBe(true);
  });

  function view(threadId: string, repositoryRoot: string = SURFACE_FIXTURE_ROOT): AgentThreadView {
    const base = surfaceThreadView().thread;
    return surfaceThreadView({
      thread: {
        ...base,
        threadId,
        owner: { ...base.owner, repositoryRoot },
      },
    });
  }

  function viewInProject(threadId: string, rootKey: string): AgentThreadView {
    const base = surfaceThreadView().thread;
    return surfaceThreadView({
      thread: {
        ...base,
        threadId,
        owner: {
          ...base.owner,
          rootKey,
          ownerId: `agent-root:${rootKey}`,
          repositoryRoot: rootKey,
        },
      },
    });
  }

  function project(rootKey: string, label: string): AgentProjectDescriptor {
    return projectFixture({
      rootKey,
      rootPath: rootKey,
      ownerId: `agent-root:${rootKey}`,
      label,
      repositories: [fixtureRepository(rootKey, "")],
    });
  }

  function archivedView(threadId: string): AgentThreadView {
    const base = view(threadId).thread;
    return surfaceThreadView({ thread: { ...base, archived: true } });
  }

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture()],
    externalSessions: Pick<ExternalSessionsSurface, "close"> | null = null,
  ): void {
    act(() => {
      root.render(
        <Harness agents={agents} externalSessions={externalSessions} projects={projects} />,
      );
    });
  }

  function current(): AgentThreadNavigation {
    expect(captured).not.toBeNull();
    return captured as AgentThreadNavigation;
  }

  function Harness({
    agents,
    externalSessions,
    projects,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly externalSessions: Pick<ExternalSessionsSurface, "close"> | null;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  }) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    captured = useAgentThreadNavigation({
      agents,
      externalSessions,
      groups,
      presentationThreads: agents.threads,
      projects,
    });
    return (
      <>
        <button data-rail-target type="button" />
        <div ref={captured.centerRef}>
          <section className="agent-session">
            <button data-session-target type="button" />
          </section>
          <div className="agent-find">
            <input data-find-target />
          </div>
          <button data-composer-target type="button" />
        </div>
        <button data-monaco-target type="button" />
      </>
    );
  }
});
