export const AGENT_TURN_HALT_SOURCES = [
  "composerStopButton",
  "composerEscape",
  "stopConfirmationBanner",
  "sessionDock",
  "threadMenu",
] as const;

export type AgentTurnHaltSource = (typeof AGENT_TURN_HALT_SOURCES)[number];

export const AGENT_TURN_HALT_ESCALATION_SOURCES = [
  ...AGENT_TURN_HALT_SOURCES,
  "interruptRefused",
] as const;

export type AgentTurnHaltEscalationSource = (typeof AGENT_TURN_HALT_ESCALATION_SOURCES)[number];

export const AGENT_TURN_HALT_MODES = ["softInterrupt", "hardStop"] as const;

export type AgentTurnHaltMode = (typeof AGENT_TURN_HALT_MODES)[number];

export type AgentTurnHaltTrigger =
  | { readonly kind: "ui"; readonly source: AgentTurnHaltSource }
  | { readonly kind: "interruptRefused"; readonly source: AgentTurnHaltSource };

export interface AgentTurnHaltEscalation {
  readonly source: AgentTurnHaltEscalationSource;
  readonly requestedAtEpochMs: number;
}

export interface AgentTurnHaltRecord {
  readonly source: AgentTurnHaltSource;
  readonly mode: AgentTurnHaltMode;
  readonly requestedAtEpochMs: number;
  readonly escalation?: AgentTurnHaltEscalation;
}

export interface AgentTurnHaltAttempt {
  readonly trigger: AgentTurnHaltTrigger;
  readonly mode: AgentTurnHaltMode;
  readonly requestedAtEpochMs: number;
}

export interface AgentTurnHaltSubject {
  readonly turnId: string;
  readonly haltRequest?: AgentTurnHaltRecord;
}

export function agentTurnUiHalt(source: AgentTurnHaltSource): AgentTurnHaltTrigger {
  return { kind: "ui", source };
}

export function recordAgentTurnHalt(
  current: AgentTurnHaltRecord | undefined,
  attempt: AgentTurnHaltAttempt,
): AgentTurnHaltRecord | undefined {
  if (!isEpochMs(attempt.requestedAtEpochMs)) return current;
  if (current === undefined) {
    return {
      source: attempt.trigger.source,
      mode: attempt.mode,
      requestedAtEpochMs: attempt.requestedAtEpochMs,
    };
  }
  if (current.escalation !== undefined) return current;
  if (current.mode !== "softInterrupt" || attempt.mode !== "hardStop") return current;
  return {
    ...current,
    escalation: {
      source: escalationSourceOf(attempt.trigger),
      requestedAtEpochMs: Math.max(attempt.requestedAtEpochMs, current.requestedAtEpochMs),
    },
  };
}

export function parseAgentTurnHaltRecord(value: unknown): AgentTurnHaltRecord | null {
  const fields = closedRecord(value, ["source", "mode", "requestedAtEpochMs"], ["escalation"]);
  if (fields === null) return null;
  const { source, mode, requestedAtEpochMs } = fields;
  if (!isHaltSource(source) || !isHaltMode(mode) || !isEpochMs(requestedAtEpochMs)) return null;
  const record: AgentTurnHaltRecord = { source, mode, requestedAtEpochMs };
  if (fields.escalation === undefined) return record;
  const escalation = parseEscalation(fields.escalation);
  if (escalation === null) return record;
  if (mode !== "softInterrupt" || escalation.requestedAtEpochMs < requestedAtEpochMs) return record;
  return { ...record, escalation };
}

export function serializeAgentTurnHaltRequests(
  turns: ReadonlyArray<AgentTurnHaltSubject>,
): ReadonlyArray<Record<string, unknown>> {
  const requests: Record<string, unknown>[] = [];
  for (const turn of turns) {
    const record = turn.haltRequest;
    if (record === undefined) continue;
    requests.push({
      turnId: turn.turnId,
      source: record.source,
      mode: record.mode,
      requestedAtEpochMs: record.requestedAtEpochMs,
      ...(record.escalation === undefined
        ? {}
        : {
            escalation: {
              source: record.escalation.source,
              requestedAtEpochMs: record.escalation.requestedAtEpochMs,
            },
          }),
    });
  }
  return requests;
}

export function attachAgentTurnHaltRequests<Turn extends AgentTurnHaltSubject>(
  turns: ReadonlyArray<Turn>,
  requests: unknown,
): ReadonlyArray<Turn> {
  if (!Array.isArray(requests) || requests.length > turns.length) {
    throw new TypeError("Invalid agent turn halt requests.");
  }
  const records = new Map<string, AgentTurnHaltRecord>();
  for (const request of requests) {
    const identified = identifiedRecord(request);
    if (identified === null || records.has(identified.turnId)) continue;
    records.set(identified.turnId, identified.record);
  }
  if (records.size === 0) return turns;
  return turns.map((turn) => {
    const record = records.get(turn.turnId);
    return record === undefined ? turn : { ...turn, haltRequest: record };
  });
}

function identifiedRecord(
  value: unknown,
): { readonly turnId: string; readonly record: AgentTurnHaltRecord } | null {
  if (!isPlainRecord(value)) return null;
  const { turnId, ...rest } = value;
  if (typeof turnId !== "string") return null;
  const record = parseAgentTurnHaltRecord(rest);
  return record === null ? null : { turnId, record };
}

function parseEscalation(value: unknown): AgentTurnHaltEscalation | null {
  const fields = closedRecord(value, ["source", "requestedAtEpochMs"], []);
  if (fields === null) return null;
  const { source, requestedAtEpochMs } = fields;
  if (!isEscalationSource(source) || !isEpochMs(requestedAtEpochMs)) return null;
  return { source, requestedAtEpochMs };
}

function escalationSourceOf(trigger: AgentTurnHaltTrigger): AgentTurnHaltEscalationSource {
  switch (trigger.kind) {
    case "ui":
      return trigger.source;
    case "interruptRefused":
      return "interruptRefused";
    default:
      return unsupportedTrigger(trigger);
  }
}

function unsupportedTrigger(trigger: never): never {
  throw new Error(`Unsupported halt trigger: ${JSON.stringify(trigger)}`);
}

function closedRecord(
  value: unknown,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string>,
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key))) return null;
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) return null;
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHaltSource(value: unknown): value is AgentTurnHaltSource {
  return (AGENT_TURN_HALT_SOURCES as ReadonlyArray<unknown>).includes(value);
}

function isEscalationSource(value: unknown): value is AgentTurnHaltEscalationSource {
  return (AGENT_TURN_HALT_ESCALATION_SOURCES as ReadonlyArray<unknown>).includes(value);
}

function isHaltMode(value: unknown): value is AgentTurnHaltMode {
  return (AGENT_TURN_HALT_MODES as ReadonlyArray<unknown>).includes(value);
}
