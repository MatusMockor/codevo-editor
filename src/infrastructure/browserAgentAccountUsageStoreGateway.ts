import {
  parseAgentAccountUsageSnapshot,
  type AgentAccountUsageSnapshot,
  type AgentAccountUsageStoreChange,
  type AgentAccountUsageStoreGateway,
} from "../domain/agentAccountUsage";
import type { KeyValueStorage } from "./browserSettingsGateway";

const STORAGE_KEY = "editor.agentAccountUsage.v1";
const MAX_STORED_BYTES = 32 * 1_024;
type UsageListener = (change: AgentAccountUsageStoreChange) => void;
type Provider = AgentAccountUsageSnapshot["provider"];
interface SharedUsage {
  readonly latest: Map<Provider, AgentAccountUsageSnapshot | null>;
  readonly dirty: Set<Provider>;
  readonly listeners: Set<UsageListener>;
}
// Local CLI observations share the exact storage authority, never a remote server.
// Each weakly owned channel retains at most one snapshot/tombstone per provider.
const sharedByStorage = new WeakMap<KeyValueStorage, SharedUsage>();

export class BrowserAgentAccountUsageStoreGateway implements AgentAccountUsageStoreGateway {
  private readonly shared: SharedUsage;

  constructor(private readonly storage: KeyValueStorage = localStorage) {
    const shared = sharedByStorage.get(storage) ?? {
      latest: new Map(),
      dirty: new Set(),
      listeners: new Set(),
    };
    sharedByStorage.set(storage, shared);
    this.shared = shared;
  }

  loadAgentAccountUsage(): ReadonlyArray<AgentAccountUsageSnapshot> {
    const persisted = this.readPersisted();
    if (persisted !== null) {
      for (const provider of ["claudeCode", "codex"] as const) {
        if (this.shared.dirty.has(provider)) continue;
        const snapshot = persisted.find((value) => value.provider === provider);
        const latest = this.shared.latest.get(provider);
        if (snapshot === undefined) this.shared.latest.set(provider, null);
        else if (!latest || snapshot.fetchedAtEpochMs >= latest.fetchedAtEpochMs) {
          this.shared.latest.set(provider, snapshot);
        }
      }
    }
    return [...this.shared.latest.values()].filter((value) => value !== null);
  }

  saveAgentAccountUsage(snapshot: AgentAccountUsageSnapshot): void {
    const validated = parseAgentAccountUsageSnapshot(snapshot);
    const snapshots = new Map(this.loadAgentAccountUsage().map((value) => [value.provider, value]));
    const current = snapshots.get(validated.provider);
    if (current !== undefined && current.fetchedAtEpochMs > validated.fetchedAtEpochMs) return;
    snapshots.set(validated.provider, validated);
    this.shared.latest.set(validated.provider, validated);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...snapshots.values()]));
      this.shared.dirty.clear();
    } catch (error) {
      this.shared.dirty.add(validated.provider);
      throw error;
    } finally {
      // A denied write must not split the mounted workspaces' live view.
      this.notify({ kind: "snapshot", snapshot: validated });
    }
  }

  invalidateAgentAccountUsage(provider: Provider): void {
    const snapshots = this.loadAgentAccountUsage().filter((value) => value.provider !== provider);
    this.shared.latest.set(provider, null);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
      this.shared.dirty.clear();
    } catch (error) {
      this.shared.dirty.add(provider);
      throw error;
    } finally {
      this.notify({ kind: "invalidated", provider });
    }
  }

  subscribeAgentAccountUsage(listener: UsageListener): () => void {
    this.shared.listeners.add(listener);
    this.loadAgentAccountUsage();
    // Includes tombstones written between a consumer's render and subscription.
    for (const [provider, snapshot] of this.shared.latest) {
      listener(
        snapshot === null ? { kind: "invalidated", provider } : { kind: "snapshot", snapshot },
      );
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== this.storage || event.key !== STORAGE_KEY) return;
      // The event payload can be delayed; current persisted storage is authoritative.
      const persisted = this.readPersisted();
      if (persisted === null) return;
      for (const provider of ["claudeCode", "codex"] as const) {
        // A delayed persisted baseline cannot replace unsaved live authority.
        if (this.shared.dirty.has(provider)) continue;
        const snapshot = persisted.find((value) => value.provider === provider);
        if (snapshot === undefined) {
          this.shared.latest.set(provider, null);
          listener({ kind: "invalidated", provider });
        } else {
          const latest = this.shared.latest.get(provider);
          if (latest && latest.fetchedAtEpochMs > snapshot.fetchedAtEpochMs) continue;
          this.shared.latest.set(provider, snapshot);
          listener({ kind: "snapshot", snapshot });
        }
      }
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      this.shared.listeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  }

  private notify(change: AgentAccountUsageStoreChange): void {
    for (const listener of [...this.shared.listeners]) listener(change);
  }

  private readPersisted(): ReadonlyArray<AgentAccountUsageSnapshot> | null {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      if (new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) return null;
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length > 2) return null;
      const snapshots = new Map<Provider, AgentAccountUsageSnapshot>();
      for (const candidate of value) {
        const snapshot = parseAgentAccountUsageSnapshot(candidate);
        const current = snapshots.get(snapshot.provider);
        if (current === undefined || snapshot.fetchedAtEpochMs >= current.fetchedAtEpochMs) {
          snapshots.set(snapshot.provider, snapshot);
        }
      }
      return [...snapshots.values()];
    } catch {
      return null;
    }
  }
}
