import { sameAgentCommandCatalog, type AgentCommandCatalog } from "../domain/agentCommandCatalog";
import {
  agentCommandCatalogTargetKey,
  type AgentCommandCatalogTarget,
} from "../domain/agentCommandCatalogTarget";
import type { AgentCommandCatalogSource } from "./agentCommandCatalogGateway";

export const AGENT_COMMAND_CATALOG_TTL_MS = 60_000;
export const AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS = [1_500, 3_000, 6_000, 10_000] as const;
export const AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS = 30_000;
/**
 * Cap on cached targets. A target a composer is watching is never evicted, so the cache
 * holds at most this many entries, or the watched targets plus the one just requested
 * when more than that are being watched at once.
 */
export const MAX_AGENT_COMMAND_CATALOG_KEYS = 16;

export interface AgentCommandCatalogStore {
  snapshot(target: AgentCommandCatalogTarget): AgentCommandCatalog | null;
  refresh(target: AgentCommandCatalogTarget): void;
  subscribe(target: AgentCommandCatalogTarget, listener: () => void): () => void;
}

type Settlement =
  | { readonly kind: "never" }
  | { readonly kind: "loaded"; readonly at: number }
  | { readonly kind: "failed"; readonly at: number; readonly failures: number };

interface PendingRead {
  readonly sequence: number;
  readonly startedAt: number;
}

interface Slot {
  catalog: AgentCommandCatalog | null;
  settlement: Settlement;
  pending: PendingRead | null;
  retry: ReturnType<typeof setTimeout> | null;
}

/**
 * Stale-while-revalidate cache keyed by the exact target: (provider, repository root) for
 * this machine, (provider, server, runner identity, project) for a server runner.
 *
 * A read may only settle the slot that started it, and only while it is still that
 * slot's newest read: an evicted or superseded read is dropped without publishing.
 * Eviction takes the least recently requested target nobody watches, so a mounted
 * composer never loses the catalog it is showing.
 * A failed read is retried on a bounded backoff, and only while a composer still
 * watches that exact target.
 */
export class AgentCommandCatalogCache implements AgentCommandCatalogStore {
  private readonly source: AgentCommandCatalogSource;
  private readonly maxKeys: number;
  private readonly slots = new Map<string, Slot>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private sequence = 0;

  constructor(source: AgentCommandCatalogSource, maxKeys = MAX_AGENT_COMMAND_CATALOG_KEYS) {
    this.source = source;
    this.maxKeys = Math.max(1, maxKeys);
  }

  snapshot(target: AgentCommandCatalogTarget): AgentCommandCatalog | null {
    return this.slots.get(agentCommandCatalogTargetKey(target))?.catalog ?? null;
  }

  refresh(target: AgentCommandCatalogTarget): void {
    const key = agentCommandCatalogTargetKey(target);
    const slot = this.claim(key);
    const startedAt = Date.now();
    if (!readIsDue(slot, startedAt)) {
      this.scheduleRetry(key, slot, target);
      return;
    }
    this.cancelRetry(slot);
    this.sequence += 1;
    const sequence = this.sequence;
    slot.pending = { sequence, startedAt };
    void this.read(key, slot, target, sequence);
  }

  subscribe(target: AgentCommandCatalogTarget, listener: () => void): () => void {
    const key = agentCommandCatalogTargetKey(target);
    const listeners = this.watchers.get(key) ?? new Set();
    listeners.add(listener);
    this.watchers.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0 || this.watchers.get(key) !== listeners) return;
      this.watchers.delete(key);
      const slot = this.slots.get(key);
      if (slot !== undefined) this.cancelRetry(slot);
      this.evictUnwatched(null);
    };
  }

  private claim(key: string): Slot {
    const slot = this.slots.get(key) ?? {
      catalog: null,
      settlement: { kind: "never" },
      pending: null,
      retry: null,
    };
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

  private async read(
    key: string,
    slot: Slot,
    target: AgentCommandCatalogTarget,
    sequence: number,
  ): Promise<void> {
    const catalog = await this.attempt(target);
    if (this.slots.get(key) !== slot || slot.pending?.sequence !== sequence) return;
    slot.pending = null;
    const at = Date.now();
    if (catalog === null) {
      const failures = slot.settlement.kind === "failed" ? slot.settlement.failures + 1 : 1;
      slot.settlement = { kind: "failed", at, failures };
      this.scheduleRetry(key, slot, target);
      return;
    }
    slot.settlement = { kind: "loaded", at };
    if (slot.catalog !== null && sameAgentCommandCatalog(slot.catalog, catalog)) return;
    slot.catalog = catalog;
    for (const listener of [...(this.watchers.get(key) ?? [])]) listener();
  }

  private async attempt(target: AgentCommandCatalogTarget): Promise<AgentCommandCatalog | null> {
    try {
      const catalog = await this.source.read(target);
      return catalog.provider === target.provider ? catalog : null;
    } catch {
      return null;
    }
  }

  private scheduleRetry(key: string, slot: Slot, target: AgentCommandCatalogTarget): void {
    const failed = slot.settlement;
    if (failed.kind !== "failed" || slot.pending !== null || slot.retry !== null) return;
    if (failed.failures > AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS.length) return;
    if (!this.watchers.has(key)) return;
    const wait = Math.max(0, failed.at + retryDelay(failed.failures) - Date.now());
    slot.retry = setTimeout(() => {
      slot.retry = null;
      if (this.slots.get(key) !== slot || !this.watchers.has(key)) return;
      this.refresh(target);
    }, wait);
  }

  private cancelRetry(slot: Slot): void {
    if (slot.retry === null) return;
    clearTimeout(slot.retry);
    slot.retry = null;
  }
}

function retryDelay(failures: number): number {
  const delays = AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS;
  return delays[Math.max(1, Math.min(failures, delays.length)) - 1];
}

function readIsDue(slot: Slot, at: number): boolean {
  if (slot.pending !== null)
    return elapsed(slot.pending.startedAt, at, AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS);
  switch (slot.settlement.kind) {
    case "never":
      return true;
    case "loaded":
      return elapsed(slot.settlement.at, at, AGENT_COMMAND_CATALOG_TTL_MS);
    case "failed":
      return elapsed(slot.settlement.at, at, retryDelay(slot.settlement.failures));
    default: {
      const unreachable: never = slot.settlement;
      return unreachable;
    }
  }
}

function elapsed(since: number, at: number, interval: number): boolean {
  const age = at - since;
  return age < 0 || age >= interval;
}
