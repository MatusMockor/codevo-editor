import { describe, expect, it } from "vitest";
import { MAX_AGENT_EVENTS_PER_TURN, mergeTurnEvents, type AgentTurnEvent } from "./agentThread";
import {
  agentTurnConversationChunk,
  agentTurnConversationPreserved,
  agentTurnHydratedEvents,
} from "./agentTurnConversationCore";

const ask: AgentTurnEvent = { kind: "userMessage", text: "please continue" };
const first: AgentTurnEvent = { kind: "assistantText", text: "first reply" };
const second: AgentTurnEvent = { kind: "assistantText", text: "second reply" };

function subagent(index: number): AgentTurnEvent {
  return { kind: "assistantText", text: `subagent ${index}`, parentToolId: "toolu_agent" };
}

function tool(index: number): AgentTurnEvent {
  return { kind: "toolCall", toolId: `tool-${index}`, name: "Bash", inputSummary: `run ${index}` };
}

describe("agent turn conversation chunk", () => {
  it("keeps user messages, main replies and the event right before each main reply", () => {
    const events = [ask, subagent(1), tool(2), first, subagent(3), tool(4), second, tool(5)];

    expect(agentTurnConversationChunk(events, false)).toEqual({
      events: [ask, tool(2), first, tool(4), second],
      needsBoundary: false,
    });
  });

  it("selects the same events whether the log is read in one page or across page edges", () => {
    const events = [ask, tool(1), tool(2), first, tool(3), second, tool(4), tool(5)];
    const whole = agentTurnConversationChunk(events, false).events;
    for (let edge = 1; edge < events.length; edge += 1) {
      const later = agentTurnConversationChunk(events.slice(edge), false);
      const earlier = agentTurnConversationChunk(events.slice(0, edge), later.needsBoundary);
      expect([...earlier.events, ...later.events], `edge ${edge}`).toEqual(whole);
    }
  });

  it("keeps two main replies distinct after the events between them are dropped", () => {
    const events = [first, ...Array.from({ length: 50 }, (_, index) => tool(index)), second];
    const kept = agentTurnConversationChunk(events, false).events;

    expect(
      mergeTurnEvents([], kept).events.filter((event) => event.kind === "assistantText"),
    ).toEqual([first, second]);
  });
});

describe("agent turn hydrated events", () => {
  it("bounds the conversation and window to the in-memory turn limit and says so", () => {
    const conversation = Array.from({ length: 600 }, (_, index): AgentTurnEvent => ({
      kind: "userMessage",
      text: `ask ${index}`,
    }));
    const window = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN }, (_, index) => tool(index));
    const hydrated = agentTurnHydratedEvents([], conversation, window);

    expect(hydrated.events.length).toBe(MAX_AGENT_EVENTS_PER_TURN);
    expect(hydrated.events.slice(0, conversation.length)).toEqual(conversation);
    expect(hydrated.events[hydrated.events.length - 1]).toEqual(window[window.length - 1]);
    expect(hydrated.truncated).toBe(true);
  });

  it("returns the window untouched when there is no earlier conversation", () => {
    const window = [tool(1), tool(2)];

    expect(agentTurnHydratedEvents([], [], window)).toEqual({ events: window, truncated: false });
  });
});

describe("agent turn conversation preservation", () => {
  it("accepts a hydration that shows every saved user message and main reply", () => {
    expect(
      agentTurnConversationPreserved([ask, tool(1), first], [ask, first, tool(2), second]),
    ).toBe(true);
  });

  it("rejects a hydration that would hide a saved main reply or user message", () => {
    expect(agentTurnConversationPreserved([ask, first, second], [ask, second])).toBe(false);
    expect(agentTurnConversationPreserved([ask, second], [first, second])).toBe(false);
  });

  it("ignores saved activity and subagent text the hydration does not show", () => {
    expect(agentTurnConversationPreserved([tool(1), subagent(2), first], [first])).toBe(true);
  });
});
