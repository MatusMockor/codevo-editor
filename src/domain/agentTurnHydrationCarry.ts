import {
  MAX_AGENT_STEER_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  type AgentTurnEvent,
} from "./agentThread";
import {
  agentTurnEventSupersession,
  type AgentTurnBarrierTarget,
  type AgentTurnSnapshotTarget,
} from "./agentTurnEventSupersession";

export const MAX_CARRIED_AGENT_TURN_STEERS = 64;
export const MAX_CARRIED_AGENT_TURN_SNAPSHOTS = 64;
const MAX_CARRIED_AGENT_TURN_SNAPSHOT_BYTES = 256 * 1_024;

type AgentTurnSteer = Extract<AgentTurnEvent, { kind: "userMessage" }>;

const IDENTITY_SEPARATOR = "\u0000";

export function planHydratedAgentTurnEvents(
  current: ReadonlyArray<AgentTurnEvent>,
  hydrated: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentTurnEvent> {
  const steers = carriedAgentTurnSteers(current, hydrated);
  const snapshots = carriedAgentTurnSnapshots(current, hydrated);
  if (steers.length === 0 && snapshots.length === 0) return hydrated;
  const closing = lastClosingIndex(hydrated);
  if (closing < 0) return [...steers, ...hydrated, ...snapshots];
  return [...steers, ...hydrated.slice(0, closing), ...snapshots, ...hydrated.slice(closing)];
}

function lastClosingIndex(events: ReadonlyArray<AgentTurnEvent>): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === "result") return index;
  }
  return -1;
}

export function carriedAgentTurnSteers(
  current: ReadonlyArray<AgentTurnEvent>,
  hydrated: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentTurnEvent> {
  const pinned = current.filter(isAgentTurnSteer);
  const represented = hydrated.filter(isAgentTurnSteer);
  let aligned = 0;
  while (
    aligned < pinned.length &&
    aligned < represented.length &&
    sameSteer(pinned[pinned.length - 1 - aligned]!, represented[represented.length - 1 - aligned]!)
  ) {
    aligned += 1;
  }
  const unaligned = represented.slice(0, represented.length - aligned);
  const earlier = pinned
    .slice(0, pinned.length - aligned)
    .filter((steer) => !unaligned.some((candidate) => sameSteer(candidate, steer)));
  const carried: AgentTurnSteer[] = [];
  let bytes = 0;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const steer = earlier[index]!;
    bytes += agentTurnEventUtf8Bytes(steer);
    if (carried.length >= MAX_CARRIED_AGENT_TURN_STEERS) break;
    if (bytes > MAX_AGENT_STEER_BYTES_PER_TURN) break;
    carried.unshift(steer);
  }
  return carried;
}

export function carriedAgentTurnSnapshots(
  current: ReadonlyArray<AgentTurnEvent>,
  hydrated: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentTurnEvent> {
  const covered = coveredSnapshotIdentities(hydrated);
  const carried: AgentTurnEvent[] = [];
  const claimed = new Set<string>();
  let bytes = 0;
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const event = current[index]!;
    const keys = snapshotIdentitiesOf(event);
    if (keys.length === 0) continue;
    if (keys.some((key) => covered.has(key) || claimed.has(key))) continue;
    bytes += agentTurnEventUtf8Bytes(event);
    if (carried.length >= MAX_CARRIED_AGENT_TURN_SNAPSHOTS) break;
    if (bytes > MAX_CARRIED_AGENT_TURN_SNAPSHOT_BYTES) break;
    for (const key of keys) claimed.add(key);
    carried.unshift(event);
  }
  return carried;
}

function snapshotIdentitiesOf(event: AgentTurnEvent): ReadonlyArray<string> {
  const supersession = agentTurnEventSupersession(event);
  if (supersession.kind !== "snapshot") return [];
  return targetIdentities(supersession.target);
}

function coveredSnapshotIdentities(events: ReadonlyArray<AgentTurnEvent>): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const event of events) {
    const supersession = agentTurnEventSupersession(event);
    if (supersession.kind === "snapshot") {
      for (const key of targetIdentities(supersession.target)) covered.add(key);
      continue;
    }
    if (supersession.kind !== "barrier") continue;
    for (const target of supersession.targets) {
      for (const key of targetIdentities(target)) covered.add(key);
    }
  }
  return covered;
}

function targetIdentities(target: AgentTurnBarrierTarget | AgentTurnSnapshotTarget): string[] {
  if (target.reach === "identity")
    return [`${target.scope}${IDENTITY_SEPARATOR}${target.identity}`];
  if (target.reach === "subagentIds") {
    const keys: string[] = [];
    if (target.ids.toolId !== undefined)
      keys.push(`subagentTool${IDENTITY_SEPARATOR}${target.ids.toolId}`);
    if (target.ids.taskId !== undefined)
      keys.push(`subagentTask${IDENTITY_SEPARATOR}${target.ids.taskId}`);
    return keys;
  }
  return [];
}

function isAgentTurnSteer(event: AgentTurnEvent): event is AgentTurnSteer {
  return event.kind === "userMessage";
}

function sameSteer(left: AgentTurnSteer, right: AgentTurnSteer): boolean {
  if (left.remoteMessageId !== undefined && right.remoteMessageId !== undefined)
    return left.remoteMessageId === right.remoteMessageId;
  return left.text === right.text;
}
