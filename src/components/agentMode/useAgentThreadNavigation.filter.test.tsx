// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import {
  NO_SCOPE_STATE,
  useAgentThreadNavigation,
  type AgentNavigationSession,
  type AgentThreadNavigation,
} from "./useAgentThreadNavigation";

const ORDERS = "/workspace/orders";
const WEB = "/workspace/web";

function project(rootKey: string, label: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${rootKey}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function viewIn(threadId: string, rootKey: string, updatedAtEpochMs: number): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      updatedAtEpochMs,
      turns: [],
      owner: { ...base.owner, rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
    },
  });
}

const ordersProject = project(ORDERS, "orders-api");
const webProject = project(WEB, "web-dashboard");
const threads = [viewIn("o1", ORDERS, 3), viewIn("o2", ORDERS, 2), viewIn("w1", WEB, 1)];

interface ProbeOptions {
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly session?: AgentNavigationSession;
}

describe("all-projects thread list", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentThreadNavigation | null;
  const agents: AgentThreadsSurface = threadsSurfaceFixture({ threads });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({ projects, session }: Required<Pick<ProbeOptions, "projects">> & ProbeOptions) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [projects],
    );
    latest = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
      session,
    });
    return null;
  }

  function render(options: ProbeOptions = {}): void {
    act(() =>
      root.render(
        <Probe
          projects={options.projects ?? [ordersProject, webProject]}
          session={options.session}
        />,
      ),
    );
  }

  function navigation(): AgentThreadNavigation {
    expect(latest).not.toBeNull();
    return latest as AgentThreadNavigation;
  }

  it("starts on All projects and searches and jumps across every project", () => {
    render();
    expect(navigation().railFilter).toEqual({ kind: "all" });
    act(() => navigation().commands.jumpToThread(3));
    expect(navigation().selectedThreadId).toBe("w1");
    act(() => navigation().commands.searchThreads());
    expect([...navigation().palette.titles.keys()].sort()).toEqual(["o1", "o2", "w1"]);
  });

  it("narrows next/previous to the filtered project and keeps the active project separate", () => {
    render();
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: WEB }));
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
  });

  it("reveals a thread selected from another project by moving a single-project filter", () => {
    render();
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: WEB }));
    act(() => navigation().selectThread("o1"));
    expect(navigation().railFilter).toEqual({ kind: "project", projectRootKey: ORDERS });
  });

  it("keeps All projects when switching the active project", () => {
    render();
    act(() => {
      navigation().setProjectScope(WEB);
    });
    expect(navigation().railFilter).toEqual({ kind: "all" });
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
  });

  it("moves a single-project filter with the active project", () => {
    render();
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: ORDERS }));
    act(() => {
      navigation().setProjectScope(WEB);
    });
    expect(navigation().railFilter).toEqual({ kind: "project", projectRootKey: WEB });
  });

  it("falls back to All projects when the filtered project closes, and restores the filter from the session", () => {
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: null,
        selectedThreadOwnerKey: null,
        scopeState: NO_SCOPE_STATE,
        railFilter: { kind: "project", projectRootKey: WEB },
      },
    };
    render({ session });
    expect(navigation().railFilter).toEqual({ kind: "project", projectRootKey: WEB });
    render({ session, projects: [ordersProject] });
    expect(navigation().railFilter).toEqual({ kind: "all" });
    expect(session.current.railFilter).toEqual({ kind: "all" });
  });

  it("A → B → A: a reopened project with a new generation is a new owner but the same filter key", () => {
    render();
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: WEB }));
    render({ projects: [ordersProject] });
    render({
      projects: [ordersProject, { ...webProject, generation: webProject.generation + 1 }],
    });
    expect(navigation().railFilter).toEqual({ kind: "all" });
  });
});
