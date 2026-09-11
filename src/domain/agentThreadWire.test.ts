import { readFileSync } from "node:fs";
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

  it("emits the persisted usage fields the backend store accepts", () => {
    const withCost = storedThreadWithTurn({
      ...STORED_TURN,
      launch: null,
      events: [
        {
          kind: "result",
          text: "done",
          isError: false,
          usage: { inputTokens: 10, outputTokens: 2, contextTokens: null, costUsd: 0.125 },
        },
        { kind: "contextCompaction", beforeTokens: null, afterTokens: null },
      ],
    });

    expect(serializeAgentThread(parseAgentThread(withCost))).toEqual(withCost);
    expect(Object.keys(usageOf(serializeAgentThread(parseAgentThread(withCost))))).toEqual([
      "inputTokens",
      "outputTokens",
      "contextTokens",
      "costUsd",
    ]);

    const withoutCost = storedThreadWithTurn({
      ...STORED_TURN,
      launch: null,
      events: [
        {
          kind: "result",
          text: "done",
          isError: false,
          usage: { inputTokens: 10, outputTokens: 2, contextTokens: 120_000 },
        },
      ],
    });

    expect(Object.keys(usageOf(serializeAgentThread(parseAgentThread(withoutCost))))).toEqual([
      "inputTokens",
      "outputTokens",
      "contextTokens",
    ]);
  });
});

