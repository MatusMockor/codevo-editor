import type { AgentProjectDescriptor, AgentRootLeaseGateway } from "../../domain/agentProject";
import type { AgentIsolationPolicy } from "../../domain/agentSettings";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import type { AppSettings, SettingsGateway } from "../../domain/settings";
import type {
  WorkspaceTrustGateway,
  WorkspaceTrustOrigin,
  WorkspaceTrustState,
} from "../../domain/trust";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkbenchPrompter } from "../workbenchPrompter";
import type { AgentProjectAuthority, AgentProjectLaunchIdentity } from "../agentProjectAuthority";

export const MAX_CONCURRENT_AGENT_PROJECT_LOADS = 2;

export interface AgentRepositoryDiscoveryGateway {
  detectRepositories(rootPath: string, maxDepth?: number): Promise<readonly string[] | null>;
}

export interface AgentProjectsDependencies {
  readonly enabled: boolean;
  readonly autoAdmitOpenedProjects?: boolean;
  readonly trustRevisionForOwner?: (ownerId: string) => number;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly activeWorkspaceId: string | null;
  readonly activeWorkspaceRoot: string | null;
  readonly activeWorkspaceTrust: WorkspaceTrustState | null;
  readonly activeWorkspaceRepositories: ReadonlyArray<ResolvedGitRepository>;
  readonly activeIsolationPolicy: AgentIsolationPolicy;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
  readonly activateWorkspaceRoot?: (rootPath: string) => Promise<void>;
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly repositoryDiscoveryGateway: AgentRepositoryDiscoveryGateway;
  readonly agentRootLeaseGateway: AgentRootLeaseGateway;
  readonly hasLiveTasksForOwner: (ownerId: string) => boolean;
  readonly stopProjectTasks: (
    ownerId: string,
    repositoryRoots: ReadonlyArray<string>,
  ) => Promise<void>;
  readonly releaseProjectTasks: (ownerId: string) => void;
  readonly onActiveWorkspaceTrustChanged: (
    rootPath: string,
    ownerId: string,
    trusted: boolean,
  ) => void;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
  readonly settingsHydrated?: boolean;
}

export interface AgentProjectsSurface {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectsLoaded?: boolean;
  readonly overflowRootPaths: ReadonlyArray<string>;
  refreshProject(rootKey: string): Promise<void>;
  trustProject(rootKey: string): Promise<void>;
  deferOpenedProjectTrust?(rootPath: string): () => void;
  grantProjectTrust?(rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void>;
  releaseProject(rootKey: string): Promise<void>;
  closeWorkspaceProject?(
    descriptor: WorkspaceIdentityDescriptor,
    isCurrent: () => boolean,
  ): Promise<AgentWorkspaceProjectCloseResult>;
  ensureProjectLease(rootKey: string): Promise<boolean>;
  ensureProjectLaunchIdentity?(rootKey: string): Promise<AgentProjectLaunchIdentity | null>;
  launchIdentityForProject(rootKey: string): AgentProjectLaunchIdentity | null;
  isCurrentRepositoryOwner(authority: AgentProjectAuthority, repositoryRoot: string): boolean;
  noteDispatchTrustRejected(rootKey: string): void;
}

export type AgentWorkspaceProjectCloseResult =
  | {
      readonly status: "closed";
      readonly settlement: AgentWorkspaceProjectCloseSettlement;
    }
  | { readonly status: "lease-release-incomplete" }
  | { readonly status: "stale" }
  | { readonly status: "task-stop-incomplete" };

export interface AgentWorkspaceProjectCloseSettlement {
  complete(outcome: "backend-closed" | "backend-not-closed"): Promise<void>;
  finalizeBackendClosed(): void;
}
