import { describe, expect, it } from "vitest";
import {
  createAgentThreadNotificationCenter,
  type AgentSystemAttentionPort,
} from "../../application/agentThreadNotificationCenter";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentThreadNotificationSubjects } from "./agentThreadNotificationSubjects";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";

type SubjectCache = Parameters<typeof agentThreadNotificationSubjects>[3];

describe("agentThreadNotificationSubjects", () => {
  const view = surfaceThreadView();
  const projects: AgentProjectDescriptor[] = [
    projectFixture({ rootKey: view.thread.owner.rootKey, label: "app", generation: 3 }),
  ];

  it("reuses the subject of an unchanged view", () => {
    const cache: SubjectCache = new WeakMap();
    const first = agentThreadNotificationSubjects([view], new Map(), projects, cache);
    const second = agentThreadNotificationSubjects([view], new Map(), projects, cache);

    expect(second[0]).toBe(first[0]);
  });

  it("rebuilds the subject when the view, its interaction or its project generation changes", () => {
    const cache: SubjectCache = new WeakMap();
    const first = agentThreadNotificationSubjects([view], new Map(), projects, cache)[0];
    const changedView: AgentThreadView = { ...view, thread: { ...view.thread, title: "Renamed" } };

    expect(agentThreadNotificationSubjects([changedView], new Map(), projects, cache)[0]).not.toBe(
      first,
    );
    expect(
      agentThreadNotificationSubjects(
        [view],
        new Map([[view.thread.threadId, null]]),
        projects,
        cache,
      )[0],
    ).not.toBe(first);
    const reloaded = [{ ...projects[0]!, generation: 4 }];
    expect(
      agentThreadNotificationSubjects([view], new Map(), reloaded, cache)[0]?.ownerKey,
    ).not.toBe(first?.ownerKey);
  });

  it("leaves archived threads out", () => {
    const archived: AgentThreadView = { ...view, thread: { ...view.thread, archived: true } };
    expect(agentThreadNotificationSubjects([archived], new Map(), projects)).toEqual([]);
  });

  it("holds a completion back only while a background agent of the thread's session is live", () => {
    const cache: SubjectCache = new WeakMap();
    const settled = surfaceThreadView({
      thread: {
        ...view.thread,
        turns: [
          {
            turnId: "turn-1",
            prompt: "go",
            status: { kind: "exited", exitCode: 0 },
            startedAtEpochMs: 1,
            endedAtEpochMs: 2,
            events: [],
            eventsTruncated: false,
            lastStatusSequence: 1,
            lastOutputSequence: 0,
            launch: null,
            cliVersion: null,
          },
        ],
      },
    });
    const withBackground = (agents: number): AgentThreadView => ({
      ...settled,
      sessionBackground: {
        ownerId: settled.thread.owner.ownerId,
        total: 1,
        agents,
        tasks: [],
        sinceEpochMs: 2,
        taskSinceEpochMs: new Map(),
        reply: { kind: "none" },
      },
    });
    const stateOf = (observed: AgentThreadView) =>
      agentThreadNotificationSubjects([observed], new Map(), projects, cache)[0]?.state;
    const completed = {
      kind: "signal",
      signal: { kind: "completed", key: "turn-1:completed" },
    };

    expect(stateOf(withBackground(1))).toEqual({ ...completed, kind: "held" });
    expect(stateOf(withBackground(0))).toEqual(completed);
    expect(stateOf(settled)).toEqual(completed);
  });

  it("keeps a remote thread's identity and toast across runner reconnects and inventory resets", () => {
    const remoteKey = "remote:build:runner:orders";
    const remote = (status: "running" | "done"): AgentThreadView =>
      surfaceThreadView({
        execution: {
          kind: "remote",
          serverId: "build",
          runnerId: "runner",
          projectId: "orders",
          conversationId: "c-1",
          latestTaskId: "task-1",
          resume: null,
        },
        thread: {
          ...view.thread,
          threadId: "remote-thread:1",
          owner: { rootKey: remoteKey, ownerId: remoteKey, repositoryRoot: remoteKey },
          turns: [
            {
              turnId: "remote-turn",
              prompt: "go",
              status: status === "running" ? { kind: "running" } : { kind: "exited", exitCode: 0 },
              startedAtEpochMs: 1,
              endedAtEpochMs: status === "running" ? null : 2,
              events: [],
              eventsTruncated: false,
              lastStatusSequence: 1,
              lastOutputSequence: 0,
              launch: null,
              cliVersion: null,
            },
          ],
        },
      });
    const remoteProject = (generation: number) => [
      projectFixture({ rootKey: remoteKey, label: "orders", generation }),
    ];
    const system: AgentSystemAttentionPort = {
      notify: async () => "delivered",
      setBadgeCount: async () => undefined,
      recheckPermission: () => undefined,
    };
    const center = createAgentThreadNotificationCenter({
      focus: { isFocused: () => true, subscribe: () => () => undefined },
      system,
    });
    const observe = (views: AgentThreadView[], generation: number) =>
      center.observe(
        agentThreadNotificationSubjects(views, new Map(), remoteProject(generation)),
        null,
      );

    observe([remote("running")], 1);
    observe([remote("done")], 2);
    expect(center.toasts()).toHaveLength(1);

    observe([], 3);
    expect(center.toasts()).toHaveLength(1);
    observe([remote("done")], 4);
    expect(center.toasts()).toHaveLength(1);
    expect(center.toasts()[0]?.event.threadId).toBe("remote-thread:1");
  });
});
