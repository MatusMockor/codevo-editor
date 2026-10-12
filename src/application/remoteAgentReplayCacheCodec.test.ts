import { describe, expect, it } from "vitest";
import type { RemoteRunnerEvent } from "../domain/remoteRunner";
import {
  decodeRemoteAgentReplayCacheRecord as decode,
  encodeRemoteAgentReplayCacheRecord as encode,
} from "./remoteAgentReplayCacheCodec";
import type { RemoteReplayMemoryTask, RemoteReplayTaskIdentity } from "./remoteAgentReplayMemory";
import { MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES } from "./remoteAgentReplayCachePorts";
import { generateStream, SEEDS } from "./remoteAgentDifferentialTestSupport";
import { fakeRunnerGateway, loadUntilSettled } from "./remoteAgentTailFirstTestSupport";
import {
  forwardRemoteTaskReplay,
  priorRemoteTaskReplay,
  tailRemoteTaskReplay,
} from "./remoteAgentTaskReplay";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-09-13T00:00:00Z";
const identity: RemoteReplayTaskIdentity = {
  id: TASK_ID,
  runnerId: "runner",
  provider: "claude",
  createdAt: CREATED_AT,
  sequence: 1,
  status: "succeeded",
  projectId: "project",
  conversationId: TASK_ID,
};
const output: RemoteRunnerEvent = {
  sequence: 10,
  taskId: TASK_ID,
  type: "task.output",
  createdAt: CREATED_AT,
  channel: "stdout",
  text: "café 中🧪\n",
};
const input: RemoteRunnerEvent = {
  sequence: 2,
  taskId: TASK_ID,
  type: "task.input",
  createdAt: CREATED_AT,
  messageId: MESSAGE_ID,
  parts: [
    { type: "text", text: "café 中🧪" },
    { type: "attachment", attachmentId: ATTACHMENT_ID },
  ],
};

function record(change: Partial<RemoteReplayMemoryTask["replay"]> = {}): RemoteReplayMemoryTask {
  return {
    identity,
    replay: {
      events: [input, output],
      cursor: 10,
      earlier: { kind: "loaded" },
      truncated: false,
      discarded: false,
      evictedThrough: 0,
      complete: true,
      ...change,
    },
  };
}

function envelope(value = record()): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ v: 1, ...value })) as Record<string, unknown>;
}

function roundTrip(value: RemoteReplayMemoryTask): void {
  const encoded = encode(value);
  expect(encoded.kind).toBe("encoded");
  if (encoded.kind !== "encoded") return;
  expect(decode(encoded.record, value.identity)).toEqual(JSON.parse(JSON.stringify(value)));
}

const variants: readonly RemoteReplayMemoryTask[] = [
  record(),
  ...(["failed", "interrupted", "cancelled"] as const).map((status) => ({
    ...record(),
    identity: { ...identity, status },
  })),
  record({
    truncated: true,
    gap: { throughSequence: output.sequence, startsAtLineBoundary: true },
    evictedThrough: output.sequence,
  }),
  record({
    earlier: { kind: "retained" },
    truncated: true,
    gap: { throughSequence: 8, startsAtLineBoundary: false },
  }),
  { ...record(), resume: { available: true, reason: null } },
  { ...record(), resume: { available: false, reason: "newer_turn_exists" } },
  record({
    lifecycle: {
      entries: [
        {
          id: "tool:child",
          toolId: "child",
          name: "agent",
          description: "café 中🧪",
          state: "completed",
          telemetryState: "completed",
          durationMs: 7,
          totalTokens: 42,
        },
      ],
      truncated: false,
    },
  }),
  record({
    earlier: { kind: "retained" },
    truncated: true,
    discarded: true,
    evictedThrough: 8,
    gap: { throughSequence: 8, startsAtLineBoundary: true },
  }),
  record({ events: [], cursor: 0 }),
  {
    ...record(),
    identity: { ...identity, parentTaskId: MESSAGE_ID, isolation: "in-place" },
  },
];

