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
import type { AgentRailFilter } from "./agentRailFilter";
import {
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
  readonly railFilter?: AgentRailFilter;
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

  function Probe({
    projects,
    railFilter,
    session,
  }: Required<Pick<ProbeOptions, "projects">> & ProbeOptions) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [projects],
    );
    latest = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
      railFilter,
      session,
    });
    return null;
  }

  function render(options: ProbeOptions = {}): void {
    act(() =>
      root.render(
        <Probe
          projects={options.projects ?? [ordersProject, webProject]}
          railFilter={options.railFilter}
          session={options.session}
        />,
      ),
    );
  }

  function navigation(): AgentThreadNavigation {
    expect(latest).not.toBeNull();
    return latest as AgentThreadNavigation;
  }

  it("searches and jumps across every project under All projects", () => {
    render();
    act(() => navigation().commands.jumpToThread(3));
    expect(navigation().selectedThreadId).toBe("w1");
    act(() => navigation().commands.searchThreads());
    expect([...navigation().palette.titles.keys()].sort()).toEqual(["o1", "o2", "w1"]);
  });

  it("narrows next/previous to the filtered project and keeps the active project separate", () => {
    render();
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    render({ railFilter: { kind: "project", projectRootKey: WEB } });
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
  });

  it("narrows the search palette to the filtered project", () => {
    render({ railFilter: { kind: "project", projectRootKey: ORDERS } });
    act(() => navigation().commands.searchThreads());
    expect([...navigation().palette.titles.keys()].sort()).toEqual(["o1", "o2"]);
  });

  it("selects a thread from another project without touching the filter or the session", () => {
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: null,
        selectedThreadOwnerKey: null,
        scopeState: {
          intent: "automatic",
          railScope: null,
          authority: null,
          order: [],
        },
      },
    };
    render({ railFilter: { kind: "project", projectRootKey: WEB }, session });
    act(() => navigation().selectThread("o1"));
    expect(navigation().selectedThreadId).toBe("o1");
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    expect(Object.keys(session.current)).not.toContain("railFilter");
  });

  it("switches the active project without a filter side effect", () => {
    render({ railFilter: { kind: "project", projectRootKey: ORDERS } });
    act(() => {
      navigation().setProjectScope(WEB);
    });
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
    expect(Object.keys(navigation())).not.toContain("railFilter");
    expect(Object.keys(navigation())).not.toContain("setRailFilter");
  });
});
