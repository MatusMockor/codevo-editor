import { describe, expect, it } from "vitest";
import { agentTurnStream } from "../test/agentTurnEventStreams";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  mergeTurnEvents,
  parseAgentThread,
  serializeAgentThread,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";
import {
  MAX_PERSISTED_AGENT_EVENTS_PER_TURN,
  MAX_PERSISTED_AGENT_THREAD_FILE_BYTES,
  PERSISTED_AGENT_THREAD_FILE_MARGIN_BYTES,
  PERSISTED_AGENT_THREAD_FIT_SLACK_BYTES,
  agentTurnSkeletonEvents,
  capAgentThreadForPersistence,
  capTurnTail,
  persistedAgentEventsBytes,
  persistedAgentThreadScaffoldBytes,
} from "./agentThreadTailCap";

const UTF8 = new TextEncoder();
const LIVE_TURN_EVENTS = 256;
const LIVE_TURN_BYTES = 192 * 1_024;
const OVERSIZED_THREAD_TURNS = 64;

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-0a1c",
    prompt: "do the thing",
    status: { kind: "running" },
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(turns: ReadonlyArray<AgentTurn>): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: {
      rootKey: "/workspace/app",
      ownerId: "agent-root:1",
      repositoryRoot: "/workspace/app",
    },
    target: { isolation: "worktree", worktreePath: "/workspace/app/.worktrees/agt-1-0a1b" },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
}

function settledTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return turn({ status: { kind: "exited", exitCode: 0 }, ...overrides });
}

function persistedTurns(subject: AgentThread): ReadonlyArray<{
  readonly events: ReadonlyArray<{ readonly kind: string }>;
  readonly eventsTruncated: boolean;
}> {
  const document = serializeAgentThread(subject);
  return document.turns as ReadonlyArray<{
    readonly events: ReadonlyArray<{ readonly kind: string }>;
    readonly eventsTruncated: boolean;
  }>;
}

function keptKinds(events: ReadonlyArray<{ readonly kind: string }>): string {
  return events.map((event) => event.kind.charAt(0)).join("");
}

function say(index: number, size = 200): AgentTurnEvent {
  return {
    kind: "toolCall",
    toolId: `call-${index}`,
    name: "Bash",
    inputSummary: "x".repeat(size),
  };
}

function wide(index: number, size: number): AgentTurnEvent {
  return { kind: "assistantText", text: `${index}:${"x".repeat(size)}` };
}

function steer(text: string): AgentTurnEvent {
  return { kind: "userMessage", text };
}

function answer(text: string): AgentTurnEvent {
  return { kind: "assistantText", text };
}

function outcome(text: string): AgentTurnEvent {
  return { kind: "result", text, isError: false, usage: null };
}

function documentBytes(document: Record<string, unknown>): number {
  return UTF8.encode(JSON.stringify(document)).byteLength;
}

function finalAnswerText(candidate: AgentTurn | undefined): string {
  const events = candidate?.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.kind === "assistantText" || event.kind === "result") return event.text;
  }
  return "";
}

function oversizedThread(build: (position: number) => ReadonlyArray<AgentTurnEvent>): AgentThread {
  return thread(
    Array.from({ length: OVERSIZED_THREAD_TURNS }, (_, position) =>
      settledTurn({
        turnId: `agt-1-${String(position).padStart(4, "0")}`,
        events: build(position),
      }),
    ),
  );
}

function promptHeavyThread(): AgentThread {
  return thread(
    Array.from({ length: OVERSIZED_THREAD_TURNS }, (_, position) =>
      settledTurn({
        turnId: `agt-1-${String(position).padStart(4, "0")}`,
        prompt: "p".repeat(16 * 1_024 - 8),
        events: [outcome("done")],
      }),
    ),
  );
}