function usageOf(serialized: Record<string, unknown>): Record<string, unknown> {
  const turns = serialized.turns as ReadonlyArray<Record<string, unknown>>;
  const events = turns[0].events as ReadonlyArray<Record<string, unknown>>;
  return events[0].usage as Record<string, unknown>;
}

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

  it("preserves a bounded history snapshot through serialization and reload", () => {
    const history = {
      provider: "claudeCode",
      sessionId: SESSION_ID,
      exchanges: [
        { role: "user", text: "Ahoj 👋" },
        { role: "assistant", text: "Ahoj!" },
      ],
      exchangesTruncated: true,
      totalPreviewBytes: 14,
    };
    const stored = storedThreadWithOrigin({
      provider: "claudeCode",
      sessionId: SESSION_ID,
      importedAtEpochMs: 1,
      history,
    });
    expect(serializeAgentThread(parseAgentThread(stored))).toEqual(stored);
    expect(parseAgentThread(stored).turns).toHaveLength(1);
  });

  it("rejects malformed, oversized or foreign history snapshots", () => {
    const history = {
      provider: "claudeCode",
      sessionId: SESSION_ID,
      exchanges: [],
      exchangesTruncated: false,
      totalPreviewBytes: 0,
    };
    const invalidHistories = [
      null,
      { ...history, provider: "codex" },
      { ...history, sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      { ...history, extra: true },
      { ...history, exchanges: Array.from({ length: 257 }, () => ({ role: "user", text: "" })) },
      { ...history, exchanges: [{ role: "user", text: "👋" }], totalPreviewBytes: 2 },
      {
        ...history,
        exchanges: [{ role: "user", text: "x".repeat(16 * 1024 + 1) }],
        totalPreviewBytes: 16 * 1024 + 1,
      },
      {
        ...history,
        exchanges: Array.from({ length: 9 }, () => ({ role: "user", text: "x".repeat(16 * 1024) })),
        totalPreviewBytes: 9 * 16 * 1024,
      },
    ];
    for (const invalidHistory of invalidHistories) {
      expect(() =>
        parseAgentThread(
          storedThreadWithOrigin({
            provider: "claudeCode",
            sessionId: SESSION_ID,
            importedAtEpochMs: 1,
            history: invalidHistory,
          }),
        ),
      ).toThrow(/history/);
    }
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

describe("agentThreadWire attachments", () => {
  const IMAGE = {
    kind: "image",
    attachmentId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    name: "square.png",
    mime: "image/png",
    bytes: 204_800,
    width: 1_280,
    height: 720,
    storedPath: "/data/agent-attachments/threads/agt-t1-0001/0a1b2c3d4e5f60718293a4b5c6d7e8f9.png",
  } as const;

  function storedWithAttachments(attachments: unknown): Record<string, unknown> {
    return storedThreadWithTurn({ ...STORED_TURN, launch: null, attachments });
  }

  function readFixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  }

  it("re-serialises the shared attachment fixture byte-for-byte", () => {
    const raw = readFixture("agent-thread-with-attachments.json");
    const parsed = parseAgentThread(JSON.parse(raw));

    expect(parsed.turns[0].attachments).toEqual([
      IMAGE,
      {
        kind: "file",
        attachmentId: "112233445566778899001122334455aa",
        name: "notes.txt",
        bytes: 4_096,
        storedPath:
          "/data/agent-attachments/threads/agt-t1-0001/112233445566778899001122334455aa.txt",
      },
      {
        kind: "reference",
        name: "clip.mp4",
        path: "/Users/dev/Movies/clip.mp4",
        bytes: 73_400_320,
      },
    ]);
    expect(`${JSON.stringify(serializeAgentThread(parsed), null, 2)}\n`).toBe(raw);
  });

  it("re-serialises the legacy fixture byte-for-byte and adds no attachment key", () => {
    const raw = readFixture("agent-thread-legacy-no-attachments.json");
    expect(raw).not.toContain("attachments");

    const parsed = parseAgentThread(JSON.parse(raw));

    expect(parsed.turns[0].attachments).toBeUndefined();
    expect(`${JSON.stringify(serializeAgentThread(parsed), null, 2)}\n`).toBe(raw);
  });

  it("omits an absent list and refuses an empty one", () => {
    const stored = storedThreadWithTurn({ ...STORED_TURN, launch: null });
    const turn = serializeAgentThread(parseAgentThread(stored)).turns as ReadonlyArray<
      Record<string, unknown>
    >;

    expect("attachments" in turn[0]).toBe(false);
    expect(() => parseAgentThread(storedWithAttachments([]))).toThrow(
      /thread\.turns\[0\]\.attachments/,
    );
  });

  it("round-trips every attachment kind through the store", () => {
    for (const attachment of [
      IMAGE,
      { ...IMAGE, mime: "image/jpeg", bytes: 10 * 1_024 * 1_024, width: 1, height: 16_384 },
      {
        kind: "file",
        attachmentId: "ffffffffffffffffffffffffffffffff",
        name: "notes.txt",
        bytes: 50 * 1_024 * 1_024,
        storedPath: "/data/notes.txt",
      },
      { kind: "reference", name: "clip.mp4", path: "/Movies/clip.mp4", bytes: 0 },
    ]) {
      const stored = storedWithAttachments([attachment]);

      expect(parseAgentThread(stored).turns[0].attachments).toEqual([attachment]);
      expect(serializeAgentThread(parseAgentThread(stored))).toEqual(stored);
    }
  });

  it("rejects every malformed attachment instead of dropping it", () => {
    const { attachmentId: _attachmentId, ...withoutId } = IMAGE;
    const rejected: readonly unknown[] = [
      { ...IMAGE, kind: "video" },
      { ...IMAGE, extra: 1 },
      withoutId,
      { ...IMAGE, attachmentId: "0A1B2C3D4E5F60718293A4B5C6D7E8F9" },
      { ...IMAGE, attachmentId: "0a1b" },
      { ...IMAGE, name: "" },
      { ...IMAGE, name: `${"a".repeat(256)}.png` },
      { ...IMAGE, name: "dir/square.png" },
      { ...IMAGE, name: "dir\\square.png" },
      { ...IMAGE, name: 'sq"uare.png' },
      { ...IMAGE, name: "square\u0000.png" },
      { ...IMAGE, name: "square\u001b.png" },
      { ...IMAGE, mime: "image/svg+xml" },
      { ...IMAGE, bytes: -1 },
      { ...IMAGE, bytes: 1.5 },
      { ...IMAGE, bytes: 10 * 1_024 * 1_024 + 1 },
      { ...IMAGE, width: 0 },
      { ...IMAGE, height: 16_385 },
      { ...IMAGE, width: 1.5 },
      { ...IMAGE, storedPath: "relative/square.png" },
      { ...IMAGE, storedPath: `/${"a".repeat(4_096)}` },
      { ...IMAGE, storedPath: "/square\u0000.png" },
      {
        kind: "file",
        attachmentId: IMAGE.attachmentId,
        name: "n",
        bytes: 1,
        storedPath: "/n",
        mime: "image/png",
      },
      {
        kind: "file",
        attachmentId: IMAGE.attachmentId,
        name: "n",
        bytes: 50 * 1_024 * 1_024 + 1,
        storedPath: "/n",
      },
      { kind: "reference", name: "n", path: "/n", bytes: Number.MAX_SAFE_INTEGER + 1 },
      { kind: "reference", attachmentId: IMAGE.attachmentId, name: "n", path: "/n", bytes: 1 },
    ];

    for (const attachment of rejected) {
      expect(() => parseAgentThread(storedWithAttachments([attachment]))).toThrow(
        /thread\.turns\[0\]\.attachments/,
      );
    }
  });

  it("bounds the attachment count, duplicate ids, and the aggregate image bytes", () => {
    const nine = Array.from({ length: 9 }, (_unused, index) => ({
      kind: "reference",
      name: `clip-${index}.mp4`,
      path: `/Movies/clip-${index}.mp4`,
      bytes: 1,
    }));
    expect(() => parseAgentThread(storedWithAttachments(nine))).toThrow(
      /thread\.turns\[0\]\.attachments/,
    );
    expect(() => parseAgentThread(storedWithAttachments([IMAGE, { ...IMAGE }]))).toThrow(
      /unique attachment ids/,
    );

    const fiveMegabytes = 5 * 1_024 * 1_024;
    const eightImages = Array.from({ length: 8 }, (_unused, index) => ({
      ...IMAGE,
      attachmentId: `${index}`.repeat(32),
      bytes: fiveMegabytes,
    }));
    expect(parseAgentThread(storedWithAttachments(eightImages)).turns[0].attachments).toHaveLength(
      8,
    );

    const overBudget = eightImages.map((image) => ({ ...image, bytes: fiveMegabytes + 1 }));
    expect(() => parseAgentThread(storedWithAttachments(overBudget))).toThrow(
      /image bytes in one turn/,
    );
  });
});
