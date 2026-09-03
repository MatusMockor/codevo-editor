import { describe, expect, it } from "vitest";
import { CLAUDE_EFFORT_CHOICES } from "./agentLaunch";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

const STORED_TURN = {
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
} as const;

function storedThread(launch: unknown): Record<string, unknown> {
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
    turns: [{ ...STORED_TURN, launch }],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}

function storedThreadWithTurn(turn: Record<string, unknown>): Record<string, unknown> {
  return { ...storedThread(null), turns: [turn] };
}

describe("agentThreadWire launch effort", () => {
  it("fills the default effort for a stored claude turn written before the field existed", () => {
    const parsed = parseAgentThread(
      storedThread({ provider: "claudeCode", model: "sonnet", mode: "plan" }),
    );

    expect(parsed.turns[0].launch).toEqual({
      provider: "claudeCode",
      model: "sonnet",
      mode: "plan",
      effort: "default",
    });
  });

  it("round-trips every claude effort level through the store", () => {
    for (const effort of CLAUDE_EFFORT_CHOICES) {
      const launch = { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort };
      const parsed = parseAgentThread(storedThread(launch));

      expect(parsed.turns[0].launch).toEqual(launch);
      expect(serializeAgentThread(parsed)).toEqual(storedThread(launch));
    }
  });

  it("keeps effort out of a stored codex turn and rejects an unknown level", () => {
    const codex = { provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" };
    expect(parseAgentThread(storedThread(codex)).turns[0].launch).toEqual(codex);

    expect(() => parseAgentThread(storedThread({ ...codex, effort: "low" }))).toThrow(TypeError);
    expect(() =>
      parseAgentThread(
        storedThread({ provider: "claudeCode", model: "opus", mode: "plan", effort: "ultra" }),
      ),
    ).toThrow(/thread\.turns\[0\]\.launch\.effort/);
  });

  it("keeps a turn without a launch record null", () => {
    const parsed = parseAgentThread(storedThread(null));

    expect(parsed.turns[0].launch).toBeNull();
    expect(serializeAgentThread(parsed)).toEqual(storedThread(null));
  });
});

describe("agentThreadWire cliVersion", () => {
  it("reads a thread stored before the cliVersion field existed as null", () => {
    const { cliVersion: _cliVersion, ...legacyTurn } = STORED_TURN;

    const parsed = parseAgentThread(storedThreadWithTurn({ ...legacyTurn, launch: null }));

    expect(parsed.turns[0].cliVersion).toBeNull();
    expect(serializeAgentThread(parsed)).toEqual(storedThread(null));
  });

  it("round-trips a recorded CLI version", () => {
    const stored = storedThreadWithTurn({ ...STORED_TURN, launch: null, cliVersion: "2.1.245" });

    const parsed = parseAgentThread(stored);

    expect(parsed.turns[0].cliVersion).toBe("2.1.245");
    expect(serializeAgentThread(parsed)).toEqual(stored);
  });

  it("rejects a non-canonical or malformed stored CLI version", () => {
    const rejected: readonly unknown[] = ["garbage", " 2.1.245", "v2.1.245", "2", "", 2.1, {}];

    for (const cliVersion of rejected) {
      expect(() =>
        parseAgentThread(storedThreadWithTurn({ ...STORED_TURN, launch: null, cliVersion })),
      ).toThrow(/thread\.turns\[0\]\.cliVersion/);
    }
  });
});

describe("agentThreadWire stream metrics", () => {
  it("reads a schema-v1 turn written before stream metrics as null", () => {
    const { streamMetrics: _streamMetrics, ...legacyTurn } = STORED_TURN;
    const parsed = parseAgentThread(storedThreadWithTurn({ ...legacyTurn, launch: null }));

    expect(parsed.turns[0].streamMetrics).toBeNull();
  });

  it("round-trips exact stream metrics and rejects malformed or unknown fields", () => {
    const stored = storedThreadWithTurn({
      ...STORED_TURN,
      launch: null,
      streamMetrics: { receivedUtf8Bytes: 7, complete: false },
    });
    expect(serializeAgentThread(parseAgentThread(stored))).toEqual(stored);

    for (const streamMetrics of [
      { receivedUtf8Bytes: -1, complete: true },
      { receivedUtf8Bytes: 1.5, complete: true },
      { receivedUtf8Bytes: Number.MAX_SAFE_INTEGER + 1, complete: true },
      { receivedUtf8Bytes: 1, complete: "yes" },
      { receivedUtf8Bytes: 1, complete: true, extra: true },
    ]) {
      expect(() =>
        parseAgentThread(storedThreadWithTurn({ ...STORED_TURN, launch: null, streamMetrics })),
      ).toThrow(/streamMetrics/);
    }
  });
});

describe("agentThreadWire context metadata", () => {
  it("round-trips context usage and compaction events", () => {
    const events = [
      {
        kind: "result",
        text: "done",
        isError: false,
        usage: { inputTokens: 10, outputTokens: 2, contextTokens: 120_000 },
      },
      { kind: "contextCompaction", beforeTokens: 120_000, afterTokens: 40_000 },
    ];
    const stored = storedThreadWithTurn({ ...STORED_TURN, launch: null, events });
    expect(serializeAgentThread(parseAgentThread(stored))).toEqual(stored);
  });

  it("loads result usage written before contextTokens was recorded", () => {
    const stored = storedThreadWithTurn({
      ...STORED_TURN,
      launch: null,
      events: [
        {
          kind: "result",
          text: "done",
          isError: false,
          usage: { inputTokens: 10, outputTokens: 2 },
        },
      ],
    });
    expect(parseAgentThread(stored).turns[0].events[0]).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 2, contextTokens: null },
    });
  });
});