describe("remote replay cache codec", () => {
  it.each(variants)("round trips settled terminal records %j", (value) => roundTrip(value));

  const unsettled: readonly RemoteReplayMemoryTask[] = [
    record({ earlier: { kind: "pending", before: 1 }, complete: false }),
    record({ earlier: { kind: "scanningInputs", before: 1 }, complete: false, truncated: true }),
    record({
      earlier: { kind: "scanningInputs", before: 1, stdoutBoundary: { kind: "pending" } },
      complete: false,
      truncated: true,
    }),
    record({ earlier: { kind: "scanningBoundary", before: 1 }, complete: false, truncated: true }),
    record({ complete: false }),
    record({ earlier: { kind: "pending", before: 1 } }),
    record({ earlier: { kind: "scanningInputs", before: 1 }, truncated: true }),
    record({ earlier: { kind: "scanningBoundary", before: 1 }, truncated: true }),
    record({ cursor: 11 }),
    record({ evictedThrough: 11 }),
    record({ truncated: true, gap: { throughSequence: 11, startsAtLineBoundary: true } }),
    ...(["draft", "queued", "running"] as const).map((status) => ({
      ...record(),
      identity: { ...identity, status },
    })),
  ];
  it.each(unsettled)("refuses unsettled or nonterminal records %j", (value) => {
    expect(encode(value)).toEqual({ kind: "notPersistable" });
    expect(decode(JSON.stringify({ v: 1, ...value }), value.identity)).toBeNull();
  });

  it("omits undefined and preserves meaningful null", () => {
    const value = {
      ...record({ gap: undefined, lifecycle: undefined }),
      resume: {
        available: true as const,
        reason: null,
      },
    };
    const encoded = encode(value);
    expect(encoded.kind).toBe("encoded");
    if (encoded.kind !== "encoded") return;
    expect(encoded.record).not.toContain("undefined");
    expect(encoded.record).toContain('"reason":null');
    expect(encoded.record).not.toContain('"gap"');
    roundTrip(value);
  });

  it.each(["", "null", "[]", "false", "{", '"text"'])("rejects invalid root %s", (text) => {
    expect(decode(text, identity)).toBeNull();
  });

  const invalidEnvelope: readonly [string, (value: Record<string, unknown>) => void][] = [
    [
      "version",
      (value) => {
        value.v = 2;
      },
    ],
    [
      "missing version",
      (value) => {
        delete value.v;
      },
    ],
    [
      "extra root field",
      (value) => {
        value.extra = 1;
      },
    ],
    [
      "missing identity",
      (value) => {
        delete value.identity;
      },
    ],
    [
      "missing replay",
      (value) => {
        delete value.replay;
      },
    ],
    [
      "null resume",
      (value) => {
        value.resume = null;
      },
    ],
    [
      "unknown resume",
      (value) => {
        value.resume = { available: false, reason: "unknown" };
      },
    ],
    [
      "extra resume",
      (value) => {
        value.resume = { available: true, reason: null, extra: 1 };
      },
    ],
    [
      "inconsistent resume",
      (value) => {
        value.resume = { available: true, reason: "newer_turn_exists" };
      },
    ],
    [
      "missing resume reason",
      (value) => {
        value.resume = { available: false };
      },
    ],
  ];
  it.each(invalidEnvelope)("rejects %s", (_, mutate) => {
    const value = envelope();
    mutate(value);
    expect(decode(JSON.stringify(value), identity)).toBeNull();
  });

  const invalidIdentity: readonly [string, unknown][] = [
    ["id", "not-uuid"],
    ["runnerId", ""],
    ["provider", "future"],
    ["createdAt", "bad"],
    ["sequence", 0],
    ["status", "complete"],
    ["projectId", null],
    ["conversationId", "wrong"],
    ["parentTaskId", 17],
    ["isolation", "workspace"],
    ["extra", 1],
  ];
  it.each(invalidIdentity)("rejects invalid identity %s", (field, value) => {
    const invalid = { ...identity, [field]: value };
    expect(decode(JSON.stringify({ ...envelope(), identity: invalid }), identity)).toBeNull();
  });
  it.each(["id", "runnerId", "provider", "createdAt", "sequence", "status"])(
    "rejects missing identity %s",
    (field) => {
      const invalid: Record<string, unknown> = { ...identity };
      delete invalid[field];
      expect(decode(JSON.stringify({ ...envelope(), identity: invalid }), identity)).toBeNull();
    },
  );
  it.each(Object.keys(identity))("requires expected identity equality for %s", (field) => {
    const expected = { ...identity, [field]: "different" } as RemoteReplayTaskIdentity;
    expect(decode(JSON.stringify(envelope()), expected)).toBeNull();
  });

  const invalidReplay: readonly [string, unknown][] = [
    ["extra", true],
    ["events", null],
    ["cursor", -1],
    ["cursor", 9],
    ["cursor", 11],
    ["cursor", 10.5],
    ["cursor", "10"],
    ["truncated", "true"],
    ["discarded", null],
    ["evictedThrough", -1],
    ["evictedThrough", 0.5],
    ["evictedThrough", 11],
    ["complete", 1],
    ["complete", false],
    ["earlier", { kind: "unknown" }],
    ["earlier", { kind: "loaded", before: 1 }],
    ["earlier", { kind: "pending", before: 0 }],
    ["earlier", { kind: "pending", before: 2 }],
    ["earlier", { kind: "pending", before: 1 }],
    ["earlier", { kind: "scanningInputs", before: 1 }],
    ["earlier", { kind: "scanningBoundary", before: 1 }],
    ["earlier", { kind: "retained" }],
    ["gap", { throughSequence: 1, startsAtLineBoundary: true }],
    ["lifecycle", null],
    ["lifecycle", { entries: [], truncated: false, unknown: 1 }],
  ];
  it.each(invalidReplay)("rejects invalid replay %s=%j", (field, value) => {
    expect(decode(JSON.stringify({ v: 1, ...record({ [field]: value }) }), identity)).toBeNull();
  });
  it.each(["events", "cursor", "earlier", "truncated", "discarded", "evictedThrough", "complete"])(
    "rejects missing replay %s",
    (field) => {
      const replay: Record<string, unknown> = { ...record().replay };
      delete replay[field];
      expect(decode(JSON.stringify({ ...envelope(), replay }), identity)).toBeNull();
    },
  );

  it.each([
    { throughSequence: 11, startsAtLineBoundary: true },
    { throughSequence: 0, startsAtLineBoundary: true },
    { throughSequence: 8, startsAtLineBoundary: "true" },
    { throughSequence: 8, startsAtLineBoundary: true, extra: 1 },
    { startsAtLineBoundary: true },
  ])("rejects invalid gap %j", (gap) => {
    const replay = { ...record({ truncated: true }).replay, gap };
    expect(decode(JSON.stringify({ ...envelope(), replay }), identity)).toBeNull();
  });

  it.each([
    { kind: "scanningInputs", before: 1, stdoutBoundary: null },
    { kind: "scanningInputs", before: 1, stdoutBoundary: { kind: "loaded" } },
    { kind: "scanningInputs", before: 1, stdoutBoundary: { kind: "pending", extra: 1 } },
    { kind: "pending", before: 1, stdoutBoundary: { kind: "pending" } },
    { kind: "scanningBoundary" },
    { kind: "scanningInputs", before: 1.5 },
  ])("rejects invalid backward phase %j", (earlier) => {
    const replay = { ...record({ complete: false, truncated: true }).replay, earlier };
    expect(decode(JSON.stringify({ ...envelope(), replay }), identity)).toBeNull();
  });

  it.each([
    [output, input],
    [input, input],
    [{ ...output, taskId: MESSAGE_ID }],
    [{ ...output, type: "new-event" }],
    [{ ...output, extra: true }],
    [{ ...output, text: 1 }],
    [{ ...output, createdAt: "bad" }],
    [{ ...input, parts: [{ type: "attachment", attachmentId: "bad" }] }],
    [{ ...input, messageId: "bad" }],
    [{ ...output, sequence: 0 }],
  ])("rejects invalid events %j", (...events) => {
    const replay = { ...record().replay, events };
    expect(decode(JSON.stringify({ ...envelope(), replay }), identity)).toBeNull();
  });

  it("rejects complete nonterminal identity and impossible discarded metadata", () => {
    const active = { ...identity, status: "running" as const };
    expect(decode(JSON.stringify({ v: 1, ...record(), identity: active }), active)).toBeNull();
    expect(decode(JSON.stringify({ v: 1, ...record({ discarded: true }) }), identity)).toBeNull();
  });

  it("preserves locally retained output after the server evicts its own copy", () => {
    const cached = record({ events: [output], complete: false });
    const replay = forwardRemoteTaskReplay(
      cached.replay,
      { ...identity, parts: [{ type: "text", text: "prompt" }] },
      {
        items: [],
        nextCursor: null,
        outputTruncatedBeforeSequence: output.sequence,
        outputStartsAtLineBoundary: true,
      },
      MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
    );
    expect(replay.events).toEqual([output]);
    expect(replay.evictedThrough).toBe(output.sequence);
    expect(replay.truncated).toBe(false);
    roundTrip({ ...cached, replay });
  });

  it("refuses a server loss watermark beyond the loader cursor", () => {
    const replay = tailRemoteTaskReplay(
      { ...identity, parts: [{ type: "text", text: "prompt" }] },
      {
        items: [],
        nextCursor: null,
        outputTruncatedBeforeSequence: 10,
        outputStartsAtLineBoundary: true,
      },
      MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
    );
    expect(replay.events).toEqual([]);
    expect(replay.cursor).toBe(0);
    expect(replay.gap?.throughSequence).toBe(10);
    expect(encode({ identity, replay })).toEqual({ kind: "notPersistable" });
    expect(decode(JSON.stringify({ v: 1, identity, replay }), identity)).toBeNull();
  });

  it("round trips a settled forward replay with a mid-stream server gap", () => {
    const running = { ...identity, status: "running" as const };
    const task = { ...running, parts: [{ type: "text" as const, text: "prompt" }] };
    const loaded = forwardRemoteTaskReplay(
      record({ events: [], cursor: 0, complete: false }).replay,
      task,
      {
        items: [4, 5].map((sequence) => ({ ...output, sequence })),
        nextCursor: null,
      },
      MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
    );
    expect(loaded.complete).toBe(false);
    const replay = forwardRemoteTaskReplay(
      loaded,
      { ...task, status: "succeeded" },
      {
        items: [21, 22].map((sequence) => ({ ...output, sequence })),
        nextCursor: null,
        outputTruncatedBeforeSequence: 20,
        outputStartsAtLineBoundary: true,
      },
      MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
    );
    expect(replay.events.map((event) => event.sequence)).toEqual([4, 5, 21, 22]);
    expect(replay.gap?.throughSequence).toBe(20);
    expect(replay.earlier).toEqual({ kind: "loaded" });
    expect(replay.complete).toBe(true);
    roundTrip({ identity, replay });
  });

  it("rejects discarded output without truncation", () => {
    expect(
      decode(JSON.stringify({ v: 1, ...record({ discarded: true, evictedThrough: 8 }) }), identity),
    ).toBeNull();
  });

  it.each([
    { entries: [], truncated: "false" },
    { entries: [] },
    { truncated: false },
    {
      entries: [
        { id: "tool:child", toolId: "child", name: "child", description: "", state: "unknown" },
      ],
      truncated: false,
    },
    {
      entries: [{ id: "tool:child", toolId: "child", description: "", state: "running" }],
      truncated: false,
    },
    {
      entries: [
        {
          id: "tool:child",
          toolId: "child",
          name: "child",
          description: "",
          state: "running",
          extra: true,
        },
      ],
      truncated: false,
    },
  ])("rejects lifecycle fields and variants %j", (lifecycle) => {
    const replay = { ...record().replay, lifecycle };
    expect(decode(JSON.stringify({ ...envelope(), replay }), identity)).toBeNull();
  });

  it("bounds retained output and input event counts", () => {
    const events = Array.from({ length: 1101 }, (_, index) => ({ ...output, sequence: index + 1 }));
    expect(
      decode(JSON.stringify({ v: 1, ...record({ events, cursor: 1101 }) }), identity),
    ).toBeNull();
    const inputs = Array.from({ length: 33 }, (_, index) => ({ ...input, sequence: index + 1 }));
    expect(
      decode(JSON.stringify({ v: 1, ...record({ events: inputs, cursor: 33 }) }), identity),
    ).toBeNull();
  });

  it("measures the UTF-8 encoded envelope against the inclusive byte limit", () => {
    const events = Array.from({ length: 600 }, (_, index) => ({
      ...output,
      sequence: index + 1,
      text: "",
    }));
    const empty = record({ events, cursor: events.length });
    const base = encode(empty);
    expect(base.kind).toBe("encoded");
    if (base.kind !== "encoded") return;
    const available =
      MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES - new TextEncoder().encode(base.record).length;
    const sized = (bytes: number, unit = "x") => {
      let remaining = bytes;
      return record({
        cursor: events.length,
        events: events.map((event) => {
          const count = Math.min(remaining, 8192);
          remaining -= count;
          return { ...event, text: unit.repeat(count / new TextEncoder().encode(unit).length) };
        }),
      });
    };
    expect(encode(sized(available)).kind).toBe("encoded");
    expect(encode(sized(available + 1))).toEqual({ kind: "tooLarge" });
    expect(encode(sized(available + 4, "🧪"))).toEqual({ kind: "tooLarge" });
    expect(decode(" ".repeat(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES + 1), identity)).toBeNull();
    expect(
      decode('"' + "🧪".repeat(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES / 4) + '"', identity),
    ).toBeNull();
  });

  it("round trips settled terminal tasks from seeded loader streams", async () => {
    let persisted = 0;
    let refused = 0;
    for (const seed of SEEDS) {
      for (const index of [12, 14, 17, 21, 24]) {
        const stream = generateStream(seed, index, { events: 1100, bytes: 4 * 1024 * 1024 });
        const snapshot = await loadUntilSettled(
          fakeRunnerGateway(stream.runner, stream.tasks).gateway,
          stream.runner,
        );
        for (const task of stream.tasks) {
          const { parts: _parts, launch: _launch, ...taskIdentity } = task;
          const replay = priorRemoteTaskReplay(snapshot, task, "backward");
          const normalized: RemoteReplayMemoryTask = {
            identity: {
              ...taskIdentity,
              id: TASK_ID,
              conversationId: TASK_ID,
              ...(taskIdentity.parentTaskId === undefined ? {} : { parentTaskId: MESSAGE_ID }),
            },
            replay: {
              ...replay,
              events: replay.events.map((event) => {
                if (event.type === "task.input")
                  return { ...event, taskId: TASK_ID, messageId: MESSAGE_ID };
                return { ...event, taskId: TASK_ID };
              }),
            },
          };
          if (
            !replay.complete ||
            (replay.earlier.kind !== "loaded" && replay.earlier.kind !== "retained")
          ) {
            expect(encode(normalized)).toEqual({ kind: "notPersistable" });
            expect(decode(JSON.stringify({ v: 1, ...normalized }), normalized.identity)).toBeNull();
            refused += 1;
            continue;
          }
          roundTrip(normalized);
          persisted += 1;
        }
      }
    }
    expect(persisted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
