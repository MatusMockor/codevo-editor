import { describe, expect, it } from "vitest";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { mergePublishedRemoteTasks } from "./remoteAgentInventoryPresentation";

const running: RemoteRunnerTask = {
  id: "one",
  sequence: 1,
  status: "running",
  runnerId: "runner",
  provider: "codex",
  createdAt: "2026-09-13T00:00:00Z",
  parts: [{ type: "text", text: "Prompt" }],
};

function snapshot(tasks: readonly RemoteRunnerTask[]): RemoteAgentInventorySnapshot {
  return {
    ...emptyRemoteInventory("server", true),
    descriptor: {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, runtimeRequests: true },
    },
    tasks,
  };
}

describe("mergePublishedRemoteTasks interaction freshness", () => {
  it("publishes the loaded record over a cached copy with a lower sequence", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 4, awaiting: "approval" }]);
    const cached = snapshot([{ ...running, interactionSequence: 3 }]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(loaded.tasks);
  });

  it("publishes a cached record that moved on while the load was in flight", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 3 }]);
    const cached = snapshot([{ ...running, interactionSequence: 4, awaiting: "approval" }]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(cached.tasks);
  });

  it("publishes the loaded record over a cached copy from before the runner reported sequences", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 0 }]);
    const cached = snapshot([running]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(loaded.tasks);
  });

  it("keeps the cached list of an old runner when nothing changed, as before", () => {
    const loaded = snapshot([{ ...running }]);
    const cached = snapshot([running]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(cached.tasks);
  });

  it("keeps the cached list when the load reports the same sequence", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 4 }]);
    const cached = snapshot([{ ...running, interactionSequence: 4 }]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(cached.tasks);
  });

  it("publishes a cached status change and keeps the higher loaded sequence", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 4, awaiting: "approval" }]);
    const cached = snapshot([{ ...running, status: "cancelled", interactionSequence: 2 }]);

    const published = mergePublishedRemoteTasks(loaded, cached);

    expect(published).toEqual([{ ...running, status: "cancelled", interactionSequence: 4 }]);
    expect(mergePublishedRemoteTasks(snapshot(published), snapshot(published))).toBe(published);
  });

  it("publishes a sequence that moved after the turn ended", () => {
    const loaded = snapshot([{ ...running, status: "succeeded", interactionSequence: 6 }]);
    const cached = snapshot([{ ...running, status: "succeeded", interactionSequence: 5 }]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(loaded.tasks);
    expect(mergePublishedRemoteTasks(cached, loaded)).toEqual(loaded.tasks);
  });

  it("ignores a cached record of another runner", () => {
    const loaded = snapshot([{ ...running, interactionSequence: 3 }]);
    const cached = snapshot([{ ...running, runnerId: "other", interactionSequence: 9 }]);

    expect(mergePublishedRemoteTasks(loaded, cached)).toBe(loaded.tasks);
  });
});
