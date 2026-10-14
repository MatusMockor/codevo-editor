import { describe, expect, it } from "vitest";
import { MAX_AGENT_TURNS_PER_THREAD } from "../domain/agentThread";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  RemoteAgentProjection,
  projectRemoteAgentThreads,
  remoteAgentThreadKey,
  type RemoteAgentProjectionInput,
} from "./remoteAgentProjection";

const root: RemoteRunnerTask = {
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: "First prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
};
const child: RemoteRunnerTask = {
  ...root,
  id: "child",
  sequence: 2,
  status: "running",
  conversationId: "root",
  parentTaskId: "root",
  parts: [{ type: "text", text: "Follow-up" }],
};
const other: RemoteRunnerTask = {
  ...root,
  id: "other",
  sequence: 3,
  status: "running",
  parts: [{ type: "text", text: "Another conversation" }],
};

function input(
  tasks: readonly RemoteRunnerTask[],
  patch: Partial<RemoteAgentProjectionInput> = {},
): RemoteAgentProjectionInput {
  return {
    serverId: "server",
    runnerId: "runner",
    projects: [{ id: "project", name: "Project" }],
    tasks,
    replays: new Map(),
    resumes: new Map(),
    ...patch,
  };
}

const SNAPSHOT_RUNNER = { runtimeRequestsSupported: true, interactiveApprovalsSupported: true };

function viewOf(views: readonly AgentThreadView[], conversationId: string): AgentThreadView {
  const threadId = remoteAgentThreadKey("server", "runner", conversationId);
  const found = views.find((view) => view.thread.threadId === threadId);
  expect(found, `view of ${conversationId}`).toBeDefined();
  return found ?? views[0]!;
}

function chain(length: number): readonly RemoteRunnerTask[] {
  return Array.from({ length }, (_unused, index) => {
    if (index === 0) return { ...root, interactionSequence: 100 };
    return {
      ...child,
      id: `turn-${index}`,
      sequence: index + 1,
      status: "succeeded" as const,
      parentTaskId: index === 1 ? "root" : `turn-${index - 1}`,
      interactionSequence: 100 + index,
      awaiting: "approval" as const,
    };
  });
}

