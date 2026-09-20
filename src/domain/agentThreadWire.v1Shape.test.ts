import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { agentPromptLooksClipped } from "./agentPromptClipping";
import type { AgentThread, AgentTurn, AgentTurnEvent, AgentTurnUsage } from "./agentThread";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

type Keys = ReadonlyArray<string>;
type WireRecord = Record<string, unknown>;

const V1_THREAD_KEYS: Keys = [
  "archived",
  "createdAtEpochMs",
  "externalOrigin",
  "integration",
  "owner",
  "pinned",
  "provider",
  "target",
  "threadId",
  "title",
  "turns",
  "turnsTruncated",
  "updatedAtEpochMs",
  "viewedAtEpochMs",
];

const V1_TURN_KEYS: Keys = [
  "attachments",
  "cliVersion",
  "codexTransport",
  "endedAtEpochMs",
  "events",
  "eventsTruncated",
  "lastOutputSequence",
  "lastStatusSequence",
  "launch",
  "prompt",
  "startedAtEpochMs",
  "status",
  "streamMetrics",
  "subagentLifecycle",
  "turnId",
];

const V1_EVENT_KEYS = {
  assistantText: ["kind", "parentToolId", "text"],
  reasoning: ["kind", "text"],
  userMessage: ["attachments", "kind", "text"],
  toolCall: ["description", "inputSummary", "kind", "name", "parentToolId", "toolId"],
  toolResult: ["isError", "kind", "outputSummary", "parentToolId", "toolId"],
  backgroundTask: ["description", "kind", "status", "taskId", "taskType"],
  subagent: [
    "description",
    "durationMs",
    "kind",
    "lastToolName",
    "status",
    "subagentType",
    "taskId",
    "toolId",
    "toolUses",
    "totalTokens",
  ],
  subagentActivity: ["activity", "agentPath", "agentThreadId", "kind"],
  subagentEvent: ["agentThreadId", "event", "kind"],
  subagentUsage: ["agentThreadId", "kind", "usage"],
  subagentTurnDone: ["agentThreadId", "durationMs", "isError", "kind"],
  queued: ["clientUserMessageId", "kind", "threadId"],
  result: ["durationMs", "isError", "kind", "text", "usage"],
  contextUsage: ["contextWindow", "inputTokens", "kind", "model"],
  contextCompactionStatus: ["kind", "message", "status"],
  contextCompaction: ["afterTokens", "beforeTokens", "kind"],
  error: ["kind", "message"],
  unknownLine: ["clipped", "kind", "raw", "stream"],
} as const satisfies Record<AgentTurnEvent["kind"], Keys>;

const V1_USAGE_KEYS: Keys = [
  "appServerUsage",
  "cachedInputTokens",
  "contextTokens",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "scope",
];

const BREAKDOWN = {
  inputTokens: 10,
  cachedInputTokens: 2,
  cacheWriteInputTokens: 1,
  outputTokens: 5,
  reasoningOutputTokens: 1,
  totalTokens: 15,
} as const;

const FULL_USAGE: AgentTurnUsage = {
  scope: "thread",
  appServerUsage: { last: BREAKDOWN, total: BREAKDOWN, contextWindow: 200_000 },
  cachedInputTokens: 2,
  reasoningOutputTokens: 1,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.25,
  contextTokens: 120,
};

const SUBAGENT_THREAD_ID = "019a0000-0000-7000-8000-000000000001";

