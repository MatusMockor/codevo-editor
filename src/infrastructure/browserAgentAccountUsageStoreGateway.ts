import {
  parseAgentAccountUsageSnapshot,
  type AgentAccountUsageSnapshot,
  type AgentAccountUsageStoreGateway,
} from "../domain/agentAccountUsage";
import type { KeyValueStorage } from "./browserSettingsGateway";

const STORAGE_KEY = "editor.agentAccountUsage.v1";
const MAX_STORED_BYTES = 32 * 1_024;

export class BrowserAgentAccountUsageStoreGateway implements AgentAccountUsageStoreGateway {
  constructor(private readonly storage: KeyValueStorage = localStorage) {}

  loadAgentAccountUsage(): ReadonlyArray<AgentAccountUsageSnapshot> {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null || new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) return [];
    try {
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length > 2) return [];
      const snapshots = new Map<AgentAccountUsageSnapshot["provider"], AgentAccountUsageSnapshot>();
      for (const candidate of value) {
        const snapshot = parseAgentAccountUsageSnapshot(candidate);
        const current = snapshots.get(snapshot.provider);
        if (current === undefined || snapshot.fetchedAtEpochMs >= current.fetchedAtEpochMs) {
          snapshots.set(snapshot.provider, snapshot);
        }
      }
      return [...snapshots.values()];
    } catch {
      return [];
    }
  }

  saveAgentAccountUsage(snapshot: AgentAccountUsageSnapshot): void {
    const snapshots = new Map(
      this.loadAgentAccountUsage().map((candidate) => [candidate.provider, candidate]),
    );
    snapshots.set(snapshot.provider, snapshot);
    this.storage.setItem(STORAGE_KEY, JSON.stringify([...snapshots.values()]));
  }
}
