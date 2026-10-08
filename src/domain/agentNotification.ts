import type { AgentPendingInteractionIdentity } from "./agentPendingInteraction";
import { runningTurn, type AgentThread, type AgentTurn, type AgentTurnStatus } from "./agentThread";
import { isAgentBackgroundTurn } from "./agentTurnOrigin";

export type AgentThreadNotificationKind = "completed" | "failed" | "approval" | "input";

export interface AgentThreadNotificationSignal {
  readonly kind: AgentThreadNotificationKind;
  readonly key: string;
}

export type AgentThreadNotificationState =
  | { readonly kind: "quiet" }
  | { readonly kind: "unknown" }
  | { readonly kind: "held"; readonly signal: AgentThreadNotificationSignal }
  | { readonly kind: "withheld" }
  | { readonly kind: "released" }
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
  readonly heldCompletion: AgentThreadNotificationSignal | null;
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

export type AgentThreadRecoveryWatches = ReadonlyMap<string, string>;

export const MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS = 1_024;
export const MAX_AGENT_THREAD_RECOVERY_WATCHES = 64;
export const NO_AGENT_THREAD_RECOVERY_WATCHES: AgentThreadRecoveryWatches = new Map();

const QUIET: AgentThreadNotificationState = Object.freeze({ kind: "quiet" });
const UNKNOWN: AgentThreadNotificationState = Object.freeze({ kind: "unknown" });
const WITHHELD: AgentThreadNotificationState = Object.freeze({ kind: "withheld" });
const RELEASED: AgentThreadNotificationState = Object.freeze({ kind: "released" });
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
  if (kind === null) return cutOffReplyState(last, sessionWork);
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
    const known = previous.get(subject.threadId);
    const prior = known?.ownerKey === subject.ownerKey ? known : undefined;
    const due = dueSignal(subject.state, prior);
    baseline.set(subject.threadId, {
      ownerKey: subject.ownerKey,
      signalKey: due?.key ?? observedSignalKey(subject.state, prior?.signalKey),
      heldCompletion: heldCompletion(subject.state, prior),
      whenMissing: subject.whenMissing,
    });
    if (due === null) continue;
    events.push({
      threadId: subject.threadId,
      ownerKey: subject.ownerKey,
      title: subject.title,
      projectLabel: subject.projectLabel,
      kind: due.kind,
      signalKey: due.key,
      key: [subject.threadId, subject.ownerKey, due.key].join(KEY_SEPARATOR),
    });
  }
  for (const [threadId, observation] of previous) {
    if (baseline.size >= MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS) break;
    if (observation.whenMissing !== "retain" || baseline.has(threadId)) continue;
    baseline.set(threadId, observation);
  }
  return { baseline, events };
}

export function watchAgentThreadsBeforeRecovery(
  previous: AgentThreadRecoveryWatches,
  subjects: ReadonlyArray<AgentThreadNotificationSubject>,
  runningThreadIds: ReadonlySet<string>,
): AgentThreadRecoveryWatches {
  const watches = new Map<string, string>();
  for (const subject of subjects) {
    if (previous.get(subject.threadId) !== subject.ownerKey) continue;
    watches.set(subject.threadId, subject.ownerKey);
  }
  for (const subject of subjects) {
    if (watches.size >= MAX_AGENT_THREAD_RECOVERY_WATCHES) break;
    if (!runningThreadIds.has(subject.threadId)) continue;
    watches.set(subject.threadId, subject.ownerKey);
  }
  return watches;
}

export function agentThreadNotificationSubjectsBeforeRecovery(
  subjects: ReadonlyArray<AgentThreadNotificationSubject>,
  watches: AgentThreadRecoveryWatches,
): ReadonlyArray<AgentThreadNotificationSubject> {
  return subjects.flatMap((subject) => {
    if (!reportsSettledTurn(subject.state)) return [subject];
    if (watches.get(subject.threadId) !== subject.ownerKey) return [];
    return [{ ...subject, state: UNKNOWN }];
  });
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

function reportsSettledTurn(state: AgentThreadNotificationState): boolean {
  switch (state.kind) {
    case "quiet":
    case "unknown":
      return false;
    case "held":
    case "withheld":
    case "released":
      return true;
    case "signal":
      return state.signal.kind === "completed" || state.signal.kind === "failed";
    default:
      return unsupportedState(state);
  }
}

function dueSignal(
  state: AgentThreadNotificationState,
  prior: AgentThreadNotificationObservation | undefined,
): AgentThreadNotificationSignal | null {
  if (prior === undefined) return null;
  switch (state.kind) {
    case "quiet":
    case "unknown":
    case "held":
    case "withheld":
      return null;
    case "released":
      return prior.heldCompletion;
    case "signal":
      return prior.signalKey === state.signal.key ? null : state.signal;
    default:
      return unsupportedState(state);
  }
}

function heldCompletion(
  state: AgentThreadNotificationState,
  prior: AgentThreadNotificationObservation | undefined,
): AgentThreadNotificationSignal | null {
  switch (state.kind) {
    case "quiet":
    case "released":
    case "signal":
      return null;
    case "unknown":
    case "withheld":
      return prior?.heldCompletion ?? null;
    case "held":
      return prior?.signalKey === state.signal.key ? null : state.signal;
    default:
      return unsupportedState(state);
  }
}

function observedSignalKey(
  state: AgentThreadNotificationState,
  prior: string | null | undefined,
): string | null | undefined {
  switch (state.kind) {
    case "quiet":
    case "released":
      return null;
    case "unknown":
    case "withheld":
      return prior;
    case "held":
      return prior === state.signal.key ? prior : null;
    case "signal":
      return state.signal.key;
    default:
      return unsupportedState(state);
  }
}

function cutOffReplyState(
  last: AgentTurn,
  sessionWork: AgentThreadSessionWork,
): AgentThreadNotificationState {
  if (last.status.kind !== "interrupted" || !isAgentBackgroundTurn(last)) return QUIET;
  if (sessionWork === "live") return WITHHELD;
  return RELEASED;
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
