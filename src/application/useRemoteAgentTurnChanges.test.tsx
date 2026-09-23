// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../domain/agentTurnChanges";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  useRemoteAgentTurnChanges,
  type RemoteAgentTurnChangesInput,
} from "./useRemoteAgentTurnChanges";
const task: RemoteRunnerTask = {
  id: "old",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [],
  createdAt: "2026-09-22T00:00:00Z",
};
const latest = { ...task, id: "latest", sequence: 2, conversationId: "old", parentTaskId: "old" };
const projects = [{ id: "project", name: "Project" }];
const summary: AgentTurnChangeSummary = {
  turnId: "old",
  state: "ready",
  files: [
    {
      relativePath: "src/a.ts",
      oldRelativePath: null,
      status: "modified",
      addedLines: 1,
      deletedLines: 1,
    },
  ],
  truncated: false,
  reason: null,
};
const diff: AgentTurnFileDiff = {
  relativePath: "src/a.ts",
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness() {
  const getTurnChanges = vi.fn(async () => summary);
  const getTurnFileDiff = vi.fn(async () => diff);
  const gateway = { getTurnChanges, getTurnFileDiff } as unknown as RemoteRunnerGateway;
  const descriptor = {
    runnerId: "runner",
    capabilities: { turnChanges: true },
  } as RemoteRunnerDescriptor;
  const snapshot = {
    ...emptyRemoteInventory("server", true),
    descriptor,
    projects,
    tasks: [task, latest],
  };
  const views = projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    projects,
    tasks: [task, latest],
    replays: new Map(),
    resumes: new Map(),
  });
  const threadId = views[0].thread.threadId;
  let input: RemoteAgentTurnChangesInput = {
    gateway,
    owner: {},
    valid: () => true,
    snapshots: [snapshot],
    views: new Map(views.map((view) => [view.thread.threadId, view])),
  };
  let surface!: ReturnType<typeof useRemoteAgentTurnChanges>;
  const root = createRoot(document.createElement("div"));
  function Host() {
    surface = useRemoteAgentTurnChanges(input);
    return null;
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <Host />
      </StrictMode>,
    ),
  );
  return {
    threadId,
    snapshot,
    views,
    gateway,
    owner: input.owner,
    getTurnChanges,
    getTurnFileDiff,
    surface: () => surface,
    async update(next: Partial<RemoteAgentTurnChangesInput>) {
      input = { ...input, ...next };
      await act(async () =>
        root.render(
          <StrictMode>
            <Host />
          </StrictMode>,
        ),
      );
    },
    async dispose() {
      await act(async () => root.unmount());
    },
  };
}
describe("historical server turn changes", () => {
  it("uses the selected historical task for both endpoints and rejects unlisted files", async () => {
    const h = await harness();
    try {
      expect(await h.surface().getTurnChanges(h.threadId, "old")).toEqual(summary);
      expect(h.getTurnChanges).toHaveBeenCalledWith({ serverId: "server", taskId: "old" });
      expect(await h.surface().getTurnFileDiff(h.threadId, "old", "src/a.ts")).toEqual(diff);
      expect(h.getTurnFileDiff).toHaveBeenCalledWith({
        serverId: "server",
        taskId: "old",
        relativePath: "src/a.ts",
      });
      await expect(
        h.surface().getTurnFileDiff(h.threadId, "old", "elsewhere.ts"),
      ).rejects.toThrow();
      expect(h.getTurnFileDiff).toHaveBeenCalledTimes(1);
      expect((await h.surface().getTurnChanges(h.threadId, "foreign")).state).toBe("unsupported");
    } finally {
      await h.dispose();
    }
  });
  it.each([
    "unsupported",
    "disconnected",
    "foreign-project",
    "foreign-conversation",
    "running",
    "missing-task",
  ])("refuses %s without a latest-task fallback", async (scenario) => {
    const h = await harness();
    try {
      const snapshot = {
        ...h.snapshot,
        ...(scenario === "unsupported"
          ? {
              descriptor: {
                ...h.snapshot.descriptor!,
                capabilities: { ...h.snapshot.descriptor!.capabilities, turnChanges: false },
              },
            }
          : {}),
        ...(scenario === "disconnected" ? { connected: false } : {}),
        tasks:
          scenario === "missing-task"
            ? [latest]
            : [
                {
                  ...task,
                  ...(scenario === "foreign-project" ? { projectId: "other" } : {}),
                  ...(scenario === "foreign-conversation" ? { conversationId: "other" } : {}),
                  ...(scenario === "running" ? { status: "running" as const } : {}),
                },
                latest,
              ],
      };
      await h.update({ snapshots: [snapshot] });
      expect((await h.surface().getTurnChanges(h.threadId, "old")).state).toBe("unsupported");
      expect(h.getTurnChanges).not.toHaveBeenCalled();
    } finally {
      await h.dispose();
    }
  });
  it.each(["owner", "gateway", "runner", "task"])(
    "drops late responses across %s A-B-A transitions",
    async (scenario) => {
      const h = await harness();
      const pending = deferred<AgentTurnChangeSummary>();
      h.getTurnChanges.mockReturnValueOnce(pending.promise);
      try {
        const work = h.surface().getTurnChanges(h.threadId, "old");
        if (scenario === "owner") {
          await h.update({ owner: {} });
          await h.update({ owner: {} });
        } else if (scenario === "gateway") {
          await h.update({ gateway: { ...h.gateway } });
          await h.update({ gateway: h.gateway });
        } else {
          await h.update({
            snapshots: [
              {
                ...h.snapshot,
                ...(scenario === "runner"
                  ? { descriptor: { ...h.snapshot.descriptor!, runnerId: "other" } }
                  : { tasks: [latest] }),
              },
            ],
          });
          await h.update({ snapshots: [h.snapshot] });
        }
        pending.resolve(summary);
        expect((await work).state).toBe("unsupported");
        expect((await h.surface().getTurnChanges(h.threadId, "old")).state).toBe("ready");
        expect(h.getTurnChanges).toHaveBeenCalledTimes(2);
      } finally {
        await h.dispose();
      }
    },
  );
  it.each(["runner replacement", "unmount"])(
    "rejects a late file body after %s",
    async (change) => {
      const h = await harness();
      const pending = deferred<AgentTurnFileDiff>();
      h.getTurnFileDiff.mockReturnValueOnce(pending.promise);
      await h.surface().getTurnChanges(h.threadId, "old");
      const work = h.surface().getTurnFileDiff(h.threadId, "old", "src/a.ts");
      const rejected = expect(work).rejects.toThrow();
      await vi.waitFor(() => expect(h.getTurnFileDiff).toHaveBeenCalledTimes(1));
      if (change === "unmount") await h.dispose();
      else
        await h.update({
          snapshots: [
            { ...h.snapshot, descriptor: { ...h.snapshot.descriptor!, runnerId: "replacement" } },
          ],
        });
      pending.resolve(diff);
      await rejected;
      if (change !== "unmount") await h.dispose();
    },
  );
});

