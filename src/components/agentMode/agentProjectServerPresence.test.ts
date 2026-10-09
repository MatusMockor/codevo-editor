import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";
import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentThreadLifecycle, type AgentThread } from "../../domain/agentThread";
import { groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentProjectServerBadgeLabel,
  agentProjectServerPresence,
  type AgentProjectServerPresence,
} from "./agentProjectServerPresence";
import { agentRailScopeEntries, type AgentRailScopeEntry } from "./agentSidebarPresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { fixtureRepository, projectFixture } from "./agentThreadsSurfaceTestFixtures";

const APP = "/workspace/app";

const NAMES: ReadonlyMap<string, string> = new Map([
  ["linux", "Linux box"],
  ["mac", "Build mac"],
  ["arm", "arm runner"],
  ["gpu", "GPU node"],
  ["edge", "Edge"],
]);

function localProject(): AgentProjectDescriptor {
  return projectFixture({
    rootKey: APP,
    rootPath: APP,
    ownerId: "agent-root:app",
    label: "app",
    repositories: [fixtureRepository(APP, "")],
  });
}

function remoteKey(serverId: string, projectId = "app"): string {
  return remoteAgentProjectKey(serverId, "runner", projectId);
}

function remoteProject(serverId: string, projectId = "app"): AgentProjectDescriptor {
  const rootKey = remoteKey(serverId, projectId);
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: rootKey,
    label: projectId,
    origin: "background-tab",
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function localThread(threadId: string): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey: APP, ownerId: "agent-root:app", repositoryRoot: APP },
    },
  });
}

function remoteThread(
  threadId: string,
  serverId: string,
  {
    archived = false,
    ownedLocally = false,
    projectId = "app",
  }: { archived?: boolean; ownedLocally?: boolean; projectId?: string } = {},
): AgentThreadView {
  const rootKey = remoteKey(serverId, projectId);
  const base = surfaceThreadView().thread;
  const owner = ownedLocally
    ? { rootKey: APP, ownerId: "agent-root:app", repositoryRoot: APP }
    : { rootKey, ownerId: rootKey, repositoryRoot: rootKey };
  const thread: AgentThread = {
    ...base,
    threadId,
    archived,
    target: { isolation: "in-place", worktreePath: null },
    owner,
  };
  return surfaceThreadView({
    execution: {
      kind: "remote",
      serverId,
      runnerId: "runner",
      projectId,
      conversationId: threadId,
      latestTaskId: `${threadId}-task`,
      resume: null,
      reachability: REMOTE_RUNNER_REACHABLE,
    },
    lifecycle: agentThreadLifecycle(thread),
    thread,
  });
}

