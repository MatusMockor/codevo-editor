import { describe, expect, it } from "vitest";
import type { AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import type { AgentThread } from "./agentThread";
import { compactPersistedAgentSubagentLifecycle } from "./agentLifecyclePersistence";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";
import {
  MAX_PERSISTED_AGENT_THREAD_FILE_BYTES,
  capAgentThreadForPersistence,
} from "./agentThreadTailCap";

function lifecycle(description = "x".repeat(512)): AgentSubagentLifecycle {
  return {
    entries: Array.from({ length: 32 }, (_, index) => ({
      id: `tool:${index}`,
      toolId: `t${index}`,
      name: "Agent",
      description,
      state: "completed",
      resultState: "completed",
    })),
    truncated: false,
  };
}

function subject(snapshot = lifecycle()): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: "/workspace/app", ownerId: "agent-root:1", repositoryRoot: "/workspace/app" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Lifecycle persistence",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20,
    turns: Array.from({ length: 64 }, (_, index) => ({
      turnId: `agt-1-${index.toString(16).padStart(4, "0")}`,
      prompt: "do the thing",
      status: { kind: "exited", exitCode: 0 },
      startedAtEpochMs: 10,
      endedAtEpochMs: 20,
      events: [],
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
      subagentLifecycle: snapshot,
    })),
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
}

function evidence(thread: AgentThread): ReadonlyMap<string, AgentSubagentLifecycle> {
  return new Map(thread.turns.map((turn) => [turn.turnId, turn.subagentLifecycle!]));
}

function bytes(document: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

describe("logged lifecycle persistence projection", () => {
  it("fits the legacy lifecycle scaffold that exceeded one MiB with no events or long prompts", () => {
    const thread = subject();
    expect(bytes(serializeAgentThread(thread))).toBeGreaterThan(
      MAX_PERSISTED_AGENT_THREAD_FILE_BYTES,
    );
    const document = serializeAgentThread(thread, undefined, evidence(thread));
    expect(bytes(document)).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
    const restored = parseAgentThread(document);
    expect(restored.turns).toHaveLength(64);
    expect(restored.turns[0]!.subagentLifecycle).toEqual(
      compactPersistedAgentSubagentLifecycle(thread.turns[0]!.subagentLifecycle!),
    );
    expect(restored.turns[0]!.subagentLifecycle!.entries).toHaveLength(1);
    expect(restored.turns[0]!.subagentLifecycle!.truncated).toBe(true);
    expect(thread.turns[0]!.subagentLifecycle!.entries).toHaveLength(32);
  });

  it("preserves running, unlogged and stale-evidence lifecycles", () => {
    const original = subject();
    const thread = {
      ...original,
      turns: original.turns.map((turn, index) =>
        index === 0 ? { ...turn, status: { kind: "running" as const } } : turn,
      ),
    };
    const logged = new Map(evidence(thread));
    logged.delete(thread.turns[1]!.turnId);
    logged.set(thread.turns[2]!.turnId, lifecycle("older description"));
    const projected = capAgentThreadForPersistence(thread, undefined, undefined, logged);
    for (const index of [0, 1, 2]) {
      expect(projected.turns[index]!.subagentLifecycle).toBe(
        thread.turns[index]!.subagentLifecycle,
      );
    }
    expect(projected.turns[3]!.subagentLifecycle!.entries).toHaveLength(1);
  });

  it("leaves fitting lifecycles intact and repeated projections stable", () => {
    const thread = subject();
    const small = { ...thread, turns: thread.turns.slice(0, 1) };
    expect(capAgentThreadForPersistence(small, undefined, undefined, evidence(small))).toBe(small);
    const once = capAgentThreadForPersistence(thread, undefined, undefined, evidence(thread));
    expect(capAgentThreadForPersistence(once, undefined, undefined, evidence(thread))).toBe(once);
  });

  it("measures JSON escaping and UTF-8 bytes before fitting", () => {
    for (const description of ["\n".repeat(512), "🦊".repeat(128)]) {
      const thread = subject(lifecycle(description));
      const document = serializeAgentThread(thread, undefined, evidence(thread));
      expect(bytes(document)).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
      expect(parseAgentThread(document).turns).toHaveLength(64);
    }
  });
});
