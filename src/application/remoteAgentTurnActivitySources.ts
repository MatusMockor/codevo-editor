import type {
  AgentTurnLogPage,
  AgentTurnLogScope,
  ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";
import type { RemoteRunnerProvider } from "../domain/remoteRunner";
import { RemoteAgentTurnActivityReader } from "./remoteAgentTurnActivityReader";
import { RemoteTurnReaderRevoked, type RemoteTurnEventsPort } from "./remoteAgentTurnRawPages";
import type { AgentHistoryActivitySource } from "./useAgentHistoryActivity";

export const MAX_REMOTE_TURN_ACTIVE_READERS = 3;

export interface RemoteTurnActivityBinding {
  readonly owner: object;
  readonly gateway: object;
  readonly port: RemoteTurnEventsPort;
  readonly serverId: string;
  readonly runnerId: string;
  readonly provider: RemoteRunnerProvider;
  readonly scope: AgentTurnLogScope;
}

export type RemoteTurnActivityAuthority = (binding: RemoteTurnActivityBinding) => boolean;

interface BoundSource {
  readonly lease: object;
  readonly binding: RemoteTurnActivityBinding;
  readonly reader: RemoteAgentTurnActivityReader;
  readonly source: AgentHistoryActivitySource;
}

export class RemoteAgentTurnActivitySources {
  private readonly bound = new Map<string, BoundSource>();
  private active: ReadonlyArray<BoundSource> = [];
  private generation = 0;

  resolve(
    binding: RemoteTurnActivityBinding,
    current: RemoteTurnActivityAuthority,
  ): AgentHistoryActivitySource {
    const key = bindingKey(binding);
    const known = this.bound.get(key);
    if (known !== undefined && sameRemoteTurnActivityBinding(known.binding, binding))
      return known.source;
    if (known !== undefined) this.drop(key, known);
    const next = this.bind(key, binding, current);
    this.bound.set(key, next);
    return next.source;
  }

  prune(current: RemoteTurnActivityAuthority): void {
    for (const [key, bound] of this.bound) {
      if (current(bound.binding)) continue;
      this.drop(key, bound);
    }
  }

  private bind(
    key: string,
    binding: RemoteTurnActivityBinding,
    current: RemoteTurnActivityAuthority,
  ): BoundSource {
    const lease = {};
    const live = (): boolean => this.bound.get(key)?.lease === lease && current(binding);
    const reader = new RemoteAgentTurnActivityReader({
      port: binding.port,
      target: { serverId: binding.serverId, taskId: binding.scope.turnId },
      provider: binding.provider,
      authorize: live,
    });
    const readPage = async (request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage> => {
      const entry = this.bound.get(key);
      if (entry === undefined || !live()) throw new RemoteTurnReaderRevoked();
      if (!sameScope(request.scope, binding.scope)) throw new RemoteTurnReaderRevoked();
      this.activate(entry);
      return reader.readPage(request);
    };
    this.generation += 1;
    return {
      lease,
      binding,
      reader,
      source: { scope: binding.scope, generation: this.generation, leaseToken: null, readPage },
    };
  }

  private activate(bound: BoundSource): void {
    const active = [...this.active.filter((entry) => entry !== bound), bound];
    const retired = active.slice(0, Math.max(0, active.length - MAX_REMOTE_TURN_ACTIVE_READERS));
    for (const entry of retired) entry.reader.release();
    this.active = active.slice(retired.length);
  }

  private drop(key: string, bound: BoundSource): void {
    this.bound.delete(key);
    this.active = this.active.filter((entry) => entry !== bound);
    bound.reader.release();
  }
}

export function sameRemoteTurnActivityBinding(
  left: RemoteTurnActivityBinding | null,
  right: RemoteTurnActivityBinding | null,
): boolean {
  if (left === null || right === null) return false;
  return (
    left.owner === right.owner &&
    left.gateway === right.gateway &&
    left.serverId === right.serverId &&
    left.runnerId === right.runnerId &&
    left.provider === right.provider &&
    sameScope(left.scope, right.scope)
  );
}

function sameScope(left: AgentTurnLogScope, right: AgentTurnLogScope): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId
  );
}

function bindingKey(binding: RemoteTurnActivityBinding): string {
  return JSON.stringify([binding.scope.threadId, binding.scope.turnId]);
}