const EVERY_EVENT: ReadonlyArray<AgentTurnEvent> = [
  {
    kind: "userMessage",
    remoteMessageId: "remote-1",
    text: "steer",
    attachments: [
      { kind: "reference", name: "notes.md", path: "/workspace/app/docs/notes.md", bytes: 12 },
    ],
  },
  { kind: "queued", threadId: SUBAGENT_THREAD_ID, clientUserMessageId: "client-1" },
  { kind: "reasoning", text: "thinking" },
  { kind: "assistantText", text: "answer", parentToolId: "tool-parent" },
  {
    kind: "toolCall",
    toolId: "tool-1",
    name: "Bash",
    inputSummary: "ls",
    description: "List files",
    parentToolId: "tool-parent",
  },
  {
    kind: "toolResult",
    toolId: "tool-1",
    outputSummary: "ok",
    isError: false,
    parentToolId: "tool-parent",
  },
  {
    kind: "backgroundTask",
    taskId: "task-1",
    status: "running",
    taskType: "shell",
    description: "watcher",
  },
  {
    kind: "subagent",
    status: "completed",
    toolId: "tool-2",
    taskId: "task-2",
    subagentType: "Explore",
    description: "scout",
    durationMs: 1_200,
    totalTokens: 400,
    toolUses: 3,
    lastToolName: "Read",
  },
  {
    kind: "subagentActivity",
    agentThreadId: SUBAGENT_THREAD_ID,
    agentPath: "root/scout",
    activity: "started",
  },
  {
    kind: "subagentEvent",
    agentThreadId: SUBAGENT_THREAD_ID,
    event: { kind: "assistantText", text: "nested" },
  },
  { kind: "subagentUsage", agentThreadId: SUBAGENT_THREAD_ID, usage: FULL_USAGE },
  { kind: "subagentTurnDone", agentThreadId: SUBAGENT_THREAD_ID, durationMs: 900, isError: false },
  { kind: "contextUsage", model: "claude", inputTokens: 100, contextWindow: 200_000 },
  { kind: "contextCompactionStatus", status: "compacting", message: "compacting" },
  { kind: "contextCompaction", beforeTokens: 900, afterTokens: 100 },
  { kind: "error", message: "boom" },
  { kind: "unknownLine", stream: "stdout", raw: "??", clipped: false },
  { kind: "result", text: "done", isError: false, usage: FULL_USAGE, durationMs: 2_000 },
];

function fullTurn(): AgentTurn {
  return {
    codexTransport: "appServer",
    turnId: "agt-1-0a1c",
    prompt: "do the thing",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: EVERY_EVENT,
    eventsTruncated: true,
    lastStatusSequence: 3,
    lastOutputSequence: 7,
    queueBoundarySequence: 5,
    foregroundSettled: true,
    subagentLifecycle: {
      entries: [
        {
          id: "tool-2",
          toolId: "tool-2",
          name: "Explore",
          description: "scout",
          state: "completed",
        },
      ],
      truncated: false,
    },
    streamMetrics: { receivedUtf8Bytes: 1_024, complete: true },
    launch: {
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
      context: "1m",
      fastMode: false,
      thinkingMode: false,
    },
    cliVersion: "1.2.3",
    attachments: [
      { kind: "reference", name: "notes.md", path: "/workspace/app/docs/notes.md", bytes: 12 },
    ],
  };
}

function fullThread(): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: "/workspace/app", ownerId: "ws-1", repositoryRoot: "/workspace/app" },
    target: { isolation: "worktree", worktreePath: "/workspace/app/.worktrees/agt-1-0a1b" },
    provider: { kind: "codex", sessionId: SUBAGENT_THREAD_ID },
    title: "Fix the parser",
    pinned: true,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20,
    turns: [fullTurn()],
    turnsTruncated: true,
    viewedAtEpochMs: 30,
    externalOrigin: null,
    integration: {
      lastCommitSha: "0123456789abcdef0123456789abcdef01234567",
      pushed: { remote: "origin", branch: "agent/fix" },
      integrated: {
        intoBranch: "main",
        mergeSha: "89abcdef0123456789abcdef0123456789abcdef",
        mode: "merge",
      },
      branchDeleted: true,
    },
  };
}

function keysOf(value: unknown): Keys {
  return Object.keys(value as WireRecord).sort();
}

function serializedTurn(): WireRecord {
  const turns = serializeAgentThread(fullThread()).turns as ReadonlyArray<WireRecord>;
  return turns[0]!;
}

