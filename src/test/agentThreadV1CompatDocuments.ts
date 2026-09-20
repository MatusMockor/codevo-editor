import lifecycleWire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { agentRootOwnerId } from "../domain/agentProject";
import {
  parseAgentSubagentLifecycle,
  retainAgentSubagentLifecycle,
} from "../domain/agentSubagentLifecycle";
import {
  mergeTurnEvents,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStatus,
} from "../domain/agentThread";
import { serializeAgentThread } from "../domain/agentThreadWire";
import {
  hostileAgentTurnStream,
  longRunningAgentTurnStream,
  nestedSpawnAgentTurnStream,
  realisticAgentTurnStream,
} from "./agentTurnEventStreams";

export const AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT = "c33d0d03";
export const AGENT_THREAD_V1_COMPAT_ROOT_KEY = "/workspace/app";
export const AGENT_THREAD_V1_COMPAT_FIXTURE_PATH =
  "contracts/agent-thread-v1-compat-documents.json";

export interface AgentThreadV1CompatSubject {
  readonly name: string;
  readonly thread: AgentThread;
}

export interface AgentThreadV1CompatDocument {
  readonly name: string;
  readonly thread: Record<string, unknown>;
}

export interface AgentThreadV1CompatFixture {
  readonly shippedCommit: string;
  readonly rootKey: string;
  readonly documents: ReadonlyArray<AgentThreadV1CompatDocument>;
}

const EXITED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const MANY_TURNS = 64;
const TRUNCATED_STREAM_EVENTS = 1_400;

function turnId(thread: number, position: number): string {
  return `agt-${thread}-${String(position).padStart(4, "0")}`;
}

function streamedTurn(
  id: string,
  stream: ReadonlyArray<AgentTurnEvent>,
  status: AgentTurnStatus,
): AgentTurn {
  const merged = mergeTurnEvents([], stream);
  const lifecycle = retainAgentSubagentLifecycle(undefined, stream);
  return {
    turnId: id,
    prompt: `Work through ${id}`,
    status,
    startedAtEpochMs: 10,
    endedAtEpochMs: status.kind === "running" ? null : 20,
    events: merged.events,
    eventsTruncated: merged.truncated,
    lastStatusSequence: 2,
    lastOutputSequence: stream.length,
    ...(lifecycle === undefined ? {} : { subagentLifecycle: lifecycle }),
    launch: null,
    cliVersion: null,
  };
}

function threadOf(position: number, turns: ReadonlyArray<AgentTurn>): AgentThread {
  return {
    threadId: `agt-${position}-0a1b`,
    owner: {
      rootKey: AGENT_THREAD_V1_COMPAT_ROOT_KEY,
      ownerId: agentRootOwnerId(AGENT_THREAD_V1_COMPAT_ROOT_KEY),
      repositoryRoot: AGENT_THREAD_V1_COMPAT_ROOT_KEY,
    },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: `Compat thread ${position}`,
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20 + position,
    turns,
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}

function retainedFixtureTurn(id: string): AgentTurn {
  const lifecycle = parseAgentSubagentLifecycle(lifecycleWire.valid.retained);
  return {
    ...streamedTurn(id, [{ kind: "assistantText", text: "spawned" }], EXITED),
    ...(lifecycle === undefined ? {} : { subagentLifecycle: lifecycle }),
  };
}

function incoherentLifecycleTurn(id: string): AgentTurn {
  return {
    ...streamedTurn(id, [{ kind: "assistantText", text: "done" }], EXITED),
    subagentLifecycle: {
      entries: [
        { id: "tool:t", toolId: "t", name: "Explore", description: "scout", state: "completed" },
      ],
      truncated: false,
    },
  };
}

function manyTurns(thread: number): ReadonlyArray<AgentTurn> {
  return Array.from({ length: MANY_TURNS }, (_unused, position) =>
    streamedTurn(turnId(thread, position), nestedSpawnAgentTurnStream(100 + position, 12), EXITED),
  );
}

export function agentThreadV1CompatSubjects(): ReadonlyArray<AgentThreadV1CompatSubject> {
  return [
    {
      name: "realistic subagents",
      thread: threadOf(1, [streamedTurn(turnId(1, 0), realisticAgentTurnStream(3, 90), EXITED)]),
    },
    {
      name: "hostile background tasks",
      thread: threadOf(2, [streamedTurn(turnId(2, 0), hostileAgentTurnStream(5, 90), EXITED)]),
    },
    {
      name: "long running progress",
      thread: threadOf(3, [streamedTurn(turnId(3, 0), longRunningAgentTurnStream(4, 90), EXITED)]),
    },
    {
      name: "nested spawns",
      thread: threadOf(4, [
        streamedTurn(turnId(4, 0), nestedSpawnAgentTurnStream(11, 140), EXITED),
        streamedTurn(turnId(4, 1), nestedSpawnAgentTurnStream(12, 140), { kind: "interrupted" }),
      ]),
    },
    {
      name: "running turn with an open spawn batch",
      thread: threadOf(5, [
        streamedTurn(turnId(5, 0), nestedSpawnAgentTurnStream(21, 60), EXITED),
        streamedTurn(
          turnId(5, 1),
          [
            ...nestedSpawnAgentTurnStream(22, 40),
            {
              kind: "toolCall",
              toolId: "toolu_open_batch",
              name: "Agent",
              inputSummary: "open",
              description: "Open batch",
            },
          ],
          { kind: "running" },
        ),
      ]),
    },
    {
      name: "retained wire fixture and an incoherent lifecycle",
      thread: threadOf(6, [
        retainedFixtureTurn(turnId(6, 0)),
        incoherentLifecycleTurn(turnId(6, 1)),
      ]),
    },
    { name: "sixty four turns", thread: threadOf(7, manyTurns(7)) },
    {
      name: "truncated turn",
      thread: threadOf(8, [
        streamedTurn(turnId(8, 0), nestedSpawnAgentTurnStream(31, TRUNCATED_STREAM_EVENTS), EXITED),
      ]),
    },
  ];
}

export function agentThreadV1CompatFixture(): AgentThreadV1CompatFixture {
  return {
    shippedCommit: AGENT_THREAD_V1_COMPAT_SHIPPED_COMMIT,
    rootKey: AGENT_THREAD_V1_COMPAT_ROOT_KEY,
    documents: agentThreadV1CompatSubjects().map(({ name, thread }) => ({
      name,
      thread: JSON.parse(JSON.stringify(serializeAgentThread(thread))) as Record<string, unknown>,
    })),
  };
}

export function encodeAgentThreadV1CompatFixture(fixture: AgentThreadV1CompatFixture): string {
  const documents = fixture.documents.map((document) => `    ${JSON.stringify(document)}`);
  return [
    "{",
    `  "shippedCommit": ${JSON.stringify(fixture.shippedCommit)},`,
    `  "rootKey": ${JSON.stringify(fixture.rootKey)},`,
    '  "documents": [',
    documents.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}
