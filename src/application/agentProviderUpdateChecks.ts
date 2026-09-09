import type {
  AgentProviderGenerationRequest,
  AgentProviderHealthGateway,
  AgentProviderUpdateAvailability,
} from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentTask";

type Update = Exclude<AgentProviderUpdateAvailability, { readonly kind: "checking" }>;

interface UpdateCheckOwner {
  readonly request: AgentProviderGenerationRequest;
  readonly installedVersion: string;
  readonly gateway: AgentProviderHealthGateway;
  current(): boolean;
  publish(update: Update): void;
  reportError(error: unknown): void;
}

export function createAgentProviderUpdateChecks(dependencies: {
  capture(provider: AgentCliKind): UpdateCheckOwner | null;
}) {
  const pending = new Map<AgentCliKind, { owner: UpdateCheckOwner; promise: Promise<void> }>();
  const informational = new Set<AgentCliKind>();
  let batch: { current(): boolean; promise: Promise<void> } | null = null;
  const check = (provider: AgentCliKind): Promise<void> => {
    const existing = pending.get(provider);
    if (existing?.owner.current()) return existing.promise;
    const owner = dependencies.capture(provider);
    if (owner === null) return Promise.resolve();
    const promise = (async () => {
      try {
        const result = await owner.gateway.checkAgentProviderUpdates(owner.request);
        if (!owner.current()) return;
        if (
          "installedVersion" in result.update &&
          result.update.installedVersion !== owner.installedVersion
        )
          return;
        informational.add(provider);
        owner.publish(result.update);
      } catch (error) {
        if (!owner.current()) return;
        informational.add(provider);
        owner.publish({ kind: "unavailable", reason: "probeFailed" });
        owner.reportError(error);
      }
    })().finally(() => {
      if (pending.get(provider)?.owner === owner) pending.delete(provider);
    });
    pending.set(provider, { owner, promise });
    return promise;
  };
  return {
    check,
    checkAll(providers: readonly AgentCliKind[]): Promise<void> {
      if (batch?.current()) return batch.promise;
      const owners = providers.map((provider) => dependencies.capture(provider));
      const promise = Promise.all(providers.map(check))
        .then(() => undefined)
        .finally(() => {
          if (batch?.promise === promise) batch = null;
        });
      batch = {
        current: () =>
          owners.every((owner, index) =>
            owner === null ? dependencies.capture(providers[index]!) === null : owner.current(),
          ),
        promise,
      };
      return promise;
    },
    needsDiagnostics: (provider: AgentCliKind) => informational.has(provider),
    confirmDiagnostics: (provider: AgentCliKind) => informational.delete(provider),
  };
}
