import { describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";
import { agentThreadQuietlyStreamed } from "./agentThreadQuietStream";

const OWNER_ID = "workspace-a";
const REPOSITORY_ROOT = "/workspace-a";
const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";

function runningTurn(): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "explain",
    status: { kind: "running" },
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function created(): AgentThreadsState {
  const thread: AgentThread = {
    threadId: THREAD_ID,
    owner: { rootKey: REPOSITORY_ROOT, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Explain",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [runningTurn()],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: 10,
    externalOrigin: null,
  };
  return agentThreadsReducer(emptyAgentThreadsState(), { kind: "threadCreated", thread });
}

let sequence = 0;

function append(state: AgentThreadsState, ...events: AgentTurnEvent[]): AgentThreadsState {
  sequence += 1;
  return agentThreadsReducer(state, {
    kind: "turnEventsAppended",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    workspaceId: OWNER_ID,
    repositoryRoot: REPOSITORY_ROOT,
    isolation: "in-place",
    worktreePath: null,
    outputSequence: sequence,
    events,
    sessionId: null,
    supervisorTruncated: false,
  });
}

function threadOf(state: AgentThreadsState): AgentThread {
  const thread = state.threads.get(THREAD_ID);
  if (thread === undefined) throw new Error("missing thread");
  return thread;
}

function streamingText(): AgentThreadsState {
  return append(created(), { kind: "assistantText", text: "Hello" });
}

describe("agentThreadQuietlyStreamed", () => {
  it("treats coalesced and appended transcript text as quiet", () => {
    const shown = streamingText();
    const coalesced = append(shown, { kind: "assistantText", text: " world" });
    const usage = append(coalesced, {
      kind: "contextUsage",
      model: "claude",
      inputTokens: 10,
      contextWindow: null,
    });
    const more = append(usage, { kind: "assistantText", text: "Again" });

    expect(threadOf(coalesced).turns[0]?.events).toHaveLength(1);
    expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(coalesced))).toBe(true);
    expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(usage))).toBe(true);
    expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(more))).toBe(true);
  });

  it("refreshes on tool calls, results, user messages and errors", () => {
    const shown = streamingText();
    const events: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "tool-1", name: "Bash", inputSummary: "ls" },
      { kind: "result", isError: false, text: "done", usage: null },
      { kind: "userMessage", text: "steer" },
      { kind: "error", message: "boom" },
    ];
    for (const event of events) {
      expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(append(shown, event)))).toBe(
        false,
      );
    }
  });

  it("refreshes when root output resumes after a result", () => {
    const settled = append(streamingText(), {
      kind: "result",
      isError: true,
      text: "",
      usage: null,
    });
    const reasoning = append(settled, { kind: "reasoning", text: "thinking" });
    const nested = append(settled, {
      kind: "assistantText",
      text: "child",
      parentToolId: "tool-1",
    });

    expect(agentThreadQuietlyStreamed(threadOf(settled), threadOf(reasoning))).toBe(false);
    expect(agentThreadQuietlyStreamed(threadOf(settled), threadOf(nested))).toBe(true);
  });

  it("refreshes on status, title and turn changes", () => {
    const shown = streamingText();
    const renamed = agentThreadsReducer(shown, {
      kind: "threadRenamed",
      threadId: THREAD_ID,
      title: "Renamed",
    });
    const stopped = agentThreadsReducer(shown, {
      kind: "taskStatusEvent",
      threadId: THREAD_ID,
      event: {
        taskId: TURN_ID,
        workspaceId: OWNER_ID,
        repositoryRoot: REPOSITORY_ROOT,
        isolation: "in-place",
        worktreePath: null,
        sequence: 2,
        status: { kind: "exited", exitCode: 0 },
      },
      nowEpochMs: 20,
    });

    expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(renamed))).toBe(false);
    expect(agentThreadQuietlyStreamed(threadOf(shown), threadOf(stopped))).toBe(false);
  });

  it("refreshes when retained output is replaced rather than extended", () => {
    const shown = append(
      streamingText(),
      { kind: "toolCall", toolId: "tool-1", name: "Bash", inputSummary: "ls" },
      { kind: "assistantText", text: "after" },
    );
    const live = threadOf(append(shown, { kind: "assistantText", text: " more" }));
    const rewritten: AgentThread = {
      ...live,
      turns: [{ ...live.turns[0]!, events: live.turns[0]!.events.slice(1) }],
    };

    expect(agentThreadQuietlyStreamed(threadOf(shown), live)).toBe(true);
    expect(agentThreadQuietlyStreamed(threadOf(shown), rewritten)).toBe(false);
  });

  it("never treats another thread as the same one", () => {
    const shown = threadOf(streamingText());
    expect(agentThreadQuietlyStreamed(shown, { ...shown, threadId: "agt-2-0a1b" })).toBe(false);
  });
});
