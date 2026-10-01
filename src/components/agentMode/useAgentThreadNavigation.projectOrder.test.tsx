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
import type { AgentRailProjectDisclosureState } from "./agentRailProjectLayout";
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
const threads = [viewIn("w1", WEB, 3), viewIn("o1", ORDERS, 2), viewIn("o2", ORDERS, 1)];

function disclosure(collapsed: ReadonlyArray<string>): AgentRailProjectDisclosureState {
  return { collapsed: new Set(collapsed), showingAll: new Set() };
}

const revealed: string[] = [];

interface ProbeOptions {
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly session?: AgentNavigationSession;
  readonly projectDisclosure?: AgentRailProjectDisclosureState;
}

describe("thread navigation across project groups", () => {
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
    revealed.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({
    projects,
    projectDisclosure,
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
      projectDisclosure,
      revealProject: (projectRootKey) => revealed.push(projectRootKey),
      session,
    });
    return null;
  }

  function render(options: ProbeOptions = {}): void {
    act(() =>
      root.render(
        <Probe
          projects={options.projects ?? [ordersProject, webProject]}
          projectDisclosure={options.projectDisclosure}
          session={options.session}
        />,
      ),
    );
  }

  function navigation(): AgentThreadNavigation {
    expect(latest).not.toBeNull();
    return latest as AgentThreadNavigation;
  }

  it("searches every project and jumps in project-group order", () => {
    render();
    act(() => navigation().commands.jumpToThread(3));
    expect(navigation().selectedThreadId).toBe("w1");
    act(() => navigation().commands.jumpToThread(1));
    expect(navigation().selectedThreadId).toBe("o1");
    act(() => navigation().commands.searchThreads());
    expect([...navigation().palette.titles.keys()].sort()).toEqual(["o1", "o2", "w1"]);
  });

  it("steps next and previous through the visible rows of each project in order", () => {
    render();
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("o1");
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("o2");
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
    act(() => navigation().commands.previousThread());
    expect(navigation().selectedThreadId).toBe("o2");
  });

  it("skips the rows of a collapsed project when jumping", () => {
    render({ projectDisclosure: disclosure([ORDERS]) });
    act(() => navigation().commands.jumpToThread(1));
    expect(navigation().selectedThreadId).toBe("w1");
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
  });

  it("keeps the selected thread of a collapsed project in the order", () => {
    render({ projectDisclosure: disclosure([ORDERS]) });
    act(() => navigation().selectThread("o2"));
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
    act(() => navigation().commands.previousThread());
    expect(navigation().selectedThreadId).toBe("w1");
  });

  it("switches the active project when a thread from another project is selected", () => {
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
    render({ session });
    act(() => navigation().selectThread("w1"));
    expect(navigation().selectedThreadId).toBe("w1");
    expect(navigation().railScope?.projectRootKey).toBe(WEB);
    act(() => navigation().selectThread("o1"));
    expect(navigation().railScope?.projectRootKey).toBe(ORDERS);
    expect(revealed).toEqual([WEB, ORDERS]);
  });
});