describe("agentThreadWire external origin", () => {
  const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";

  function storedThreadWithOrigin(externalOrigin: unknown): Record<string, unknown> {
    return { ...storedThread(null), externalOrigin };
  }

  it("parses a schema-v1 thread written before the field as null", () => {
    const { externalOrigin: _externalOrigin, ...legacy } = storedThread(null);

    expect("externalOrigin" in legacy).toBe(false);
    expect(parseAgentThread(legacy).externalOrigin).toBeNull();
    expect(parseAgentThread(storedThreadWithOrigin(null)).externalOrigin).toBeNull();
  });

  it("round-trips an imported provenance record verbatim", () => {
    const stored = storedThreadWithOrigin({
      provider: "claudeCode",
      sessionId: SESSION_ID,
      importedAtEpochMs: 1_700_000_000_000,
    });
    const parsed = parseAgentThread(stored);

    expect(parsed.externalOrigin).toEqual({
      provider: "claudeCode",
      sessionId: SESSION_ID,
      importedAtEpochMs: 1_700_000_000_000,
    });
    expect(serializeAgentThread(parsed)).toEqual(stored);
  });

  it("serializes an absent origin as an explicit null", () => {
    expect(serializeAgentThread(parseAgentThread(storedThread(null))).externalOrigin).toBeNull();
  });

  it("rejects a provider that disagrees with the thread provider kind", () => {
    expect(() =>
      parseAgentThread(
        storedThreadWithOrigin({
          provider: "codex",
          sessionId: SESSION_ID,
          importedAtEpochMs: 1,
        }),
      ),
    ).toThrow(/thread\.externalOrigin\.provider/);
  });

  it("rejects unknown keys, malformed ids and malformed timestamps", () => {
    const rejected: readonly unknown[] = [
      { provider: "claudeCode", sessionId: SESSION_ID, importedAtEpochMs: 1, extra: 1 },
      { provider: "claudeCode", sessionId: SESSION_ID },
      { provider: "gemini", sessionId: SESSION_ID, importedAtEpochMs: 1 },
      { provider: "claudeCode", sessionId: "../etc", importedAtEpochMs: 1 },
      { provider: "claudeCode", sessionId: null, importedAtEpochMs: 1 },
      { provider: "claudeCode", sessionId: SESSION_ID, importedAtEpochMs: -1 },
      { provider: "claudeCode", sessionId: SESSION_ID, importedAtEpochMs: 1.5 },
      [],
      "imported",
    ];

    for (const externalOrigin of rejected) {
      expect(() => parseAgentThread(storedThreadWithOrigin(externalOrigin))).toThrow(
        /thread\.externalOrigin/,
      );
    }
  });
});
