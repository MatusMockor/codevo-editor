import type { AgentTurnEvent } from "./agentThread";
import {
  agentTurnEventSupersession,
  agentTurnSubagentAlias,
  withAgentTurnSubagentIds,
  type AgentTurnBarrierTarget,
  type AgentTurnKeyedSnapshotScope,
  type AgentTurnSnapshotScope,
  type AgentTurnSnapshotTarget,
  type AgentTurnSubagentIds,
} from "./agentTurnEventSupersession";
import {
  createAgentTurnSubagentAliasIndex,
  resolveAgentTurnSubagentIds,
  retainAgentTurnSubagentAlias,
  type AgentTurnSubagentAliasIndex,
} from "./agentTurnSubagentAliases";

export interface AgentTurnSnapshotPlacement {
  readonly event: AgentTurnEvent;
  readonly liveSlot: number | null;
}

export interface AgentTurnSnapshotIndex {
  readonly place: (event: AgentTurnEvent) => AgentTurnSnapshotPlacement;
  readonly adopt: (event: AgentTurnEvent, slot: number) => void;
  readonly evict: (event: AgentTurnEvent, slot: number) => void;
}

type LiveSlotKind = AgentTurnKeyedSnapshotScope | "subagentTool" | "subagentTask";

interface IndexState {
  readonly step: () => void;
  readonly liveSlots: Record<LiveSlotKind, Map<string, number>>;
  readonly aliases: AgentTurnSubagentAliasIndex;
}

export const INERT_AGENT_TURN_SNAPSHOT_INDEX: AgentTurnSnapshotIndex = {
  place: (event) => ({ event, liveSlot: null }),
  adopt: () => undefined,
  evict: () => undefined,
};

export function createAgentTurnSnapshotIndex(step: () => void): AgentTurnSnapshotIndex {
  const state: IndexState = {
    step,
    liveSlots: {
      backgroundTask: new Map(),
      subagentUsage: new Map(),
      contextUsage: new Map(),
      subagentTool: new Map(),
      subagentTask: new Map(),
    },
    aliases: createAgentTurnSubagentAliasIndex(),
  };
  return {
    place: (event) => placeEvent(state, event),
    adopt: (event, slot) => adoptEvent(state, event, slot),
    evict: (event, slot) => evictEvent(state, event, slot),
  };
}

function placeEvent(state: IndexState, event: AgentTurnEvent): AgentTurnSnapshotPlacement {
  const supersession = agentTurnEventSupersession(event);
  if (supersession.kind !== "snapshot") return { event, liveSlot: null };
  const { target } = supersession;
  if (target.reach === "identity")
    return { event, liveSlot: state.liveSlots[target.scope].get(target.identity) ?? null };
  const resolution = resolveAgentTurnSubagentIds(state.aliases, target.ids);
  if (!resolution.canonical) return { event, liveSlot: null };
  return {
    event: withAgentTurnSubagentIds(event, resolution.ids),
    liveSlot: sharedSubagentSlot(state, resolution.ids),
  };
}

function sharedSubagentSlot(state: IndexState, ids: AgentTurnSubagentIds): number | null {
  const tool = ids.toolId === undefined ? undefined : state.liveSlots.subagentTool.get(ids.toolId);
  const task = ids.taskId === undefined ? undefined : state.liveSlots.subagentTask.get(ids.taskId);
  if (ids.toolId !== undefined && tool === undefined) return null;
  if (ids.taskId !== undefined && task === undefined) return null;
  if (tool !== undefined && task !== undefined && tool !== task) return null;
  return tool ?? task ?? null;
}

function adoptEvent(state: IndexState, event: AgentTurnEvent, slot: number): void {
  countAlias(state, event, 1);
  const supersession = agentTurnEventSupersession(event);
  switch (supersession.kind) {
    case "content":
      return;
    case "barrier":
      return releaseTargets(state, supersession.targets);
    case "snapshot":
      return claimTarget(state, supersession.target, slot);
    default:
      return unsupportedSupersession(supersession);
  }
}

function evictEvent(state: IndexState, event: AgentTurnEvent, slot: number): void {
  countAlias(state, event, -1);
  const supersession = agentTurnEventSupersession(event);
  if (supersession.kind !== "snapshot") return;
  const { target } = supersession;
  if (target.reach === "identity")
    return releaseIfOwned(state.liveSlots[target.scope], target.identity, slot);
  if (target.ids.toolId !== undefined)
    releaseIfOwned(state.liveSlots.subagentTool, target.ids.toolId, slot);
  if (target.ids.taskId !== undefined)
    releaseIfOwned(state.liveSlots.subagentTask, target.ids.taskId, slot);
}

function countAlias(state: IndexState, event: AgentTurnEvent, delta: 1 | -1): void {
  const alias = agentTurnSubagentAlias(event);
  if (alias !== null) retainAgentTurnSubagentAlias(state.aliases, alias, delta);
}

function claimTarget(state: IndexState, target: AgentTurnSnapshotTarget, slot: number): void {
  if (target.reach === "identity") {
    state.liveSlots[target.scope].set(target.identity, slot);
    return;
  }
  const resolution = resolveAgentTurnSubagentIds(state.aliases, target.ids);
  if (!resolution.canonical) return releaseSubagentIds(state, resolution.ids);
  const { toolId, taskId } = resolution.ids;
  if (toolId !== undefined) state.liveSlots.subagentTool.set(toolId, slot);
  if (taskId !== undefined) state.liveSlots.subagentTask.set(taskId, slot);
}

function releaseTargets(state: IndexState, targets: ReadonlyArray<AgentTurnBarrierTarget>): void {
  for (const target of targets) {
    state.step();
    releaseTarget(state, target);
  }
}

function releaseTarget(state: IndexState, target: AgentTurnBarrierTarget): void {
  if (target.reach === "scope") return releaseScope(state, target.scope);
  if (target.reach === "identity") {
    state.liveSlots[target.scope].delete(target.identity);
    return;
  }
  if (state.liveSlots.subagentTool.size === 0 && state.liveSlots.subagentTask.size === 0) return;
  releaseSubagentIds(state, resolveAgentTurnSubagentIds(state.aliases, target.ids).ids);
}

function releaseSubagentIds(state: IndexState, ids: AgentTurnSubagentIds): void {
  if (ids.toolId !== undefined) state.liveSlots.subagentTool.delete(ids.toolId);
  if (ids.taskId !== undefined) state.liveSlots.subagentTask.delete(ids.taskId);
}

function releaseScope(state: IndexState, scope: AgentTurnSnapshotScope): void {
  if (scope !== "subagent") return releaseLiveSlots(state, scope);
  releaseLiveSlots(state, "subagentTool");
  releaseLiveSlots(state, "subagentTask");
}

function releaseLiveSlots(state: IndexState, kind: LiveSlotKind): void {
  const live = state.liveSlots[kind];
  for (const key of live.keys()) {
    state.step();
    live.delete(key);
  }
}

function releaseIfOwned(live: Map<string, number>, key: string, slot: number): void {
  if (live.get(key) === slot) live.delete(key);
}

function unsupportedSupersession(supersession: never): never {
  throw new TypeError(`Unsupported supersession: ${JSON.stringify(supersession)}`);
}
