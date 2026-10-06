import type { AgentPendingInteractionIdentity } from "./agentPendingInteraction";
import { runningTurn, type AgentThread, type AgentTurnStatus } from "./agentThread";

export type AgentThreadNotificationKind = "completed" | "failed" | "approval" | "input";

export interface AgentThreadNotificationSignal {
  readonly kind: AgentThreadNotificationKind;
  readonly key: string;
}

export type AgentThreadNotificationState =
  | { readonly kind: "quiet" }
  | { readonly kind: "unknown" }
  | { readonly kind: "held"; readonly signal: AgentThreadNotificationSignal }
  | { readonly kind: "signal"; readonly signal: AgentThreadNotificationSignal };

export type AgentThreadNotificationMissingPolicy = "forget" | "retain";

export type AgentThreadSessionWork = "idle" | "live";

export interface AgentThreadNotificationSubject {
  readonly threadId: string;
  readonly ownerKey: string;
  readonly whenMissing: AgentThreadNotificationMissingPolicy;
  readonly title: string;
  readonly projectLabel: string;
  readonly state: AgentThreadNotificationState;
}

export interface AgentThreadNotificationEvent {
  readonly threadId: string;
  readonly ownerKey: string;
  readonly title: string;
  readonly projectLabel: string;
  readonly kind: AgentThreadNotificationKind;
  readonly signalKey: string;
  readonly key: string;
}

export interface AgentThreadNotificationObservation {
  readonly ownerKey: string;
  readonly signalKey: string | null | undefined;
  readonly whenMissing: AgentThreadNotificationMissingPolicy;
}

export type AgentThreadNotificationBaseline = ReadonlyMap<
  string,
  AgentThreadNotificationObservation
>;

export interface AgentThreadNotificationDetection {
  readonly baseline: AgentThreadNotificationBaseline;
  readonly events: ReadonlyArray<AgentThreadNotificationEvent>;
}

export const MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS = 1_024;

const QUIET: AgentThreadNotificationState = Object.freeze({ kind: "quiet" });
const UNKNOWN: AgentThreadNotificationState = Object.freeze({ kind: "unknown" });
const KEY_SEPARATOR = "\u0001";

export function agentThreadNotificationState(
  thread: AgentThread,
  interaction: AgentPendingInteractionIdentity | null | undefined,
  sessionWork: AgentThreadSessionWork,
): AgentThreadNotificationState {
  if (thread.archived) return QUIET;
  const running = runningTurn(thread);
  if (running !== null) {
    if (interaction === undefined) return UNKNOWN;
    if (interaction === null) return QUIET;
    return signal(interaction.kind, `${interaction.kind}:${interaction.id}`);
  }
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return QUIET;
  const kind = settledTurnKind(last.status);
  if (kind === null) return QUIET;
  const settled: AgentThreadNotificationSignal = { kind, key: `${last.turnId}:${kind}` };
  if (kind === "completed" && sessionWork === "live") return { kind: "held", signal: settled };
  return { kind: "signal", signal: settled };
}

export function detectAgentThreadNotifications(
  previous: AgentThreadNotificationBaseline,
  subjects: ReadonlyArray<AgentThreadNotificationSubject>,
): AgentThreadNotificationDetection {
  const baseline = new Map<string, AgentThreadNotificationObservation>();
  const events: AgentThreadNotificationEvent[] = [];
  for (const subject of subjects.slice(0, MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS)) {
    const prior = previous.get(subject.threadId);
    const sameOwner = prior !== undefined && prior.ownerKey === subject.ownerKey;
    const state = subject.state;
    const signalKey = observedSignalKey(state, sameOwner ? prior.signalKey : undefined);
    baseline.set(subject.threadId, {
      ownerKey: subject.ownerKey,
      signalKey,
      whenMissing: subject.whenMissing,
    });
    if (!sameOwner || state.kind !== "signal") continue;
    if (prior.signalKey === state.signal.key) continue;
    events.push({
      threadId: subject.threadId,
      ownerKey: subject.ownerKey,
      title: subject.title,
      projectLabel: subject.projectLabel,
      kind: state.signal.kind,
      signalKey: state.signal.key,
      key: [subject.threadId, subject.ownerKey, state.signal.key].join(KEY_SEPARATOR),
    });
  }
  for (const [threadId, observation] of previous) {
    if (baseline.size >= MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS) break;
    if (observation.whenMissing !== "retain" || baseline.has(threadId)) continue;
    baseline.set(threadId, observation);
  }
  return { baseline, events };
}

export function agentThreadNotificationStillCurrent(
  baseline: AgentThreadNotificationBaseline,
  event: AgentThreadNotificationEvent,
): boolean {
  const current = baseline.get(event.threadId);
  if (current?.ownerKey !== event.ownerKey) return false;
  if (event.kind === "approval" || event.kind === "input") {
    return current.signalKey === event.signalKey;
  }
  return true;
}

function observedSignalKey(
  state: AgentThreadNotificationState,
  prior: string | null | undefined,
): string | null | undefined {
  switch (state.kind) {
    case "quiet":
      return null;
    case "unknown":
      return prior;
    case "held":
      return prior === state.signal.key ? prior : null;
    case "signal":
      return state.signal.key;
    default:
      return unsupportedState(state);
  }
}

function signal(kind: AgentThreadNotificationKind, key: string): AgentThreadNotificationState {
  return { kind: "signal", signal: { kind, key } };
}

function settledTurnKind(status: AgentTurnStatus): "completed" | "failed" | null {
  switch (status.kind) {
    case "exited":
      return status.exitCode === 0 ? "completed" : "failed";
    case "failed":
      return "failed";
    case "interrupted":
    case "stopped":
    case "pending":
    case "running":
      return null;
    default:
      return unsupportedTurnStatus(status);
  }
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported notification state: ${JSON.stringify(state)}`);
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}`);
}