function entries(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  threads: ReadonlyArray<AgentThreadView>,
  links: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<AgentRailScopeEntry> {
  const groups = agentProjectGroups(projects, threads, []);
  return agentRailScopeEntries(groupedEnvironmentProjects(groups, projects, links));
}

function linkedToApp(...serverIds: string[]): ReadonlyMap<string, string> {
  return new Map(serverIds.map((serverId) => [remoteKey(serverId), APP]));
}

function presence(
  remoteServerIds: ReadonlyArray<string>,
  local = true,
): AgentProjectServerPresence {
  return { local, remoteServerIds };
}

describe("agent project server presence", () => {
  it("reports no servers for a local-only project", () => {
    const [entry] = entries([localProject()], [localThread("l1")]);

    expect(entry?.serverPresence).toEqual({ local: true, remoteServerIds: [] });
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBeNull();
  });

  it("marks a linked local project as also running on its server", () => {
    const [entry, ...rest] = entries(
      [localProject(), remoteProject("linux")],
      [localThread("l1"), remoteThread("r1", "linux")],
      linkedToApp("linux"),
    );

    expect(rest).toEqual([]);
    expect(entry?.serverPresence).toEqual({ local: true, remoteServerIds: ["linux"] });
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBe("Also on Linux box");
  });

  it("says On for a project that only exists on a server", () => {
    const [entry] = entries([remoteProject("linux")], [remoteThread("r1", "linux")]);

    expect(entry?.serverPresence).toEqual({ local: false, remoteServerIds: ["linux"] });
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBe("On Linux box");
  });

  it("dedupes servers and orders ids and names deterministically", () => {
    const [entry] = entries(
      [localProject(), remoteProject("mac"), remoteProject("linux"), remoteProject("arm")],
      [
        remoteThread("r1", "mac"),
        remoteThread("r2", "linux"),
        remoteThread("r3", "mac"),
        remoteThread("r4", "arm"),
      ],
      linkedToApp("mac", "linux", "arm"),
    );

    expect(entry?.serverPresence.remoteServerIds).toEqual(["arm", "linux", "mac"]);
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBe(
      "Also on arm runner, Build mac, Linux box",
    );
  });

  it("falls back to a generic name for a server that is no longer configured", () => {
    expect(agentProjectServerBadgeLabel(presence(["gone", "missing", "linux"]), NAMES)).toBe(
      "Also on Linux box, server",
    );
    expect(
      agentProjectServerBadgeLabel(presence(["blank"], false), new Map([["blank", "  "]])),
    ).toBe("On server");
  });

  it("ignores archived threads so the badge reflects current work", () => {
    const archivedThreads = [
      localThread("l1"),
      remoteThread("r1", "mac", { archived: true, ownedLocally: true }),
    ];
    const [group] = agentProjectGroups([localProject()], archivedThreads, []);
    const archived = entries([localProject()], archivedThreads);
    const active = entries(
      [localProject()],
      [localThread("l1"), remoteThread("r1", "mac", { ownedLocally: true })],
    );

    expect(group?.repos[0]?.archived.map((view) => view.thread.threadId)).toEqual(["r1"]);
    expect(archived[0]?.serverPresence).toEqual({ local: true, remoteServerIds: [] });
    expect(agentProjectServerBadgeLabel(archived[0]!.serverPresence, NAMES)).toBeNull();
    expect(active[0]?.serverPresence).toEqual({ local: true, remoteServerIds: ["mac"] });
  });

  it("marks a server-only project by membership even without threads", () => {
    const [entry] = entries([remoteProject("linux")], []);

    expect(entry?.serverPresence).toEqual({ local: false, remoteServerIds: ["linux"] });
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBe("On Linux box");
  });

  it("marks a merged local and server project by membership even without threads", () => {
    const [entry, ...rest] = entries(
      [localProject(), remoteProject("linux")],
      [],
      linkedToApp("linux"),
    );

    expect(rest).toEqual([]);
    expect(entry?.serverPresence).toEqual({ local: true, remoteServerIds: ["linux"] });
    expect(agentProjectServerBadgeLabel(entry!.serverPresence, NAMES)).toBe("Also on Linux box");
  });

  it("unions member servers with thread servers without duplicates", () => {
    const [entry] = entries(
      [localProject(), remoteProject("linux")],
      [remoteThread("r1", "linux"), remoteThread("r2", "mac", { ownedLocally: true })],
      linkedToApp("linux"),
    );

    expect(entry?.serverPresence.remoteServerIds).toEqual(["linux", "mac"]);
  });

  it("does not take a server from a malformed remote member key", () => {
    expect(agentProjectServerPresence({ projectRootKey: "remote:not-a-key", repos: [] })).toEqual({
      local: false,
      remoteServerIds: [],
    });
  });

  it("bounds the label to three names", () => {
    const label = agentProjectServerBadgeLabel(
      presence(["linux", "mac", "arm", "gpu", "edge"]),
      NAMES,
    );

    expect(label).toBe("Also on arm runner, Build mac, Edge +2 more");
  });

  it("shows nothing when no remote servers are configured", () => {
    expect(agentProjectServerBadgeLabel(presence(["linux"]), new Map())).toBeNull();
  });

  it("derives presence straight from a project group", () => {
    const [group] = agentProjectGroups(
      [remoteProject("linux")],
      [remoteThread("r1", "linux"), remoteThread("r2", "linux")],
      [],
    );

    expect(agentProjectServerPresence(group!)).toEqual({
      local: false,
      remoteServerIds: ["linux"],
    });
  });
});
