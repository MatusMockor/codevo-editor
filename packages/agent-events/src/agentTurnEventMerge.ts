import type { AgentTurnEvent } from "./agentTurnEvent.js";
import type { AgentAttachment } from "./agentAttachment.js";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_SUBAGENT_THREADS_PER_TURN,
} from "./agentTurnEventLimits.js";
import {
  capAgentTurnEvents,
  retainAgentTurnEvents,
  type AgentTurnEventRetentionPolicy,
} from "./agentTurnEventRetention.js";

const UTF8_ENCODER = new TextEncoder();
const UTF16_HIGH_SURROGATE_START = 0xd800;
const UTF16_HIGH_SURROGATE_END = 0xdbff;
const UTF16_LOW_SURROGATE_START = 0xdc00;
const UTF16_LOW_SURROGATE_END = 0xdfff;
const agentTextByteState = new WeakMap<AgentTurnEvent, AgentTextByteState>();
const agentEventByteState = new WeakMap<AgentTurnEvent, AgentEventByteState>();

interface AgentTextByteState {
  readonly byteLength: number;
  readonly text: string;
  readonly trailingHighSurrogate: boolean;
}

interface AgentEventByteState {
  readonly byteLength: number;
  readonly values: ReadonlyArray<string>;
}

/** Retain a bounded recent window while continuing to accept live output after eviction. */
export function mergeTurnEvents(
  existing: ReadonlyArray<AgentTurnEvent>,
  incoming: ReadonlyArray<AgentTurnEvent>,
): { readonly events: ReadonlyArray<AgentTurnEvent>; readonly truncated: boolean } {
  return retainAgentTurnEvents(existing, incoming, turnEventRetentionPolicy());
}

export function capPersistedTurnEvents(events: ReadonlyArray<AgentTurnEvent>): {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly truncated: boolean;
} {
  return capAgentTurnEvents(events, turnEventRetentionPolicy());
}

function turnEventRetentionPolicy(): AgentTurnEventRetentionPolicy {
  return {
    maxEvents: MAX_AGENT_EVENTS_PER_TURN,
    maxBytes: MAX_AGENT_EVENT_BYTES_PER_TURN,
    maxSubagentThreads: MAX_SUBAGENT_THREADS_PER_TURN,
    eventBytes: agentTurnEventUtf8Bytes,
    coalesceText: coalesceAgentTextEvents,
  };
}

export function agentTurnEventUtf8Bytes(event: AgentTurnEvent): number {
  if (event.kind === "assistantText" || event.kind === "reasoning" || event.kind === "result") {
    return (
      agentTextEventByteState(event).byteLength +
      ((event.kind === "assistantText" || event.kind === "reasoning") &&
      event.parentToolId !== undefined
        ? UTF8_ENCODER.encode(event.parentToolId).byteLength
        : 0)
    );
  }
  const values = agentTurnEventStrings(event);
  const cached = agentEventByteState.get(event);
  if (cached !== undefined && sameStrings(cached.values, values)) return cached.byteLength;
  const byteLength = values.reduce(
    (total, value) => total + UTF8_ENCODER.encode(value).byteLength,
    0,
  );
  agentEventByteState.set(event, { byteLength, values });
  return byteLength;
}

function agentTurnEventStrings(event: AgentTurnEvent): ReadonlyArray<string> {
  switch (event.kind) {
    case "subagentActivity":
      return [event.agentThreadId, event.agentPath, event.activity];
    case "subagentEvent":
      return [event.agentThreadId, ...agentTurnEventStrings(event.event)];
    case "subagentUsage":
    case "subagentTurnDone":
      return [event.agentThreadId];
    case "subagentSpawn":
      return [
        event.callId,
        event.status,
        event.taskTitle ?? "",
        event.model ?? "",
        event.reasoningEffort ?? "",
        ...event.agentThreadIds,
      ];
    case "queued":
      return [event.threadId, event.clientUserMessageId ?? ""];
    case "toolCall":
      return definedStrings([
        event.toolId,
        event.name,
        event.inputSummary,
        event.description,
        event.parentToolId,
      ]);
    case "toolResult":
      return definedStrings([event.toolId, event.outputSummary, event.parentToolId]);
    case "backgroundTask":
      return definedStrings([event.taskId, event.taskType, event.description]);
    case "subagent":
      return definedStrings([
        event.toolId,
        event.taskId,
        event.subagentType,
        event.description,
        event.lastToolName,
      ]);
    case "error":
      return [event.message];
    case "unknownLine":
      return [event.raw];
    case "userMessage":
      return [event.text, ...(event.attachments ?? []).flatMap(agentAttachmentStrings)];
    case "contextUsage":
      return [event.model];
    case "contextCompactionStatus":
      return event.message === null ? [] : [event.message];
    case "contextCompaction":
      return [];
    case "assistantText":
    case "reasoning":
      return definedStrings([event.text, event.parentToolId]);
    case "result":
      return [event.text];
    default:
      return unsupportedTurnEvent(event);
  }
}

