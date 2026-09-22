import type { DirectoryListingGateway } from "../../domain/directoryListing";
import type { createCloneComposerAttachments } from "../../application/cloneComposerAttachments";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { LocalProjectCloneSession } from "../../application/useLocalProjectClone";
import type { RemoteAddProjectSession } from "../../application/useRemoteAddProject";
import type { LocalProjectCloneGateway } from "../../application/ports/localProjectCloneGateway";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";

export type PendingProjectClone = {
  readonly id: string;
  readonly name: string;
  readonly draftKey?: string;
  readonly environment: string | null;
  readonly target:
    | { readonly kind: "local"; readonly path: string }
    | { readonly kind: "remote"; readonly key: string }
    | null;
};

export const MAX_PENDING_PROJECT_CLONES = 4;
export interface AgentProjectCloneLaneSession {
  readonly creation: AgentProjectCreationSession;
  readonly local: LocalProjectCloneSession;
  readonly remote: RemoteAddProjectSession;
}

/** Private in-memory operations, owned above the keyed workspace view. */
export interface AgentProjectRemotePorts {
  readonly runnerGateway: RemoteRunnerGateway | null;
  readonly serverId: string | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
  readonly directoryGateway: DirectoryListingGateway | null;
}
export interface AgentProjectCreationSession {
  remotePorts?: AgentProjectRemotePorts;
  lanes?: AgentProjectCloneLaneSession[];
  selectedLane?: number;
  receiptLane?: number;
  attachmentDrafts?: ReturnType<typeof createCloneComposerAttachments>;
  attachmentKeys?: readonly string[];
  current: {
    readonly localGateway: LocalProjectCloneGateway | null;
    readonly remoteGateway: RemoteRunnerGateway | null;
    readonly lookupGateway: RepositoryLookupGateway | null;
    readonly pending: PendingProjectClone;
    readonly draft: string;
    readonly launch?: AgentLaunchOptions | null;
    readonly isolation?: AgentTaskIsolation;
    readonly completedProject?: AgentProjectDescriptor | null;
    readonly activationReceipt?: { readonly id: string; readonly path: string } | null;
    readonly serverId: string | null;
    readonly workspaceOwner: string | null;
  } | null;
}

export const MAX_PENDING_CLONE_DRAFT_CHARS = 1_048_576;