describe("v1 thread JSON shape: shipped builds deny unknown fields and evict readable threads when they meet an unreadable one, so no phase may add a key", () => {
  it("writes exactly the v1 thread level keys", () => {
    const document = serializeAgentThread(fullThread());
    expect(keysOf(document)).toEqual(V1_THREAD_KEYS);
    expect(keysOf(document.owner)).toEqual(["ownerId", "repositoryRoot", "rootKey"]);
    expect(keysOf(document.target)).toEqual(["isolation", "worktreePath"]);
    expect(keysOf(document.provider)).toEqual(["kind", "sessionId"]);
    expect(keysOf(document.integration)).toEqual([
      "branchDeleted",
      "integrated",
      "lastCommitSha",
      "pushed",
    ]);
  });

  it("writes exactly the v1 turn level keys and never a runtime-only or log field", () => {
    const turn = serializedTurn();
    expect(keysOf(turn)).toEqual(V1_TURN_KEYS);
    expect(keysOf(turn.streamMetrics)).toEqual(["complete", "receivedUtf8Bytes"]);
    expect(keysOf(turn.status)).toEqual(["exitCode", "kind"]);
  });

  it("writes exactly the v1 event level keys for every event kind", () => {
    const events = serializedTurn().events as ReadonlyArray<WireRecord>;
    const seen = new Map(events.map((event) => [event.kind as string, keysOf(event)]));
    expect([...seen.keys()].sort()).toEqual(Object.keys(V1_EVENT_KEYS).sort());
    for (const [kind, keys] of Object.entries(V1_EVENT_KEYS)) {
      expect({ kind, keys: seen.get(kind) }).toEqual({ kind, keys });
    }
    const result = events.find((event) => event.kind === "result");
    expect(keysOf(result?.usage)).toEqual(V1_USAGE_KEYS);
    const nested = events.find((event) => event.kind === "subagentEvent");
    expect(keysOf(nested?.event)).toEqual(["kind", "text"]);
  });

  it("writes exactly the v1 keys of an imported thread origin", () => {
    const sessionId = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
    const document = serializeAgentThread({
      ...fullThread(),
      provider: { kind: "claudeCode", sessionId },
      externalOrigin: {
        provider: "claudeCode",
        sessionId,
        importedAtEpochMs: 5,
        history: {
          provider: "claudeCode",
          sessionId,
          exchanges: [{ role: "assistant", text: "Original answer" }],
          exchangesTruncated: false,
          totalPreviewBytes: 15,
        },
      },
    });
    expect(keysOf(document)).toEqual(V1_THREAD_KEYS);
    expect(keysOf(document.externalOrigin)).toEqual([
      "history",
      "importedAtEpochMs",
      "provider",
      "sessionId",
    ]);
    const origin = document.externalOrigin as WireRecord;
    expect(keysOf(origin.history)).toEqual([
      "exchanges",
      "exchangesTruncated",
      "provider",
      "sessionId",
      "totalPreviewBytes",
    ]);
  });

  it("stays readable by the v1 parser after a JSON round trip", () => {
    const document = JSON.parse(JSON.stringify(serializeAgentThread(fullThread()))) as unknown;
    const parsed = parseAgentThread(document);
    expect(keysOf(serializeAgentThread(parsed))).toEqual(V1_THREAD_KEYS);
    expect(parsed.turns[0]?.events).toHaveLength(EVERY_EVENT.length);
  });
});

const REPOSITORY_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/u, "");
const SHIPPED_PARSER_COMMIT = "c33d0d03";
const SHIPPED_PARSER_SCRATCH = "/tmp/codevo-agent-thread-wire-c33d0d03";
const SHIPPED_PARSER_ENTRY = `${SHIPPED_PARSER_SCRATCH}/src/domain/agentThreadWire.ts`;
const CLIPPED_PROMPT_TURNS = 64;

interface ShippedParser {
  readonly parseAgentThread: (value: unknown) => AgentThread;
}

let shippedParser: ShippedParser | null = null;
let shippedParserFailure: string | null = null;