it("keeps display revision stable for equivalent fresh snapshots and transcript changes", async () => {
  const h = await harness();
  try {
    const original = h.surface().getTurnChangesRevision(h.threadId);
    await h.update({
      snapshots: [structuredClone(h.snapshot)],
      views: new Map(
        h.views.map((view) => [
          view.thread.threadId,
          {
            ...view,
            thread: {
              ...view.thread,
              title: "Renamed",
              turns: view.thread.turns.map((turn) => ({
                ...turn,
                prompt: "unrelated transcript change",
              })),
            },
          },
        ]),
      ),
    });
    expect(h.surface().getTurnChangesRevision(h.threadId)).toBe(original);
  } finally {
    await h.dispose();
  }
});
it.each(["disconnect", "capability", "runner", "project", "task", "duplicate-task", "revocation"])(
  "invalidates displayed changes for %s and does not reuse A's epoch after A-B-A",
  async (scenario) => {
    const h = await harness();
    try {
      const original = h.surface().getTurnChangesRevision(h.threadId);
      if (scenario === "revocation") await h.update({ valid: () => false });
      else
        await h.update({
          snapshots: [
            {
              ...h.snapshot,
              ...(scenario === "disconnect" ? { connected: false } : {}),
              ...(scenario === "capability"
                ? {
                    descriptor: {
                      ...h.snapshot.descriptor!,
                      capabilities: { ...h.snapshot.descriptor!.capabilities, turnChanges: false },
                    },
                  }
                : {}),
              ...(scenario === "runner"
                ? { descriptor: { ...h.snapshot.descriptor!, runnerId: "replacement" } }
                : {}),
              ...(scenario === "project" ? { projects: [] } : {}),
              ...(scenario === "duplicate-task"
                ? { tasks: [task, latest, { ...task, status: "running" as const }] }
                : {}),
              ...(scenario === "task"
                ? { tasks: [{ ...task, createdAt: "2026-09-23T00:00:00Z" }, latest] }
                : {}),
            },
          ],
        });
      const changed = h.surface().getTurnChangesRevision(h.threadId);
      expect(changed).not.toBe(original);
      await h.update({ snapshots: [h.snapshot], valid: () => true });
      expect(h.surface().getTurnChangesRevision(h.threadId)).not.toBe(original);
      expect(h.surface().getTurnChangesRevision(h.threadId)).not.toBe(changed);
    } finally {
      await h.dispose();
    }
  },
);

it("does not change A's displayed diff epoch when an unrelated B turn completes", async () => {
  const h = await harness();
  try {
    const original = h.surface().getTurnChangesRevision(h.threadId);
    const other = { ...task, id: "other", sequence: 3 };
    const all = [task, latest, other];
    const views = projectRemoteAgentThreads({
      serverId: "server",
      runnerId: "runner",
      projects,
      tasks: all,
      replays: new Map(),
      resumes: new Map(),
    });
    await h.update({
      snapshots: [{ ...h.snapshot, tasks: all }],
      views: new Map(views.map((view) => [view.thread.threadId, view])),
    });
    expect(h.surface().getTurnChangesRevision(h.threadId)).toBe(original);
  } finally {
    await h.dispose();
  }
});
