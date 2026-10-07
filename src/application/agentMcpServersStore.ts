import {
  agentMcpServersErrorKind,
  type AgentMcpServers,
  type AgentMcpServersErrorKind,
  type AgentMcpServersRequest,
} from "../domain/agentMcpServers";
import type { AgentMcpServersGateway } from "./agentMcpServersGateway";

export const MAX_AGENT_MCP_SERVERS_KEYS = 16;

export interface AgentMcpServersSnapshot {
  readonly result: AgentMcpServers;
  readonly checkedAtMs: number;
}

export type AgentMcpServersState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly previous: AgentMcpServersSnapshot | null }
  | { readonly kind: "loaded"; readonly snapshot: AgentMcpServersSnapshot }
  | {
      readonly kind: "failed";
      readonly error: AgentMcpServersErrorKind;
      readonly previous: AgentMcpServersSnapshot | null;
    };

export interface AgentMcpServersStore {
  state(target: AgentMcpServersRequest): AgentMcpServersState;
  refresh(target: AgentMcpServersRequest): void;
  subscribe(target: AgentMcpServersRequest, listener: () => void): () => void;
}

type CheckOutcome =
  | { readonly kind: "checked"; readonly result: AgentMcpServers }
  | { readonly kind: "failed"; readonly error: AgentMcpServersErrorKind };

interface Slot {
  state: AgentMcpServersState;
  pending: number | null;
}

export const IDLE_AGENT_MCP_SERVERS_STATE: AgentMcpServersState = Object.freeze({ kind: "idle" });

export function agentMcpServersTargetKey(target: AgentMcpServersRequest): string {
  return JSON.stringify([target.provider, target.repositoryRoot]);
}

export function agentMcpServersSnapshot(
  state: AgentMcpServersState,
): AgentMcpServersSnapshot | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
    case "failed":
      return state.previous;
    case "loaded":
      return state.snapshot;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function agentMcpServersFailureKeepsSnapshot(error: AgentMcpServersErrorKind): boolean {
  switch (error) {
    case "busy":
    case "timedOut":
    case "unavailable":
      return true;
    case "unknownWorkspace":
    case "untrustedWorkspace":
    case "providerDisabled":
      return false;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export class AgentMcpServersStatusStore implements AgentMcpServersStore {
  private readonly gateway: AgentMcpServersGateway;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly slots = new Map<string, Slot>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private generation = 0;

  constructor(
    gateway: AgentMcpServersGateway,
    maxKeys = MAX_AGENT_MCP_SERVERS_KEYS,
    now: () => number = Date.now,
  ) {
    this.gateway = gateway;
    this.maxKeys = Math.max(1, maxKeys);
    this.now = now;
  }

  state(target: AgentMcpServersRequest): AgentMcpServersState {
    return this.slots.get(agentMcpServersTargetKey(target))?.state ?? IDLE_AGENT_MCP_SERVERS_STATE;
  }

  refresh(target: AgentMcpServersRequest): void {
    const key = agentMcpServersTargetKey(target);
    const slot = this.claim(key);
    if (slot.pending !== null) return;
    this.generation += 1;
    const generation = this.generation;
    slot.pending = generation;
    slot.state = Object.freeze({
      kind: "loading",
      previous: agentMcpServersSnapshot(slot.state),
    });
    const request = { repositoryRoot: target.repositoryRoot, provider: target.provider };
    void this.check(key, slot, request, generation);
    this.notify(key);
  }

  subscribe(target: AgentMcpServersRequest, listener: () => void): () => void {
    const key = agentMcpServersTargetKey(target);
    const listeners = this.watchers.get(key) ?? new Set();
    listeners.add(listener);
    this.watchers.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0 || this.watchers.get(key) !== listeners) return;
      this.watchers.delete(key);
      this.evictUnwatched(null);
    };
  }

  private claim(key: string): Slot {
    const slot = this.slots.get(key) ?? { state: IDLE_AGENT_MCP_SERVERS_STATE, pending: null };
    this.slots.delete(key);
    this.slots.set(key, slot);
    this.evictUnwatched(key);
    return slot;
  }

  private evictUnwatched(claimed: string | null): void {
    for (const key of this.slots.keys()) {
      if (this.slots.size <= this.maxKeys) return;
      if (key === claimed || this.watchers.has(key)) continue;
      this.slots.delete(key);
    }
  }

  private async check(
    key: string,
    slot: Slot,
    request: AgentMcpServersRequest,
    generation: number,
  ): Promise<void> {
    const outcome = await this.attempt(request);
    if (this.slots.get(key) !== slot || slot.pending !== generation) return;
    slot.pending = null;
    slot.state = Object.freeze(
      settledState(agentMcpServersSnapshot(slot.state), outcome, this.now()),
    );
    this.notify(key);
  }

  private async attempt(request: AgentMcpServersRequest): Promise<CheckOutcome> {
    try {
      const result = await this.gateway.check(request);
      if (result.provider !== request.provider) return { kind: "failed", error: "unavailable" };
      return { kind: "checked", result };
    } catch (error) {
      return { kind: "failed", error: agentMcpServersErrorKind(error) };
    }
  }

  private notify(key: string): void {
    for (const listener of [...(this.watchers.get(key) ?? [])]) listener();
  }
}

function settledState(
  previous: AgentMcpServersSnapshot | null,
  outcome: CheckOutcome,
  checkedAtMs: number,
): AgentMcpServersState {
  switch (outcome.kind) {
    case "checked":
      return {
        kind: "loaded",
        snapshot: Object.freeze({ result: outcome.result, checkedAtMs }),
      };
    case "failed":
      return {
        kind: "failed",
        error: outcome.error,
        previous: agentMcpServersFailureKeepsSnapshot(outcome.error) ? previous : null,
      };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
