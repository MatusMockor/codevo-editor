import { describe, expect, it } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsAction,
} from "../domain/agentThread";
import { parseAgentThread, serializeAgentThread } from "../domain/agentThreadWire";
import {
  acceptAgentTurnOutput,
  createAgentTurnOutputStream,
  domainAgentOutputParser,
  drainAgentTurnOutput,
  sessionChangeNotice,
} from "./agentTurnOutputStream";

const OLD = "previous-session";
const NEW = "fallback-session";
const fallback = { v: 1, t: "sessionFallback", previousThreadId: OLD, threadId: NEW };

function setup(
  provider: "codex" | "claudeCode" = "codex",
  transport: "exec" | "appServer" = "appServer",
) {
  const thread: AgentThread = {
    threadId: "agt-thread-1",
    owner: { rootKey: "/repo", ownerId: "workspace-1", repositoryRoot: "/repo" },
    target: { isolation: "worktree", worktreePath: "/repo/.worktrees/thread" },
    provider: { kind: provider, sessionId: OLD },
    title: "test",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    turns: [
      {
        turnId: "agt-turn-1",
        prompt: "continue",
        status: { kind: "running" },
        startedAtEpochMs: 1,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        streamMetrics: null,
        launch: defaultAgentLaunchOptions(provider),
        codexTransport: transport,
        cliVersion: null,
      },
    ],
  };
  let state = agentThreadsReducer(emptyAgentThreadsState(), { kind: "threadCreated", thread });
  const stream = createAgentTurnOutputStream(domainAgentOutputParser, {
    threadId: thread.threadId,
    turnId: thread.turns[0].turnId,
    ownerId: thread.owner.ownerId,
    repositoryRoot: thread.owner.repositoryRoot,
    ...thread.target,
    kind: provider,
    codexTransport: transport,
    resumed: true,
    resumedSessionId: OLD,
  });
  let sequence = 0;
  return {
    thread,
    stream,
    state: () => state,
    session: () => state.threads.get(thread.threadId)!.provider.sessionId,
    feed(value: unknown) {
      acceptAgentTurnOutput(domainAgentOutputParser, stream, {
        taskId: stream.turnId,
        sequence: ++sequence,
        stream: "stdout",
        chunk: JSON.stringify(value) + "\n",
        truncated: false,
      });
      return drainAgentTurnOutput(stream, sequence)!;
    },
    apply(action: AgentThreadsAction) {
      state = agentThreadsReducer(state, action);
    },
  };
}

describe("exact-owner app-server resume fallback", () => {
  it("adopts the confirmed replacement once, persists it, and avoids the stale-session warning", () => {
    const h = setup();
    const action = h.feed(fallback);
    h.apply(action);
    expect(h.session()).toBe(NEW);
    expect(sessionChangeNotice(h.state(), h.thread.threadId, action.sessionId)).toBeNull();
    const saved = parseAgentThread(serializeAgentThread(h.state().threads.get(h.thread.threadId)!));
    expect(saved.provider.sessionId).toBe(NEW);
    expect(saved.target).toEqual(h.thread.target);
    expect(saved.turns[0].events).toEqual([]);
    h.apply(h.feed({ ...fallback, previousThreadId: NEW, threadId: "another-session" }));
    expect(h.session()).toBe(NEW);
  });

  it("keeps arbitrary session echoes from replacing the existing session", () => {
    const h = setup();
    h.apply(h.feed({ v: 1, t: "session", threadId: NEW }));
    expect(h.session()).toBe(OLD);
    h.apply(h.feed(fallback));
    expect(h.session()).toBe(OLD);
  });

  it.each(["exec", "claude"])("does not trust fallback envelopes on %s output", (kind) => {
    const h = kind === "exec" ? setup("codex", "exec") : setup("claudeCode");
    h.apply(h.feed(fallback));
    expect(h.session()).toBe(OLD);
  });

  it("rejects a fallback for a session other than the captured resume request", () => {
    const h = setup();
    h.apply(h.feed({ ...fallback, previousThreadId: "foreign-session" }));
    expect(h.session()).toBe(OLD);
  });

  it.each([
    { workspaceId: "workspace-other" },
    { repositoryRoot: "/other" },
    { worktreePath: "/other-worktree" },
    { isolation: "in-place" as const },
    { turnId: "agt-foreign-1" },
    { outputSequence: 0 },
    { sessionId: "different-candidate" },
    { sessionFallback: { previousThreadId: "wrong-session", threadId: NEW } },
  ])("rejects mismatched fallback authority %#", (override) => {
    const h = setup();
    h.apply({ ...h.feed(fallback), ...override });
    expect(h.session()).toBe(OLD);
  });

  it("does not adopt after terminal settlement", () => {
    const h = setup();
    const action = h.feed(fallback);
    h.apply({ kind: "turnInterrupted", turnId: h.stream.turnId, nowEpochMs: 2 });
    h.apply(action);
    expect(h.session()).toBe(OLD);
  });
});