describe("remote thread request facts", () => {
  it("reports an old runner as a legacy source without any fact", () => {
    const view = viewOf(projectRemoteAgentThreads(input([root, child])), "root");

    expect(view.execution?.requests).toEqual({
      source: "legacy",
      approvals: false,
      sequences: {},
      awaitingApproval: [],
    });
  });

  it("maps the reported sequences and the turns awaiting an approval by task id", () => {
    const view = viewOf(
      projectRemoteAgentThreads(
        input(
          [
            { ...root, interactionSequence: 0 },
            { ...child, interactionSequence: 7, awaiting: "approval" },
          ],
          SNAPSHOT_RUNNER,
        ),
      ),
      "root",
    );

    expect(view.execution?.requests).toEqual({
      source: "snapshot",
      approvals: true,
      sequences: { root: 0, child: 7 },
      awaitingApproval: ["child"],
    });
  });

  it("leaves out turns that report no sequence", () => {
    const view = viewOf(
      projectRemoteAgentThreads(
        input([root, { ...child, interactionSequence: 2 }], { runtimeRequestsSupported: true }),
      ),
      "root",
    );

    expect(view.execution?.requests).toEqual({
      source: "snapshot",
      approvals: false,
      sequences: { child: 2 },
      awaitingApproval: [],
    });
  });

  it("keeps the facts of two conversations apart", () => {
    const views = projectRemoteAgentThreads(
      input(
        [
          { ...root, interactionSequence: 1 },
          { ...child, interactionSequence: 2 },
          { ...other, interactionSequence: 9, awaiting: "approval" },
        ],
        SNAPSHOT_RUNNER,
      ),
    );

    expect(viewOf(views, "root").execution?.requests?.sequences).toEqual({ root: 1, child: 2 });
    expect(viewOf(views, "root").execution?.requests?.awaitingApproval).toEqual([]);
    expect(viewOf(views, "other").execution?.requests?.sequences).toEqual({ other: 9 });
    expect(viewOf(views, "other").execution?.requests?.awaitingApproval).toEqual(["other"]);
  });

  it("holds plain JSON that survives a round trip", () => {
    const facts = viewOf(
      projectRemoteAgentThreads(
        input([root, { ...child, interactionSequence: 3, awaiting: "approval" }], SNAPSHOT_RUNNER),
      ),
      "root",
    ).execution?.requests;

    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });

  it("keeps the view identity while the input is unchanged", () => {
    const tasks = [root, { ...child, interactionSequence: 3, awaiting: "approval" as const }];
    const cache = new RemoteAgentProjection();
    const first = cache.project(input(tasks, SNAPSHOT_RUNNER));
    const second = cache.project(input(structuredClone(tasks), SNAPSHOT_RUNNER));

    expect(second).toBe(first);
    expect(viewOf(second, "root")).toBe(viewOf(first, "root"));
    expect(viewOf(second, "root").execution?.requests).toBe(
      viewOf(first, "root").execution?.requests,
    );
  });

  it("re-identifies the view when a sequence moves and keeps the unchanged thread", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(
      input([root, { ...child, interactionSequence: 3 }], SNAPSHOT_RUNNER),
    );
    const second = cache.project(
      input([root, { ...child, interactionSequence: 4 }], SNAPSHOT_RUNNER),
    );

    expect(viewOf(second, "root")).not.toBe(viewOf(first, "root"));
    expect(viewOf(second, "root").execution?.requests?.sequences).toEqual({ child: 4 });
    expect(viewOf(first, "root").execution?.requests?.sequences).toEqual({ child: 3 });
    expect(viewOf(second, "root").thread).toBe(viewOf(first, "root").thread);
  });

  it("re-identifies the view when a first sequence appears", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(input([root, child], SNAPSHOT_RUNNER));
    const second = cache.project(
      input([root, { ...child, interactionSequence: 0 }], SNAPSHOT_RUNNER),
    );

    expect(viewOf(second, "root")).not.toBe(viewOf(first, "root"));
    expect(viewOf(second, "root").execution?.requests?.sequences).toEqual({ child: 0 });
  });

  it("re-identifies the view when a turn starts or stops awaiting an approval", () => {
    const cache = new RemoteAgentProjection();
    const idle = cache.project(
      input([root, { ...child, interactionSequence: 3 }], SNAPSHOT_RUNNER),
    );
    const awaiting = cache.project(
      input([root, { ...child, interactionSequence: 3, awaiting: "approval" }], SNAPSHOT_RUNNER),
    );
    const settled = cache.project(
      input([root, { ...child, interactionSequence: 3 }], SNAPSHOT_RUNNER),
    );

    expect(viewOf(awaiting, "root")).not.toBe(viewOf(idle, "root"));
    expect(viewOf(awaiting, "root").execution?.requests?.awaitingApproval).toEqual(["child"]);
    expect(viewOf(settled, "root")).not.toBe(viewOf(awaiting, "root"));
    expect(viewOf(settled, "root").execution?.requests?.awaitingApproval).toEqual([]);
  });

  it("re-identifies only the conversation whose sequence moved", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(
      input([root, child, { ...other, interactionSequence: 1 }], SNAPSHOT_RUNNER),
    );
    const second = cache.project(
      input([root, child, { ...other, interactionSequence: 2 }], SNAPSHOT_RUNNER),
    );

    expect(viewOf(second, "root")).toBe(viewOf(first, "root"));
    expect(viewOf(second, "other")).not.toBe(viewOf(first, "other"));
  });

  it("re-identifies the view when the runner starts or stops advertising the capabilities", () => {
    const tasks = [root, { ...child, interactionSequence: 3 }];
    const cache = new RemoteAgentProjection();
    const legacy = cache.project(input(tasks));
    const snapshot = cache.project(input(tasks, { runtimeRequestsSupported: true }));
    const approvals = cache.project(input(tasks, SNAPSHOT_RUNNER));
    const downgraded = cache.project(input(tasks));

    expect(viewOf(legacy, "root").execution?.requests?.source).toBe("legacy");
    expect(viewOf(snapshot, "root")).not.toBe(viewOf(legacy, "root"));
    expect(viewOf(snapshot, "root").execution?.requests?.source).toBe("snapshot");
    expect(viewOf(snapshot, "root").execution?.requests?.approvals).toBe(false);
    expect(viewOf(approvals, "root")).not.toBe(viewOf(snapshot, "root"));
    expect(viewOf(approvals, "root").execution?.requests?.approvals).toBe(true);
    expect(viewOf(downgraded, "root").execution?.requests).toEqual({
      source: "legacy",
      approvals: false,
      sequences: { child: 3 },
      awaitingApproval: [],
    });
  });

  it("bounds the facts to the turns the view shows", () => {
    const tasks = chain(MAX_AGENT_TURNS_PER_THREAD + 6);
    const view = viewOf(projectRemoteAgentThreads(input(tasks, SNAPSHOT_RUNNER)), "root");
    const shown = view.thread.turns.map((turn) => turn.turnId);
    const facts = view.execution?.requests;

    expect(shown).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(Object.keys(facts?.sequences ?? {})).toEqual(shown);
    expect(facts?.awaitingApproval).toEqual(shown);
    expect(facts?.sequences.root).toBeUndefined();
    expect(facts?.sequences[`turn-${MAX_AGENT_TURNS_PER_THREAD + 5}`]).toBe(
      100 + MAX_AGENT_TURNS_PER_THREAD + 5,
    );
  });

  it("does not carry the facts of a removed conversation into its successor", () => {
    const cache = new RemoteAgentProjection();
    cache.project(
      input([{ ...other, interactionSequence: 9, awaiting: "approval" }], SNAPSHOT_RUNNER),
    );
    const next = cache.project(input([root, child], SNAPSHOT_RUNNER));

    expect(next).toHaveLength(1);
    expect(viewOf(next, "root").execution?.requests).toEqual({
      source: "snapshot",
      approvals: true,
      sequences: {},
      awaitingApproval: [],
    });
  });
});
