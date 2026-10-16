import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentIsolationPolicy } from "../../domain/agentSettings";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import type { WorkspaceTrustOrigin } from "../../domain/trust";
import type { AgentProjectAuthority, AgentProjectLaunchIdentity } from "../agentProjectAuthority";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type {
  AgentProjectsDependencies,
  AgentWorkspaceProjectCloseResult,
} from "./agentProjectsContract";
import { projectDescriptors } from "./agentProjectEntries";
import { closeWorkspaceProject } from "./agentProjectClose";
import {
  ensureProjectLaunchIdentity,
  ensureProjectLease,
  grantProjectTrust,
  noteDispatchTrustRejected,
  refreshProject,
  releaseProject,
} from "./agentProjectCommands";
import { reconcileAgentProjects } from "./agentProjectReconcile";
import {
  createAgentProjectsState,
  isCurrentRepositoryOwner,
  launchIdentityForProject,
} from "./agentProjectsState";

export interface AgentProjectsCoordinator {
  setDependencies(dependencies: AgentProjectsDependencies): void;
  setMounted(mounted: boolean): void;
  reconcile(): void;
  projects(
    activeRootKey: string | null,
    activeRepositories: ReadonlyArray<ResolvedGitRepository>,
    activeIsolationPolicy: AgentIsolationPolicy,
  ): ReadonlyArray<AgentProjectDescriptor>;
  overflowRootPaths(): ReadonlyArray<string>;
  projectsLoaded(): boolean;
  refreshProject(rootKey: string): Promise<void>;
  deferOpenedProjectTrust(rootPath: string): () => void;
  grantProjectTrust(rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void>;
  releaseProject(rootKey: string): Promise<void>;
  closeWorkspaceProject(
    descriptor: WorkspaceIdentityDescriptor,
    isCurrent: () => boolean,
  ): Promise<AgentWorkspaceProjectCloseResult>;
  ensureProjectLease(rootKey: string): Promise<boolean>;
  ensureProjectLaunchIdentity(rootKey: string): Promise<AgentProjectLaunchIdentity | null>;
  launchIdentityForProject(rootKey: string): AgentProjectLaunchIdentity | null;
  isCurrentRepositoryOwner(authority: AgentProjectAuthority, repositoryRoot: string): boolean;
  noteDispatchTrustRejected(rootKey: string): void;
}

export function createAgentProjectsCoordinator(
  dependencies: AgentProjectsDependencies,
  publish: () => void,
): AgentProjectsCoordinator {
  const state = createAgentProjectsState(dependencies, publish);
  return {
    setDependencies: (next) => {
      state.dependencies = next;
    },
    setMounted: (mounted) => {
      state.mounted = mounted;
    },
    reconcile: () => reconcileAgentProjects(state),
    projects: (activeRootKey, activeRepositories, activeIsolationPolicy) =>
      projectDescriptors(state.entries, activeRootKey, activeRepositories, activeIsolationPolicy),
    overflowRootPaths: () => state.overflow,
    projectsLoaded: () => state.projectsLoaded,
    refreshProject: (rootKey) => refreshProject(state, rootKey),
    deferOpenedProjectTrust: (rootPath) => state.openedAdmission.deferTrust(rootPath),
    grantProjectTrust: (rootKey, origin) => grantProjectTrust(state, rootKey, origin),
    releaseProject: (rootKey) => releaseProject(state, rootKey),
    closeWorkspaceProject: (descriptor, isCurrent) =>
      closeWorkspaceProject(state, descriptor, isCurrent),
    ensureProjectLease: (rootKey) => ensureProjectLease(state, rootKey),
    ensureProjectLaunchIdentity: (rootKey) => ensureProjectLaunchIdentity(state, rootKey),
    launchIdentityForProject: (rootKey) => launchIdentityForProject(state, rootKey),
    isCurrentRepositoryOwner: (authority, repositoryRoot) =>
      isCurrentRepositoryOwner(state, authority, repositoryRoot),
    noteDispatchTrustRejected: (rootKey) => noteDispatchTrustRejected(state, rootKey),
  };
}
