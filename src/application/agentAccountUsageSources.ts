import type { AgentAccountUsageSnapshot } from "../domain/agentAccountUsage";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";
import type { AgentCliKind } from "../domain/agentTask";

const MAX_SOURCES = 129;
interface Receipt {
  readonly snapshot: AgentAccountUsageSnapshot;
  readonly revision: number;
}
interface Source {
  readonly values: Map<AgentCliKind, Receipt>;
  readonly invalidated: Map<AgentCliKind, number>;
}

/** Host clocks are independent: accepted client receipts order a verified shared account. */
export function createAgentAccountUsageSources(): AgentAccountUsageSourcesPort {
  const sources = new Map<string, Source>();
  const accounts = new Map<string, Receipt>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const retain = (source: string): Source => {
    const current = sources.get(source);
    if (current) return current;
    if (sources.size >= MAX_SOURCES) {
      const evicted = [...sources.keys()].find((key) => key !== "local");
      if (evicted !== undefined) sources.delete(evicted);
    }
    const created = { values: new Map(), invalidated: new Map() };
    sources.set(source, created);
    return created;
  };
  const accountKey = (snapshot: AgentAccountUsageSnapshot): string | null =>
    snapshot.accountIdentity ? JSON.stringify([snapshot.provider, snapshot.accountIdentity]) : null;
  const pruneAccounts = () => {
    const retained = new Set(
      [...sources.values()].flatMap((source) =>
        [...source.values.values()].flatMap(({ snapshot }) => {
          const key = accountKey(snapshot);
          return key ? [key] : [];
        }),
      ),
    );
    for (const key of accounts.keys()) if (!retained.has(key)) accounts.delete(key);
  };
  return {
    revision: () => revision,
    observe(source, snapshot, queryRevision) {
      const current = sources.get(source)?.values.get(snapshot.provider);
      if (current && JSON.stringify(current.snapshot) === JSON.stringify(snapshot)) return false;
      const identity = snapshot.accountIdentity;
      let supersededByPeer = false;
      if (queryRevision !== undefined) {
        const key = accountKey(snapshot);
        supersededByPeer = key !== null && (accounts.get(key)?.revision ?? -1) > queryRevision;
        if ((sources.get(source)?.invalidated.get(snapshot.provider) ?? -1) > queryRevision)
          return false;
        for (const [key, providers] of sources) {
          const receipt = providers.values.get(snapshot.provider);
          if (!receipt || receipt.revision <= queryRevision) continue;
          if (key === source) return false;
          if (identity && receipt.snapshot.accountIdentity === identity) supersededByPeer = true;
        }
      }
      const providers = retain(source);
      revision++;
      // Even an overtaken first query establishes this source's verified binding;
      // its old values never outrank the peer observation received during the query.
      providers.values.set(snapshot.provider, {
        snapshot,
        revision: supersededByPeer ? queryRevision! : revision,
      });
      const key = accountKey(snapshot);
      if (key && !supersededByPeer) accounts.set(key, { snapshot, revision });
      pruneAccounts();
      notify();
      return !supersededByPeer;
    },
    invalidate(source, provider) {
      const providers = retain(source);
      providers.values.delete(provider);
      providers.invalidated.set(provider, ++revision);
      pruneAccounts();
      notify();
    },
    read(source, provider) {
      let latest = sources.get(source)?.values.get(provider);
      const identity = latest?.snapshot.accountIdentity;
      if (!latest || !identity) return latest?.snapshot ?? null;
      const account = accounts.get(JSON.stringify([provider, identity]));
      if (account && account.revision > latest.revision) latest = account;
      for (const providers of sources.values()) {
        const candidate = providers.values.get(provider);
        if (
          candidate &&
          candidate.snapshot.accountIdentity === identity &&
          candidate.revision > latest.revision
        )
          latest = candidate;
      }
      return latest.snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