function filler(position: number): AgentTurn {
  return {
    turnId: `agt-1-${String(position).padStart(4, "0")}`,
    prompt: `${position}:${"p".repeat(16 * 1_024 - 8)}`,
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [{ kind: "result", text: `done ${position}`, isError: false, usage: null }],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}

function clippedPromptThread(): AgentThread {
  const oldest: AgentTurn = {
    ...fullTurn(),
    prompt: `oldest:${"p".repeat(16 * 1_024 - 8)}`,
    subagentLifecycle: {
      entries: [
        {
          id: "tool-2",
          toolId: "tool-2",
          name: "Explore",
          description: "scout",
          state: "completed",
          telemetryState: "completed",
        },
      ],
      truncated: false,
    },
  };
  const rest = Array.from({ length: CLIPPED_PROMPT_TURNS - 1 }, (_unused, position) =>
    filler(position),
  );
  return { ...fullThread(), turns: [oldest, ...rest] };
}

function loggedPromptTurnIds(subject: AgentThread): ReadonlySet<string> {
  return new Set(subject.turns.slice(0, -1).map((candidate) => candidate.turnId));
}

describe("v1 thread JSON shape: a thread whose oldest prompts are clipped still parses in shipped builds", () => {
  beforeAll(async () => {
    try {
      rmSync(SHIPPED_PARSER_SCRATCH, { recursive: true, force: true });
      mkdirSync(SHIPPED_PARSER_SCRATCH, { recursive: true });
      execFileSync(
        "sh",
        [
          "-c",
          `git archive ${SHIPPED_PARSER_COMMIT} src/domain | tar -x -C ${SHIPPED_PARSER_SCRATCH}`,
        ],
        { cwd: REPOSITORY_ROOT },
      );
      shippedParser = (await import(/* @vite-ignore */ SHIPPED_PARSER_ENTRY)) as ShippedParser;
    } catch (error) {
      shippedParserFailure = error instanceof Error ? error.message : String(error);
    }
  });

  it("clips the oldest prompts without adding or removing a v1 key", () => {
    const subject = clippedPromptThread();
    const document = serializeAgentThread(subject, loggedPromptTurnIds(subject));
    const turns = document.turns as ReadonlyArray<WireRecord>;

    expect(keysOf(document)).toEqual(V1_THREAD_KEYS);
    expect(keysOf(turns[0])).toEqual(V1_TURN_KEYS);
    expect(agentPromptLooksClipped(turns[0]?.prompt as string)).toBe(true);
    expect(turns[turns.length - 1]?.prompt).toBe(subject.turns[subject.turns.length - 1]?.prompt);
    expect(JSON.stringify(document)).not.toContain("promptRestored");
  });

  it("stays readable by the current strict parser once prompts are clipped", () => {
    const subject = clippedPromptThread();
    const document = JSON.parse(
      JSON.stringify(serializeAgentThread(subject, loggedPromptTurnIds(subject))),
    ) as unknown;
    const parsed = parseAgentThread(document);

    expect(parsed.turns).toHaveLength(CLIPPED_PROMPT_TURNS);
    expect(agentPromptLooksClipped(parsed.turns[0]!.prompt)).toBe(true);
  });

  it(`stays readable by the parser shipped at ${SHIPPED_PARSER_COMMIT}`, (context) => {
    if (shippedParser === null) {
      context.skip(
        `the parser at ${SHIPPED_PARSER_COMMIT} could not be loaded: ${shippedParserFailure ?? "unknown reason"}`,
      );
      return;
    }
    const subject = clippedPromptThread();
    const document = JSON.parse(
      JSON.stringify(serializeAgentThread(subject, loggedPromptTurnIds(subject))),
    ) as unknown;
    const parsed = shippedParser.parseAgentThread(document);

    expect(parsed.turns).toHaveLength(CLIPPED_PROMPT_TURNS);
    expect(agentPromptLooksClipped(parsed.turns[0]!.prompt)).toBe(true);
    expect(parsed.turns[parsed.turns.length - 1]?.prompt).toBe(
      subject.turns[subject.turns.length - 1]?.prompt,
    );
  });

  it("writes the lifecycle state the shipped validator derives instead of an incoherent one", (context) => {
    if (shippedParser === null) {
      context.skip(
        `the parser at ${SHIPPED_PARSER_COMMIT} could not be loaded: ${shippedParserFailure ?? "unknown reason"}`,
      );
      return;
    }
    const document = JSON.parse(JSON.stringify(serializeAgentThread(fullThread()))) as unknown;
    const written = shippedParser.parseAgentThread(document).turns[0]?.subagentLifecycle;

    expect(written?.entries.map((entry) => entry.state)).toEqual(["running"]);
    expect(parseAgentThread(document).turns[0]?.subagentLifecycle).toEqual(written);
  });
});
