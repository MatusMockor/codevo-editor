import type { AgentCliKind } from "../domain/agentTask";
import type { AgentCliDiscoveryPublication } from "./useAgentCliDiscovery";
import type { AgentProviderRefreshOutcome } from "./useAgentProviderManagement";

interface AgentProviderRefreshDependencies {
  readonly providers: ReadonlyArray<AgentCliKind>;
  refreshDiscovery(): Promise<AgentCliDiscoveryPublication | null>;
  discoveryGeneration(): number;
  configurationRevision(provider: AgentCliKind): number;
  applyDiscovery(status: "discovering" | "ready" | "failed", generation: number): void;
  isCurrent(generation: number): boolean;
  refreshHealth(provider: AgentCliKind, generation: number): Promise<AgentProviderRefreshOutcome>;
}

export async function refreshAgentProviderBatch(
  dependencies: AgentProviderRefreshDependencies,
): Promise<ReadonlyArray<AgentProviderRefreshOutcome>> {
  const before = dependencies.providers.map(dependencies.configurationRevision);
  const pending = dependencies.refreshDiscovery();
  const generation = dependencies.discoveryGeneration();
  dependencies.applyDiscovery("discovering", generation);
  const revisions = dependencies.providers.map(dependencies.configurationRevision);
  const publication = await pending;
  const stale = (): AgentProviderRefreshOutcome => ({ kind: "stale" });
  if (!dependencies.isCurrent(generation)) return dependencies.providers.map(stale);
  const current = dependencies.providers.map(
    (provider, index) =>
      revisions[index] === dependencies.configurationRevision(provider) &&
      revisions[index] >= before[index],
  );
  if (!current.some(Boolean)) return dependencies.providers.map(stale);
  if (publication === null) {
    dependencies.applyDiscovery("failed", generation);
    return current.map((valid) => ({ kind: valid ? "failed" : "stale" }));
  }
  if (publication.generation !== generation) return dependencies.providers.map(stale);
  dependencies.applyDiscovery("ready", generation);
  return Promise.all(
    dependencies.providers.map((provider, index) => {
      if (!current[index]) return stale();
      return dependencies.refreshHealth(provider, generation);
    }),
  );
}