const oversizedThreadScenarios: ReadonlyArray<{
  readonly name: string;
  readonly build: () => AgentThread;
}> = [
  {
    name: "16 KiB answers closed by 16 KiB results",
    build: () =>
      oversizedThread((position) => [
        answer(`${position}:${"x".repeat(16 * 1_024 - 16)}`),
        outcome(`${position}:${"y".repeat(16 * 1_024 - 16)}`),
      ]),
  },
  {
    name: "newline heavy 16 KiB results",
    build: () =>
      oversizedThread((position) => [outcome(`${position}${"\n".repeat(16 * 1_024 - 16)}`)]),
  },
  {
    name: "30 pinned 16 KB steers closed by an answer",
    build: () =>
      oversizedThread((position) => [
        ...Array.from({ length: 30 }, (_, index) =>
          steer(`${position}-${index}:${"s".repeat(16_000)}`),
        ),
        answer("FINAL ANSWER"),
        outcome("done"),
      ]),
  },
];

describe("agent thread tail cap", () => {
  it("keeps only the newest tail within the live event and byte bounds", () => {
    const events = Array.from({ length: 900 }, (_, index) => say(index));
    const capped = capTurnTail(events, LIVE_TURN_EVENTS, LIVE_TURN_BYTES);
    expect(capped.length).toBeLessThanOrEqual(LIVE_TURN_EVENTS);
    expect(persistedAgentEventsBytes(capped)).toBeLessThanOrEqual(LIVE_TURN_BYTES);
    expect(capped[capped.length - 1]).toEqual(events[events.length - 1]);
    expect(capped).toEqual(events.slice(events.length - capped.length));
  });

  it("pins user steering messages ahead of older output", () => {
    const events: AgentTurnEvent[] = [
      steer("first instruction"),
      ...Array.from({ length: 900 }, (_, index) => say(index)),
    ];
    const capped = capTurnTail(events, LIVE_TURN_EVENTS, LIVE_TURN_BYTES);
    expect(capped[0]).toEqual(steer("first instruction"));
    expect(capped.length).toBeLessThanOrEqual(LIVE_TURN_EVENTS);
  });

  it("returns the same array when the turn already fits", () => {
    const events = [steer("hello"), say(1)];
    expect(capTurnTail(events, LIVE_TURN_EVENTS, LIVE_TURN_BYTES)).toBe(events);
  });

  it("shrinks a settled turn to its user messages and final answer", () => {
    const events: AgentTurnEvent[] = [
      steer("please fix it"),
      say(1),
      { kind: "assistantText", text: "middle" },
      say(2),
      { kind: "assistantText", text: "the answer" },
      { kind: "result", text: "done", isError: false, usage: null },
    ];
    expect(agentTurnSkeletonEvents(events)).toEqual([
      steer("please fix it"),
      { kind: "assistantText", text: "the answer" },
      { kind: "result", text: "done", isError: false, usage: null },
    ]);
  });

  it("shrinks settled turns oldest first and keeps the live turn intact", () => {
    const settled = (turnId: string): AgentTurn =>
      turn({
        turnId,
        status: { kind: "exited", exitCode: 0 },
        events: [
          steer(`ask ${turnId}`),
          ...Array.from({ length: 60 }, (_, index) => wide(index, 4_000)),
          { kind: "assistantText", text: `answer ${turnId}` },
        ],
      });
    const live = turn({
      turnId: "agt-live",
      events: [steer("latest"), ...Array.from({ length: 60 }, (_, index) => wide(index, 4_000))],
    });
    const capped = capAgentThreadForPersistence(
      thread([settled("agt-a"), settled("agt-b"), live]),
      32 * 1_024,
    );

    expect(capped.turns[0]?.events).toEqual([
      steer("ask agt-a"),
      { kind: "assistantText", text: "answer agt-a" },
    ]);
    expect(capped.turns[0]?.eventsTruncated).toBe(true);
    expect(capped.turns[2]?.events.some((event) => event.kind === "userMessage")).toBe(true);
    expect(capped.turns[2]?.events.length).toBeGreaterThan(1);
  });

  it("marks a turn truncated only when the JSON holds fewer events than the turn produced", () => {
    const small = capAgentThreadForPersistence(thread([turn({ events: [say(1)] })]));
    expect(small.turns[0]?.eventsTruncated).toBe(false);
    const large = capAgentThreadForPersistence(
      thread([turn({ events: Array.from({ length: 900 }, (_, index) => say(index)) })]),
    );
    expect(large.turns[0]?.eventsTruncated).toBe(true);
  });

  it("saves a 5000 event live turn inside the v1 JSON limits", () => {
    const raw = agentTurnStream(7, 5_000);
    const merged = mergeTurnEvents([], raw);
    expect(merged.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);

    const document = serializeAgentThread(
      thread([turn({ events: merged.events, eventsTruncated: merged.truncated })]),
    );
    const turns = document.turns as ReadonlyArray<{ events: ReadonlyArray<unknown> }>;
    expect(turns[0]?.events.length).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_EVENTS_PER_TURN);
    expect(documentBytes(document)).toBeLessThan(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
    expect(parseAgentThread(document).turns[0]?.eventsTruncated).toBe(true);
  });

  it("marks a turn truncated when its retained event text is clipped to fit", () => {
    const subject = thread([
      settledTurn({ turnId: "agt-1-0000", events: [outcome("d".repeat(16_000))] }),
      settledTurn({ turnId: "agt-1-0001", events: [answer("FINAL ANSWER"), outcome("done")] }),
    ]);
    const capped = capAgentThreadForPersistence(subject, 8 * 1_024);

    expect(capped.turns[0]?.events).toHaveLength(1);
    expect(capped.turns[0]?.eventsTruncated).toBe(true);
    expect(finalAnswerText(capped.turns[0]).length).toBeGreaterThan(0);
    expect(finalAnswerText(capped.turns[0]).length).toBeLessThan(16_000);
    expect(finalAnswerText(capped.turns[1])).toBe("done");
    expect(capped.turns[1]?.eventsTruncated).toBe(false);
  });

  it("clips multi-byte text on a code point boundary", () => {
    const subject = thread([
      settledTurn({ turnId: "agt-1-0000", events: [outcome("🙂".repeat(4_000))] }),
      settledTurn({ turnId: "agt-1-0001", events: [outcome("done")] }),
    ]);
    const capped = capAgentThreadForPersistence(subject, 8 * 1_024);
    const clipped = finalAnswerText(capped.turns[0]);

    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.length).toBeLessThan(8_000);
    expect([...clipped].every((character) => character === "🙂")).toBe(true);
    expect(parseAgentThread(serializeAgentThread(capped)).turns).toHaveLength(2);
  });

  for (const scenario of oversizedThreadScenarios) {
    it(`fits 64 turns of ${scenario.name} under the persisted file limit`, () => {
      const document = serializeAgentThread(capAgentThreadForPersistence(scenario.build()));

      expect(documentBytes(document)).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
      const parsed = parseAgentThread(document);
      expect(parsed.turns).toHaveLength(OVERSIZED_THREAD_TURNS);
      expect(finalAnswerText(parsed.turns[parsed.turns.length - 1]).length).toBeGreaterThan(0);
    });
  }

  it("gives back every event when 64 turns of 16 KiB prompts overflow the file alone", () => {
    const capped = capAgentThreadForPersistence(promptHeavyThread());
    const scaffold = persistedAgentThreadScaffoldBytes(capped);

    expect(scaffold).toBeGreaterThan(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
    expect(capped.turns.every((candidate) => candidate.events.length === 0)).toBe(true);
    expect(capped.turns.every((candidate) => candidate.eventsTruncated)).toBe(true);
    expect(documentBytes(serializeAgentThread(capped))).toBeLessThanOrEqual(
      scaffold + PERSISTED_AGENT_THREAD_FIT_SLACK_BYTES,
    );
  });

  it("keeps every event of a settled 400 event turn that easily fits the file", () => {
    const events = Array.from({ length: 400 }, (_, index) => say(index, 100));
    const [persisted] = persistedTurns(thread([settledTurn({ events })]));
    expect(persisted?.events).toHaveLength(400);
    expect(persisted?.eventsTruncated).toBe(false);
  });

  it("keeps a settled 300 KiB turn whole instead of cutting it to the live byte cap", () => {
    const events = Array.from({ length: 200 }, (_, index) => say(index, 1_500));
    const [persisted] = persistedTurns(thread([settledTurn({ events })]));
    expect(persisted?.events).toHaveLength(200);
    expect(persisted?.eventsTruncated).toBe(false);
  });

  it("keeps four settled 180 KiB turns intact instead of shrinking the oldest to skeletons", () => {
    const turns = [0, 1, 2, 3].map((position) =>
      settledTurn({
        turnId: `agt-1-000${position}`,
        events: [
          ...Array.from({ length: 120 }, (_, index) => say(index, 1_400)),
          { kind: "assistantText", text: `answer ${position}` },
          { kind: "result", text: "done", isError: false, usage: null },
        ],
      }),
    );
    const subject = thread(turns);
    const persisted = persistedTurns(subject);
    expect(persisted.map((entry) => entry.events.length)).toEqual([122, 122, 122, 122]);
    expect(persisted.every((entry) => !entry.eventsTruncated)).toBe(true);
    expect(documentBytes(serializeAgentThread(subject))).toBeLessThan(
      MAX_PERSISTED_AGENT_THREAD_FILE_BYTES,
    );
  });

  it("never drops the final answer and result while older steers are kept", () => {
    const events: AgentTurnEvent[] = [
      ...Array.from({ length: 600 }, (_, index) => steer(`steer ${index}`)),
      { kind: "assistantText", text: "FINAL ANSWER" },
      { kind: "result", text: "done", isError: false, usage: null },
    ];
    const [persisted] = persistedTurns(thread([settledTurn({ events })]));
    expect(persisted?.events).toHaveLength(MAX_PERSISTED_AGENT_EVENTS_PER_TURN);
    expect(keptKinds(persisted?.events ?? []).endsWith("ar")).toBe(true);
    expect(persisted?.eventsTruncated).toBe(true);
  });

  it("reserves the final answer and result when pinned steers exhaust the byte budget", () => {
    const steers = Array.from({ length: 16 }, () => steer("s".repeat(16_000)));
    const answer: AgentTurnEvent = { kind: "assistantText", text: "FINAL ANSWER" };
    const closing: AgentTurnEvent = { kind: "result", text: "done", isError: false, usage: null };
    const budget = persistedAgentEventsBytes(steers.slice(0, 12));
    const capped = capTurnTail(
      [...steers, answer, closing],
      MAX_PERSISTED_AGENT_EVENTS_PER_TURN,
      budget,
    );
    expect(capped[capped.length - 2]).toEqual(answer);
    expect(capped[capped.length - 1]).toEqual(closing);
    expect(persistedAgentEventsBytes(capped)).toBeLessThanOrEqual(budget);
  });

  it("still fits a genuinely oversized thread under the ceiling and says so", () => {
    const turns = Array.from({ length: 16 }, (_, position) =>
      settledTurn({
        turnId: `agt-1-00${String(position).padStart(2, "0")}`,
        events: [
          steer(`ask ${position}`),
          ...Array.from({ length: 400 }, (_, index) => wide(index, 4_000)),
          { kind: "result", text: `done ${position}`, isError: false, usage: null },
        ],
      }),
    );
    const document = serializeAgentThread(thread(turns));
    expect(documentBytes(document)).toBeLessThan(
      MAX_PERSISTED_AGENT_THREAD_FILE_BYTES - PERSISTED_AGENT_THREAD_FILE_MARGIN_BYTES,
    );
    const persisted = document.turns as ReadonlyArray<{ readonly eventsTruncated: boolean }>;
    expect(persisted.every((entry) => entry.eventsTruncated)).toBe(true);
  });

  it("keeps a whole thread of wide settled turns under the file cap", () => {
    const turns = Array.from({ length: 64 }, (_, position) =>
      turn({
        turnId: `agt-${position}`,
        status: { kind: "exited", exitCode: 0 },
        events: [
          steer(`ask ${position}`),
          ...Array.from({ length: 400 }, (_, index) => wide(index, 2_000)),
          { kind: "result", text: `done ${position}`, isError: false, usage: null },
        ],
      }),
    );
    const document = serializeAgentThread(thread(turns));
    expect(documentBytes(document)).toBeLessThan(MAX_PERSISTED_AGENT_THREAD_FILE_BYTES);
    const parsed = parseAgentThread(document);
    expect(parsed.turns).toHaveLength(64);
    expect(parsed.turns.every((candidate) => candidate.eventsTruncated)).toBe(true);
    expect(parsed.turns[0]?.events[0]).toEqual(steer("ask 0"));
  });
});
