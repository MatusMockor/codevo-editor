import { describe, expect, it } from "vitest";
import { MAX_SUBAGENT_THREADS_PER_TURN, mergeTurnEvents, type AgentTurnEvent } from "./agentThread";
import { MAX_PERSISTED_AGENT_EVENTS_PER_TURN, capTurnTail } from "./agentThreadTailCap";
import { agentTurnHydratedEvents } from "./agentTurnConversationCore";
import { isAgentMainReply } from "./agentTurnTailSelection";

const HISTORY_BYTES = 512 * 1_024;

function step(index: number): ReadonlyArray<AgentTurnEvent> {
  return [
    { kind: "assistantText", text: `step ${index}` },
    { kind: "toolCall", toolId: `tool-${index}`, name: "Bash", inputSummary: `run ${index}` },
    { kind: "toolResult", toolId: `tool-${index}`, outputSummary: `ok ${index}`, isError: false },
  ];
}

function replySteps(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<number> {
  return events
    .filter(isAgentMainReply)
    .map((event) => (event.kind === "assistantText" ? Number(event.text.split(" ")[1]) : -1));
}

function subagentThreads(events: ReadonlyArray<AgentTurnEvent>): number {
  return new Set(events.flatMap((event) => ("agentThreadId" in event ? [event.agentThreadId] : [])))
    .size;
}

describe("agent turn tail selection", () => {
  it("keeps the newest main replies of a narration-heavy turn without gaps", () => {
    const events: AgentTurnEvent[] = [{ kind: "userMessage", text: "go" }];
    for (let index = 0; index < 340; index += 1) events.push(...step(index));
    events.push({ kind: "result", text: "done", isError: false, usage: null });

    const kept = capTurnTail(events, MAX_PERSISTED_AGENT_EVENTS_PER_TURN, HISTORY_BYTES);
    const steps = replySteps(kept);
    const newest = steps[steps.length - 1]!;

    expect(kept.length).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_EVENTS_PER_TURN);
    expect(newest).toBe(339);
    expect(steps).toEqual(
      Array.from({ length: steps.length }, (_, index) => 340 - steps.length + index),
    );
    expect(mergeTurnEvents([], kept).events.filter(isAgentMainReply)).toHaveLength(steps.length);
  });

  it("never selects more subagent threads than a turn may hold", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "subagentActivity",
      agentThreadId: `thread-${index}`,
      agentPath: `/agents/${index}`,
      activity: "started",
    }));
    events.push(...Array.from({ length: 600 }, (_, index) => step(index)[1]!));

    const kept = capTurnTail(events, MAX_PERSISTED_AGENT_EVENTS_PER_TURN, HISTORY_BYTES);

    expect(subagentThreads(capTurnTail(events, 1_024, Number.POSITIVE_INFINITY))).toBe(
      MAX_SUBAGENT_THREADS_PER_TURN,
    );
    expect(subagentThreads(kept)).toBeLessThanOrEqual(MAX_SUBAGENT_THREADS_PER_TURN);
  });

  it("keeps every hydrated main reply when the log window touches more than 32 subagents", () => {
    const conversation: AgentTurnEvent[] = [];
    for (let index = 0; index < 50; index += 1) {
      conversation.push(
        { kind: "userMessage", text: `ask ${index}` },
        { kind: "assistantText", text: `step ${index}` },
      );
    }
    const window: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "subagentActivity",
      agentThreadId: `thread-${index}`,
      agentPath: `/agents/${index}`,
      activity: "completed",
    }));
    window.push(
      { kind: "assistantText", text: "step 50" },
      { kind: "result", text: "done", isError: false, usage: null },
    );

    const hydrated = mergeTurnEvents([], agentTurnHydratedEvents([], conversation, window).events);

    expect(replySteps(hydrated.events)).toEqual(Array.from({ length: 51 }, (_, index) => index));
    expect(subagentThreads(hydrated.events)).toBeLessThanOrEqual(MAX_SUBAGENT_THREADS_PER_TURN);
    expect(hydrated.truncated).toBe(false);
  });
});
