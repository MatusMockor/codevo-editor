import type {
  AgentCommandCatalogGateway,
  RemoteAgentCommandCatalogGateway,
} from "../application/agentCommandCatalogGateway";
import {
  parseAgentCommandCatalog,
  type AgentCommandCatalog,
  type AgentCommandCatalogEntry,
  type AgentCommandCatalogRequest,
} from "../domain/agentCommandCatalog";
import type { AgentCliKind } from "../domain/agentTask";
import type { RemoteRunnerCommandCatalogRequest } from "../domain/remoteRunner";

interface PendingAgentCommandCatalogRead<Request> {
  readonly request: Request;
  resolve(catalog: AgentCommandCatalog): void;
  reject(reason: unknown): void;
}

class DeferredAgentCommandCatalogReads<Request> {
  readonly reads: Array<PendingAgentCommandCatalogRead<Request>> = [];

  requests(): ReadonlyArray<Request> {
    return this.reads.map((read) => read.request);
  }

  protected defer(request: Request): Promise<AgentCommandCatalog> {
    return new Promise((resolve, reject) => {
      this.reads.push({ request, resolve, reject });
    });
  }
}

/** In-memory local port whose reads settle only when a test says so. */
export class DeferredAgentCommandCatalogGateway
  extends DeferredAgentCommandCatalogReads<AgentCommandCatalogRequest>
  implements AgentCommandCatalogGateway
{
  read(request: AgentCommandCatalogRequest): Promise<AgentCommandCatalog> {
    return this.defer(request);
  }
}

/** In-memory server runner port whose reads settle only when a test says so. */
export class DeferredRemoteCommandCatalogGateway
  extends DeferredAgentCommandCatalogReads<RemoteRunnerCommandCatalogRequest>
  implements RemoteAgentCommandCatalogGateway
{
  getCommandCatalog(request: RemoteRunnerCommandCatalogRequest): Promise<AgentCommandCatalog> {
    return this.defer(request);
  }
}

export function agentCommandCatalogFixture(
  provider: AgentCliKind,
  entries: ReadonlyArray<Partial<AgentCommandCatalogEntry> & { readonly name: string }>,
  truncated = false,
): AgentCommandCatalog {
  return parseAgentCommandCatalog({
    version: 1,
    provider,
    truncated,
    entries: entries.map((entry) => ({
      kind: provider === "codex" ? "skill" : "command",
      label: null,
      description: null,
      argumentHint: null,
      builtin: false,
      ...entry,
    })),
  });
}
