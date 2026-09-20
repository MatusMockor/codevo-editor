import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { parseAgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

function storedThread(subagentLifecycle: unknown): Record<string, unknown> {
  return {
    threadId: "agt-t1-0001",
    owner: { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "do the thing",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [
      {
        turnId: "agt-1-0a1b",
        prompt: "do the thing",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_000,
        endedAtEpochMs: 2_000,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        streamMetrics: null,
        cliVersion: null,
        launch: null,
        ...(subagentLifecycle === undefined ? {} : { subagentLifecycle }),
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}

describe("agentThreadWire subagent lifecycle", () => {
  it("round-trips the legacy snapshot unchanged", () => {
    const stored = storedThread(wire.valid.legacy);
    const parsed = parseAgentThread(stored);

    expect(parsed.turns[0].subagentLifecycle).toEqual(wire.valid.legacy);
    expect(serializeAgentThread(parsed)).toEqual(stored);
  });

  it("keeps retained detail read from an existing file in memory and rewrites the file in the v1 shape", () => {
    const parsed = parseAgentThread(storedThread(wire.valid.retained));
    const [parent] = wire.valid.retained.entries;
    const {
      taskTitle: _taskTitle,
      batchKey: _batchKey,
      nestedCount: _nestedCount,
      ...legacyParent
    } = parent;

    expect(parsed.turns[0].subagentLifecycle).toEqual(wire.valid.retained);
    expect(serializeAgentThread(parsed)).toEqual(
      storedThread({ entries: [legacyParent], truncated: true }),
    );
  });

  it("loads a turn stored before the lifecycle existed", () => {
    expect(parseAgentThread(storedThread(undefined)).turns[0].subagentLifecycle).toBeUndefined();
  });

  it("drops an unreadable lifecycle and keeps the thread it belongs to", () => {
    const entryPatched = wire.invalidEntryPatches.map((patch) => ({
      ...wire.valid.retained,
      entries: [{ ...wire.valid.retained.entries[0], ...patch }, wire.valid.retained.entries[1]],
    }));
    const rootPatched = wire.invalidRootPatches.map((patch) => ({
      ...wire.valid.retained,
      ...patch,
    }));

    for (const lifecycle of [...entryPatched, ...rootPatched, null, "nonsense", 7]) {
      expect(() => parseAgentSubagentLifecycle(lifecycle)).toThrow();
      const parsed = parseAgentThread(storedThread(lifecycle));

      expect(parsed.turns[0].subagentLifecycle).toBeUndefined();
      expect(parsed.turns[0].prompt).toBe("do the thing");
      expect(parsed.turns).toHaveLength(1);
    }
  });
});
