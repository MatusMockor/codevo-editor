// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { NO_AGENT_STARTING_THREADS, type AgentStartingThread } from "./agentStartingThreads";
import { fixtureRepository, projectFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  agentOwnedStartingThreads,
  useAgentOwnedStartingThreads,
} from "./useAgentOwnedStartingThreads";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_APP = remoteAgentProjectKey("srv-1", "runner-1", "project-1");

function project(
  rootKey: string,
  patch: Partial<AgentProjectDescriptor> = {},
): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${rootKey}`,
    generation: 1,
    repositories: [fixtureRepository(rootKey, "")],
    ...patch,
  });
}

function starting(
  key: string,
  projectRootKey: string,
  owner: AgentStartingThread["owner"] = { ownerId: `agent-root:${projectRootKey}`, generation: 1 },
): AgentStartingThread {
  return {
    key,
    projectRootKey,
    owner,
    provider: "claudeCode",
    threadId: null,
    title: `Title ${key}`,
    sentAtEpochMs: 1,
    current: false,
  };
}

describe("agent owned starting threads", () => {
  it("keeps the same list while every owner still holds its project", () => {
    const threads = [starting("starting:1", APP), starting("starting:2", API)];

    expect(agentOwnedStartingThreads(threads, [project(APP), project(API)])).toBe(threads);
    expect(agentOwnedStartingThreads(NO_AGENT_STARTING_THREADS, [project(APP)])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
  });

  it("drops a starting thread whose project was removed", () => {
    expect(agentOwnedStartingThreads([starting("starting:1", APP)], [project(API)])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
    expect(agentOwnedStartingThreads([starting("starting:1", APP)], [])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
  });

  it("drops a starting thread when its project was re-added under the same root key", () => {
    const threads = [starting("starting:1", APP)];

    expect(agentOwnedStartingThreads(threads, [project(APP, { generation: 2 })])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
    expect(
      agentOwnedStartingThreads(threads, [project(APP, { ownerId: "agent-root:replacement" })]),
    ).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("never matches an owner of another root that shares the owner id", () => {
    const threads = [starting("starting:1", APP)];

    expect(
      agentOwnedStartingThreads(threads, [project(API, { ownerId: `agent-root:${APP}` })]),
    ).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("keeps a starting thread whose owner was promoted while the project became active", () => {
    const threads = [starting("starting:1", APP)];
    const promoted = project(APP, {
      ownerId: "workspace:42",
      runtimeOwnerIds: ["workspace:42", `agent-root:${APP}`],
    });

    expect(agentOwnedStartingThreads(threads, [promoted])).toBe(threads);
    expect(agentOwnedStartingThreads(threads, [{ ...promoted, generation: 2 }])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
  });

  it("shows nothing for a starting thread that captured no owner", () => {
    expect(agentOwnedStartingThreads([starting("starting:1", APP, null)], [project(APP)])).toBe(
      NO_AGENT_STARTING_THREADS,
    );
  });

  it("keeps a server project's starting thread while the server project is listed", () => {
    const threads = [starting("starting:1", REMOTE_APP, { ownerId: REMOTE_APP, generation: 1 })];
    const remote = project(REMOTE_APP, { ownerId: REMOTE_APP });

    expect(agentOwnedStartingThreads(threads, [project(APP), remote])).toBe(threads);
    expect(agentOwnedStartingThreads(threads, [project(APP), { ...remote }])).toBe(threads);
    expect(agentOwnedStartingThreads(threads, [project(APP)])).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("keeps the filtered list reference while the surviving threads are the same", () => {
    const kept = starting("starting:1", APP);
    const threads = [kept, starting("starting:2", API)];
    const first = agentOwnedStartingThreads(threads, [project(APP)]);

    expect(first).toEqual([kept]);
    expect(agentOwnedStartingThreads([...threads], [project(APP)], first)).toBe(first);
  });
});

describe("useAgentOwnedStartingThreads", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: ReadonlyArray<AgentStartingThread>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = NO_AGENT_STARTING_THREADS;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    threads,
    projects,
  }: {
    readonly threads: ReadonlyArray<AgentStartingThread>;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  }) {
    captured = useAgentOwnedStartingThreads(threads, projects);
    return null;
  }

  function render(
    threads: ReadonlyArray<AgentStartingThread>,
    projects: ReadonlyArray<AgentProjectDescriptor>,
  ): void {
    act(() => root.render(<Harness projects={projects} threads={threads} />));
  }

  it("follows the project through removal and replacement and keeps stable references", () => {
    const kept = starting("starting:1", API);
    const threads = [starting("starting:2", APP), kept];
    render(threads, [project(APP), project(API)]);
    expect(captured).toBe(threads);

    render(threads, [project(APP), project(API)]);
    expect(captured).toBe(threads);

    render(threads, [project(API)]);
    const withoutApp = captured;
    expect(withoutApp).toEqual([kept]);

    render(threads, [project(APP, { generation: 2 }), project(API)]);
    expect(captured).toBe(withoutApp);

    render(threads, [project(APP), project(API)]);
    expect(captured).toBe(threads);
  });
});
