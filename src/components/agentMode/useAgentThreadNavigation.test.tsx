// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  FIXTURE_NESTED_ROOT,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { AGENT_THREAD_FIND_DEBOUNCE_MS } from "./useAgentThreadFind";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

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

  it("scopes the rail and derives the new-thread target from the scope", () => {
    const nested = view("agt-nested", FIXTURE_NESTED_ROOT);
    render(threadsSurfaceFixture({ threads: [view("agt-1"), nested] }));

    expect(current().newThreadTarget()).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });

    act(() =>
      current().setRailScope({
        kind: "repository",
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: FIXTURE_NESTED_ROOT,
      }),
    );

    expect(current().railScope.kind).toBe("repository");
    expect(current().newThreadTarget()).toEqual({
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: FIXTURE_NESTED_ROOT,
    });
    act(() => current().commands.jumpToThread(1));
    expect(current().selectedThreadId).toBe("agt-nested");
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

  function archivedView(threadId: string): AgentThreadView {
    const base = view(threadId).thread;
    return surfaceThreadView({ thread: { ...base, archived: true } });
  }

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture()],
  ): void {
    act(() => {
      root.render(<Harness agents={agents} projects={projects} />);
    });
  }

  function current(): AgentThreadNavigation {
    expect(captured).not.toBeNull();
    return captured as AgentThreadNavigation;
  }

  function Harness({
    agents,
    projects,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  }) {
    const groups = agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees);
    captured = useAgentThreadNavigation({ agents, groups });
    return null;
  }
});
