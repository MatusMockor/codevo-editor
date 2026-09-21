import type { LocalProjectCloneGateway } from "../../application/ports/localProjectCloneGateway";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";

export type PendingProjectClone = {
  readonly id: string;
  readonly name: string;
  readonly environment: string | null;
  readonly target:
    | { readonly kind: "local"; readonly path: string }
    | { readonly kind: "remote"; readonly key: string }
    | null;
};

/** One private in-memory operation, owned above the keyed workspace view. */
export interface AgentProjectCreationSession {
  current: {
    readonly localGateway: LocalProjectCloneGateway | null;
    readonly remoteGateway: RemoteRunnerGateway | null;
    readonly lookupGateway: RepositoryLookupGateway | null;
    readonly pending: PendingProjectClone;
    readonly draft: string;
    readonly serverId: string | null;
    readonly workspaceOwner: string | null;
  } | null;
}

export const MAX_PENDING_CLONE_DRAFT_CHARS = 1_048_576;
