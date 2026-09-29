import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
} from "./agentOutput/agentOutputParser";
import { retainAgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { mergeTurnEvents, type AgentTurn, type AgentTurnEvent } from "./agentThread";
import { agentBackgroundTurnLabel, type AgentBackgroundTurnCause } from "./agentTurnOrigin";

export const MAX_AGENT_BACKGROUND_TURN_PREVIEW_CHARS = 160;

const PREVIEW_SCAN_CHARS = 4_096;
const PREVIEW_ELLIPSIS = "…";
const RESULT_LINE_HINT = '"result"';
const TASK_NOTIFICATION_ORIGIN = "task-notification";
const UTF8_ENCODER = new TextEncoder();

export interface AgentBackgroundTurnOutput {
  readonly output: string;
  readonly truncated: boolean;
  readonly complete: boolean;
}

export interface AgentBackgroundTurnContent {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly eventsTruncated: boolean;
  readonly receivedUtf8Bytes: number;
  readonly ended: boolean;
  readonly complete: boolean;
  readonly cause: AgentBackgroundTurnCause;
}

export function parseAgentBackgroundTurn(
  source: AgentBackgroundTurnOutput,
): AgentBackgroundTurnContent {
  const initial = createAgentOutputParserState("claudeCode");
  const fed = feedAgentOutput(initial, "stdout", source.output);
  const finished = finishAgentOutput(fed.state);
  const merged = mergeTurnEvents([], [...fed.events, ...finished.events]);
  const complete = source.complete && !source.truncated;
  return {
    events: merged.events,
    eventsTruncated: merged.truncated || !complete,
    receivedUtf8Bytes: UTF8_ENCODER.encode(source.output).byteLength,
    ended: source.complete,
    complete,
    cause: backgroundTurnCause(source.output),
  };
}

export function agentBackgroundTurn(
  turnId: string,
  content: AgentBackgroundTurnContent,
  nowEpochMs: number,
): AgentTurn {
  const subagentLifecycle = retainAgentSubagentLifecycle(undefined, content.events);
  return {
    turnId,
    origin: "background",
    prompt: agentBackgroundTurnLabel(content.cause),
    status: content.ended ? { kind: "exited", exitCode: 0 } : { kind: "interrupted" },
    startedAtEpochMs: nowEpochMs,
    endedAtEpochMs: nowEpochMs,
    events: content.events,
    eventsTruncated: content.eventsTruncated,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    streamMetrics: { receivedUtf8Bytes: content.receivedUtf8Bytes, complete: content.complete },
    ...(subagentLifecycle === undefined ? {} : { subagentLifecycle }),
    launch: null,
    cliVersion: null,
  };
}

export function agentBackgroundTurnPreview(events: ReadonlyArray<AgentTurnEvent>): string | null {
  const text = finalReplyText(events);
  if (text === null) return null;
  const collapsed = text.slice(0, PREVIEW_SCAN_CHARS).replace(/\s+/gu, " ").trim();
  if (collapsed === "") return null;
  const characters = Array.from(collapsed);
  if (characters.length <= MAX_AGENT_BACKGROUND_TURN_PREVIEW_CHARS) return collapsed;
  const head = characters.slice(0, MAX_AGENT_BACKGROUND_TURN_PREVIEW_CHARS - 1).join("");
  return `${head.trimEnd()}${PREVIEW_ELLIPSIS}`;
}

function backgroundTurnCause(output: string): AgentBackgroundTurnCause {
  const lines = output.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes(RESULT_LINE_HINT)) continue;
    const result = rootResultOrigin(line);
    if (result === undefined) continue;
    return result === TASK_NOTIFICATION_ORIGIN ? "taskNotification" : "unprompted";
  }
  return "unprompted";
}

function rootResultOrigin(line: string): string | null | undefined {
  const value = parsedObject(line);
  if (value === null || value.type !== "result") return undefined;
  if (value.parent_tool_use_id !== undefined && value.parent_tool_use_id !== null) return undefined;
  const origin = value.origin;
  if (typeof origin !== "object" || origin === null) return null;
  const kind = (origin as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

function parsedObject(line: string): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function finalReplyText(events: ReadonlyArray<AgentTurnEvent>): string | null {
  let assistant: string | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === "result" && event.text.trim() !== "") return event.text;
    if (assistant !== null) continue;
    if (event.kind !== "assistantText" || event.parentToolId !== undefined) continue;
    if (event.text.trim() === "") continue;
    assistant = event.text;
  }
  return assistant;
}