function agentAttachmentStrings(attachment: AgentAttachment): ReadonlyArray<string> {
  switch (attachment.kind) {
    case "image":
    case "file":
      return definedStrings([attachment.name, attachment.storedPath]);
    case "reference":
      return definedStrings([attachment.name, attachment.path]);
    default:
      return unsupportedAttachment(attachment);
  }
}

function definedStrings(values: ReadonlyArray<string | undefined>): ReadonlyArray<string> {
  return values.filter((value): value is string => value !== undefined);
}

function sameStrings(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function coalesceAgentTextEvents(
  last: AgentTurnEvent | undefined,
  next: AgentTurnEvent,
): AgentTurnEvent | null {
  if (last === undefined) return null;
  if (last.kind === "subagentEvent" && next.kind === "subagentEvent") {
    if (last.agentThreadId !== next.agentThreadId) return null;
    const event = coalesceAgentTextEvents(last.event, next.event);
    return event !== null && (event.kind === "assistantText" || event.kind === "reasoning")
      ? { kind: "subagentEvent", agentThreadId: next.agentThreadId, event }
      : null;
  }
  if (next.kind !== "assistantText" && next.kind !== "reasoning") return null;
  if (last.kind !== next.kind) return null;
  if (
    (last.kind === "assistantText" || last.kind === "reasoning") &&
    (next.kind === "assistantText" || next.kind === "reasoning") &&
    last.parentToolId !== next.parentToolId
  )
    return null;
  const lastState = agentTextEventByteState(last);
  const nextState = agentTextEventByteState(next);
  const repairsSplitScalar = lastState.trailingHighSurrogate && startsWithLowSurrogate(next.text);
  const byteLength = lastState.byteLength + nextState.byteLength - (repairsSplitScalar ? 2 : 0);
  if (byteLength > MAX_AGENT_EVENT_TEXT_BYTES) return null;
  const coalesced: AgentTurnEvent = { ...next, text: last.text + next.text };
  agentTextByteState.set(coalesced, {
    byteLength,
    text: coalesced.text,
    trailingHighSurrogate:
      next.text.length === 0 ? lastState.trailingHighSurrogate : endsWithHighSurrogate(next.text),
  });
  return coalesced;
}

function agentTextEventByteState(event: Extract<AgentTurnEvent, { readonly text: string }>) {
  const cached = agentTextByteState.get(event);
  if (cached?.text === event.text) return cached;
  const state = {
    byteLength: UTF8_ENCODER.encode(event.text).byteLength,
    text: event.text,
    trailingHighSurrogate: endsWithHighSurrogate(event.text),
  };
  agentTextByteState.set(event, state);
  return state;
}

function startsWithLowSurrogate(text: string): boolean {
  if (text.length === 0) return false;
  const codeUnit = text.charCodeAt(0);
  return codeUnit >= UTF16_LOW_SURROGATE_START && codeUnit <= UTF16_LOW_SURROGATE_END;
}

function endsWithHighSurrogate(text: string): boolean {
  if (text.length === 0) return false;
  const codeUnit = text.charCodeAt(text.length - 1);
  return codeUnit >= UTF16_HIGH_SURROGATE_START && codeUnit <= UTF16_HIGH_SURROGATE_END;
}

function unsupportedAttachment(attachment: never): never {
  throw new TypeError(`Unsupported agent attachment: ${JSON.stringify(attachment)}.`);
}

function unsupportedTurnEvent(event: never): never {
  throw new TypeError(`Unsupported agent turn event: ${JSON.stringify(event)}.`);
}
