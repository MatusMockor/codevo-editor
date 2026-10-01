// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { MAX_AGENT_EVENTS_PER_TURN, type AgentTurnEvent } from "../domain/agentThread";
import { MAX_PERSISTED_HISTORY_TURN_EVENT_BYTES, capTurnTail } from "../domain/agentThreadTailCap";
import {
  LOG_THREAD_ID,
  LOG_TURN_ID,
  logProject,
  logThread,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import { MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES } from "./agentTurnLogConversationScan";
import { MAX_AGENT_TURN_HYDRATION_PAGES } from "./useAgentTurnLogHydration";

const PERSISTED_TAIL_EVENTS = 512;
const WINDOW_PAGES = Math.ceil(MAX_AGENT_EVENTS_PER_TURN / 200);

function ask(index: number): AgentTurnEvent {
  return { kind: "userMessage", text: `follow-up ${index}` };
}

function reply(index: number): AgentTurnEvent {
  return { kind: "assistantText", text: `main reply ${index}` };
}

function subagentOutput(index: number): AgentTurnEvent {
  return {
    kind: "toolCall",
    toolId: `tool-${index}`,
    name: "Bash",
    inputSummary: `run ${index}`,
    parentToolId: "toolu_agent",
  };
}

function noise(from: number, length: number): ReadonlyArray<AgentTurnEvent> {
  return Array.from({ length }, (_unused, index) => subagentOutput(from + index));
}

function longConversation(): {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly conversation: ReadonlyArray<AgentTurnEvent>;
} {
  const events: AgentTurnEvent[] = [];
  const conversation: AgentTurnEvent[] = [];
  for (let index = 0; index < 6; index += 1) {
    conversation.push(ask(index), reply(index * 2), reply(index * 2 + 1));
    events.push(ask(index), ...noise(index * 1_000, 40), reply(index * 2));
    events.push(...noise(index * 1_000 + 500, 40), reply(index * 2 + 1));
  }
  events.push(...noise(100_000, 3_000));
  return { events, conversation };
}

function conversationOf(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  return events.filter(
    (event) =>
      event.kind === "userMessage" ||
      (event.kind === "assistantText" && event.parentToolId === undefined),
  );
}

function naiveTail(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  return events.slice(-PERSISTED_TAIL_EVENTS);
}

function savedTail(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  return capTurnTail(events, PERSISTED_TAIL_EVENTS, MAX_PERSISTED_HISTORY_TURN_EVENT_BYTES);
}

function restarted(
  events: ReadonlyArray<AgentTurnEvent>,
  summary = sealedLogSummary(LOG_TURN_ID, events.length),
  persist: (events: ReadonlyArray<AgentTurnEvent>) => ReadonlyArray<AgentTurnEvent> = naiveTail,
) {
  const harness = renderLogStore({
    persisted: [
      logThread({ turns: [logTurn({ events: persist(events), eventsTruncated: true })] }),
    ],
    summaries: [summary],
  });
  harness.logGateway.seed(LOG_TURN_ID, events);
  return harness;
}

async function releaseWindowPages(harness: ReturnType<typeof renderLogStore>): Promise<void> {
  for (let page = 0; page < WINDOW_PAGES; page += 1) {
    harness.logGateway.releaseReads();
    await settleLogStore();
  }
}

describe("agent turn log hydration restores the conversation of a trimmed turn", () => {
  it("shows every follow-up and main reply that the saved tail lost to subagent output", async () => {
    const { events, conversation } = longConversation();
    const harness = restarted(events);
    await settleLogStore();
    expect(conversationOf(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events ?? [])).toEqual([]);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(conversationOf(turn?.events ?? [])).toEqual(conversation);
    expect(turn?.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(turn?.events[turn.events.length - 1]).toEqual(events[events.length - 1]);
    expect(turn?.eventsTruncated).toBe(true);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("partial");
    expect(harness.logGateway.reads.length).toBeLessThanOrEqual(
      MAX_AGENT_TURN_HYDRATION_PAGES + MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES,
    );
    await harness.unmount();
  });

  it("never reads a log whose loss makes it incomplete", async () => {
    const { events } = longConversation();
    const harness = restarted(
      events,
      sealedLogSummary(LOG_TURN_ID, events.length, { loss: { kind: "supervisorGap" } }),
    );
    await settleLogStore();
    const saved = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.reads).toEqual([]);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)).toBe(saved);
    await harness.unmount();
  });

  it("drops the conversation scan when the workspace went A, B and back to A mid-scan", async () => {
    const { events } = longConversation();
    const harness = restarted(events);
    await settleLogStore();
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    await releaseWindowPages(harness);
    expect(harness.logGateway.reads).toHaveLength(WINDOW_PAGES + 1);

    harness.setProjects([]);
    await settleLogStore();
    harness.setProjects([logProject({ generation: 2 })]);
    await settleLogStore();
    const reloaded = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)).toBe(reloaded);
    expect(conversationOf(reloaded?.events ?? [])).toEqual([]);
    expect(harness.logGateway.reads).toHaveLength(WINDOW_PAGES + 1);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("notAttempted");
    await harness.unmount();
  });

  it("falls back to the newest window when a scanned page cannot be read", async () => {
    const { events } = longConversation();
    const harness = restarted(events);
    await settleLogStore();
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    await releaseWindowPages(harness);

    harness.logGateway.readFails = true;
    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(turn?.events).toEqual(events.slice(-MAX_AGENT_EVENTS_PER_TURN));
    expect(turn?.eventsTruncated).toBe(true);
    expect(harness.logGateway.reads).toHaveLength(WINDOW_PAGES + 1);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("partial");
    await harness.unmount();
  });

  it("never narrows a saved conversation when a scanned page cannot be read", async () => {
    const { events, conversation } = longConversation();
    const harness = restarted(events, sealedLogSummary(LOG_TURN_ID, events.length), savedTail);
    await settleLogStore();
    const saved = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(conversationOf(saved?.events ?? [])).toEqual(conversation);
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    await releaseWindowPages(harness);

    harness.logGateway.readFails = true;
    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)).toBe(saved);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("failed");
    await harness.unmount();
  });

  it("hydrates a saved tail that already holds the conversation without losing any of it", async () => {
    const { events, conversation } = longConversation();
    const harness = restarted(events, sealedLogSummary(LOG_TURN_ID, events.length), savedTail);
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(conversationOf(turn?.events ?? [])).toEqual(conversation);
    expect(turn?.events.length).toBeGreaterThan(PERSISTED_TAIL_EVENTS);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("partial");
    await harness.unmount();
  });

  it("stops scanning after a bounded number of pages on a huge log", async () => {
    const pages = MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES + 10;
    const events = [ask(0), reply(0), ...noise(0, MAX_AGENT_EVENTS_PER_TURN + pages * 200)];
    const harness = restarted(events);
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(harness.logGateway.reads).toHaveLength(
      WINDOW_PAGES + MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES,
    );
    expect(conversationOf(turn?.events ?? [])).toEqual([]);
    expect(turn?.eventsTruncated).toBe(true);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("partial");
    await harness.unmount();
  });
});
