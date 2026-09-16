import { describe, expect, it } from "vitest";
import { agentCompactionState } from "../domain/agentCompactionState";
import type { RemoteRunnerEvent, RemoteRunnerTask } from "../domain/remoteRunner";
import { RemoteAgentProjection, type RemoteAgentProjectionInput } from "./remoteAgentProjection";

const task: RemoteRunnerTask = {
  id: "claude-task",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "running",
  projectId: "project",
  parts: [{ type: "text", text: "Continue implementing" }],
  createdAt: "2026-09-16T12:00:00Z",
};
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
function output(sequence: number, text: string): RemoteRunnerEvent {
  return {
    taskId: task.id,
    sequence,
    type: "task.output",
    channel: "stdout",
    createdAt: task.createdAt,
    text,
  };
}
function snapshot(
  events: readonly RemoteRunnerEvent[],
  complete = false,
): RemoteAgentProjectionInput {
  return {
    serverId: "linux",
    runnerId: task.runnerId,
    projects: [{ id: "project", name: "Project" }],
    tasks: [{ ...task, status: complete ? "succeeded" : "running" }],
    replays: new Map([[task.id, events]]),
    resumes: new Map(),
    replayComplete: complete ? new Set([task.id]) : new Set(),
  };
}

describe("remote Claude compaction telemetry", () => {
  it("retains split live status, usage and completion across duplicate snapshots and reconnect", () => {
    const cache = new RemoteAgentProjection();
    const status = line({ type: "system", subtype: "status", status: "compacting" });
    const partial = output(1, status.slice(0, 20));
    expect(cache.project(snapshot([partial]))[0]!.thread.turns[0]!.events).toEqual([]);
    const live = [partial, output(2, status.slice(20))];
    const active = cache.project(snapshot(live));
    const turn = active[0]!.thread.turns[0]!;
    expect(agentCompactionState("claudeCode", turn)).toEqual({ kind: "compacting" });
    expect(cache.project(snapshot(live))).toBe(active);

    const completed = [
      ...live,
      output(
        3,
        line({
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "auto", pre_tokens: 160000 },
        }) +
          line({
            type: "assistant",
            message: {
              model: "claude-sonnet-test",
              content: [{ type: "text", text: "Continuing after compaction." }],
              usage: {
                input_tokens: 100,
                cache_creation_input_tokens: 200,
                cache_read_input_tokens: 300,
              },
            },
          }) +
          line({
            type: "result",
            subtype: "success",
            result: "Done",
            modelUsage: {
              "claude-sonnet-test": { inputTokens: 999999, contextWindow: 200000 },
            },
          }),
      ),
    ];
    const finished = cache.project(snapshot(completed, true))[0]!.thread.turns[0]!;
    expect(finished.events).toContainEqual({
      kind: "contextUsage",
      model: "claude-sonnet-test",
      inputTokens: 600,
      contextWindow: null,
    });
    expect(finished.events).toContainEqual({
      kind: "contextUsage",
      model: "claude-sonnet-test",
      inputTokens: null,
      contextWindow: 200000,
    });
    expect(finished.events.some((event) => event.kind === "contextCompaction")).toBe(true);
    expect(agentCompactionState("claudeCode", finished)).toEqual({ kind: "idle" });
    expect(finished.streamMetrics?.complete).toBe(true);
    const replayed = new RemoteAgentProjection().project(snapshot(completed, true));
    expect(replayed[0]!.thread.turns[0]!.events).toEqual(finished.events);
    expect(
      cache.project({ ...snapshot([], false), serverId: "other" })[0]!.thread.turns[0]!.events,
    ).toEqual([]);
  });

  it("keeps truncation explicit and clears active status when the remote task stops", () => {
    const input = snapshot([
      output(1, line({ type: "system", subtype: "status", status: "compacting" })),
    ]);
    const views = new RemoteAgentProjection().project({
      ...input,
      tasks: [{ ...task, status: "cancelled" }],
      replayTruncated: new Set([task.id]),
      replayComplete: new Set([task.id]),
    });
    const turn = views[0]!.thread.turns[0]!;
    expect(turn.eventsTruncated).toBe(true);
    expect(turn.streamMetrics?.complete).toBe(false);
    expect(agentCompactionState("claudeCode", turn)).toEqual({ kind: "idle" });
  });
});
