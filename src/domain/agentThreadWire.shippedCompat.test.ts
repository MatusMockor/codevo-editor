import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_THREAD_V1_COMPAT_FIXTURE_PATH,
  AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT,
  agentThreadV1CompatFixture,
  agentThreadV1CompatSubjects,
  encodeAgentThreadV1CompatFixture,
} from "../test/agentThreadV1CompatDocuments";
import { agentSubagentLifecycleHasRetainedDetail } from "./agentSubagentLifecycleLegacy";
import type { AgentThread } from "./agentThread";
import { parseAgentThread } from "./agentThreadWire";

type Keys = ReadonlyArray<string>;
type WireRecord = Record<string, unknown>;

const SHIPPED_THREAD_KEYS: Keys = [
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

const SHIPPED_TURN_KEYS: Keys = [
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

const SHIPPED_LIFECYCLE_ENTRY_KEYS: Keys = [
  "agentThreadId",
  "description",
  "durationMs",
  "id",
  "lastToolName",
  "name",
  "resultState",
  "state",
  "steps",
  "taskId",
  "telemetryState",
  "toolId",
  "totalTokens",
];

const SHIPPED_EVENT_KEYS: Readonly<Record<string, Keys>> = {
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
};

const REPOSITORY_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/u, "");
const FIXTURE_FILE = join(REPOSITORY_ROOT, AGENT_THREAD_V1_COMPAT_FIXTURE_PATH);
const UPDATE_FIXTURE = process.env.UPDATE_AGENT_THREAD_V1_COMPAT === "1";
const MAX_SHIPPED_EVENTS_PER_TURN = 512;

interface ShippedParser {
  readonly parseAgentThread: (value: unknown) => AgentThread;
}

let scratch: string | null = null;
let shippedParser: ShippedParser | null = null;
let shippedParserFailure: string | null = null;

function keysOf(value: unknown): Keys {
  return Object.keys(value as WireRecord).sort();
}

function expectSubset(actual: Keys, allowed: Keys, label: string): void {
  expect({ label, unknown: actual.filter((key) => !allowed.includes(key)) }).toEqual({
    label,
    unknown: [],
  });
}

function turnsOf(thread: WireRecord): ReadonlyArray<WireRecord> {
  return thread.turns as ReadonlyArray<WireRecord>;
}

function lifecyclesOf(thread: WireRecord): ReadonlyArray<WireRecord> {
  return turnsOf(thread)
    .map((turn) => turn.subagentLifecycle as WireRecord | undefined)
    .filter((lifecycle): lifecycle is WireRecord => lifecycle !== undefined);
}

describe("v1 thread JSON written by this build stays readable for every shipped build", () => {
  beforeAll(async () => {
    try {
      scratch = mkdtempSync(join(tmpdir(), "codevo-agent-thread-compat-"));
      execFileSync(
        "sh",
        [
          "-c",
          `git archive ${AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT} src/domain | tar -x -C "${scratch}"`,
        ],
        { cwd: REPOSITORY_ROOT },
      );
      shippedParser = (await import(
        /* @vite-ignore */ join(scratch, "src/domain/agentThreadWire.ts")
      )) as ShippedParser;
    } catch (error) {
      shippedParserFailure = error instanceof Error ? error.message : String(error);
    }
  });

  afterAll(() => {
    if (scratch === null) return;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("starts from in-memory threads that really carry the retained lifecycle detail", () => {
    const retaining = agentThreadV1CompatSubjects().filter(({ thread }) =>
      thread.turns.some(
        (turn) =>
          turn.subagentLifecycle !== undefined &&
          agentSubagentLifecycleHasRetainedDetail(turn.subagentLifecycle),
      ),
    );
    const nested = agentThreadV1CompatSubjects().filter(({ thread }) =>
      thread.turns.some((turn) =>
        turn.subagentLifecycle?.entries.some((entry) => entry.parentToolId !== undefined),
      ),
    );
    const open = agentThreadV1CompatSubjects().filter(({ thread }) =>
      thread.turns.some((turn) => turn.subagentLifecycle?.openBatchKey !== undefined),
    );

    expect(retaining.length).toBeGreaterThanOrEqual(5);
    expect(nested.length).toBeGreaterThanOrEqual(3);
    expect(open.length).toBeGreaterThanOrEqual(1);
  });

  it("matches the committed documents the Rust guard validates with the shipped structs", () => {
    const encoded = encodeAgentThreadV1CompatFixture(agentThreadV1CompatFixture());
    if (UPDATE_FIXTURE) writeFileSync(FIXTURE_FILE, encoded);

    expect(readFileSync(FIXTURE_FILE, "utf8")).toBe(encoded);
  });

  it("writes only the shipped key sets for the thread, turn, event and lifecycle", () => {
    for (const { name, thread } of agentThreadV1CompatFixture().documents) {
      expectSubset(keysOf(thread), SHIPPED_THREAD_KEYS, name);
      for (const turn of turnsOf(thread)) {
        expectSubset(keysOf(turn), SHIPPED_TURN_KEYS, name);
        const events = turn.events as ReadonlyArray<WireRecord>;
        expect(events.length).toBeLessThanOrEqual(MAX_SHIPPED_EVENTS_PER_TURN);
        for (const event of events) {
          const allowed = SHIPPED_EVENT_KEYS[event.kind as string];
          expect({ name, kind: event.kind, known: allowed !== undefined }).toEqual({
            name,
            kind: event.kind,
            known: true,
          });
          expectSubset(keysOf(event), allowed ?? [], `${name}:${String(event.kind)}`);
        }
      }
      for (const lifecycle of lifecyclesOf(thread)) {
        expect({ name, keys: keysOf(lifecycle) }).toEqual({
          name,
          keys: ["entries", "truncated"],
        });
        for (const entry of lifecycle.entries as ReadonlyArray<WireRecord>) {
          expectSubset(keysOf(entry), SHIPPED_LIFECYCLE_ENTRY_KEYS, name);
        }
      }
    }
  });

  it("marks the lifecycle truncated whenever nested entries were dropped from the JSON", () => {
    const subjects = agentThreadV1CompatSubjects();
    const documents = agentThreadV1CompatFixture().documents;
    let dropped = 0;
    subjects.forEach(({ thread }, position) => {
      thread.turns.forEach((turn, index) => {
        const retained = turn.subagentLifecycle;
        if (retained === undefined) return;
        const nested = retained.entries.filter((entry) => entry.parentToolId !== undefined);
        if (nested.length === 0) return;
        dropped += 1;
        const written = turnsOf(documents[position]!.thread)[index]?.subagentLifecycle as
          WireRecord | undefined;
        expect(written?.truncated).toBe(true);
        expect((written?.entries as ReadonlyArray<unknown>).length).toBe(
          retained.entries.length - nested.length,
        );
      });
    });
    expect(dropped).toBeGreaterThan(0);
  });

  it("writes the state the shipped validator derives instead of an incoherent one", () => {
    const document = agentThreadV1CompatFixture().documents.find(
      (candidate) => candidate.name === "retained wire fixture and an incoherent lifecycle",
    );
    const turns = turnsOf(document!.thread);
    const entries = (turns[1]?.subagentLifecycle as WireRecord)
      .entries as ReadonlyArray<WireRecord>;

    expect(entries.map((entry) => entry.state)).toEqual(["running"]);
  });

  it("stays readable by the current parser", () => {
    for (const { name, thread } of agentThreadV1CompatFixture().documents) {
      expect(() => parseAgentThread(thread), name).not.toThrow();
    }
  });

  it(`stays readable by the parser shipped at ${AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT}`, (context) => {
    if (shippedParser === null) {
      context.skip(
        `the parser at ${AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT} could not be loaded: ${shippedParserFailure ?? "unknown reason"}`,
      );
      return;
    }
    for (const { name, thread } of agentThreadV1CompatFixture().documents) {
      const parsed = shippedParser.parseAgentThread(thread);
      expect({ name, turns: parsed.turns.length }).toEqual({
        name,
        turns: turnsOf(thread).length,
      });
    }
  });

  it("proves the shipped parser refuses the retained shape this build used to write", (context) => {
    if (shippedParser === null) {
      context.skip(
        `the parser at ${AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT} could not be loaded: ${shippedParserFailure ?? "unknown reason"}`,
      );
      return;
    }
    const subject = agentThreadV1CompatSubjects().find(({ name }) => name === "nested spawns");
    const document = agentThreadV1CompatFixture().documents.find(
      ({ name }) => name === "nested spawns",
    );
    const retained = JSON.parse(JSON.stringify(document!.thread)) as WireRecord;
    (turnsOf(retained)[0] as WireRecord).subagentLifecycle = JSON.parse(
      JSON.stringify(subject!.thread.turns[0]?.subagentLifecycle),
    ) as unknown;

    expect(() => shippedParser?.parseAgentThread(retained)).toThrow(/subagent lifecycle metadata/u);
  });
});
