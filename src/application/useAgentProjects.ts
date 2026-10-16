import { useEffect, useLayoutEffect, useMemo, useReducer, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentIsolationPolicy } from "../domain/agentSettings";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type {
  AgentProjectsDependencies,
  AgentProjectsSurface,
} from "./agentProjects/agentProjectsContract";
import {
  createAgentProjectsCoordinator,
  type AgentProjectsCoordinator,
} from "./agentProjects/agentProjectsCoordinator";

export {
  MAX_CONCURRENT_AGENT_PROJECT_LOADS,
  type AgentProjectsDependencies,
  type AgentProjectsSurface,
  type AgentRepositoryDiscoveryGateway,
  type AgentWorkspaceProjectCloseResult,
  type AgentWorkspaceProjectCloseSettlement,
} from "./agentProjects/agentProjectsContract";

export function useAgentProjects(dependencies: AgentProjectsDependencies): AgentProjectsSurface {
  const [version, publish] = useReducer((current: number) => current + 1, 0);
  const [coordinator] = useState(() => createAgentProjectsCoordinator(dependencies, publish));

  useLayoutEffect(() => {
    coordinator.setDependencies(dependencies);
  });

  useEffect(() => {
    coordinator.setMounted(true);
    return () => {
      coordinator.setMounted(false);
    };
  }, [coordinator]);

  useEffect(() => {
    coordinator.reconcile();
  });

  const activeRootKey = dependencies.activeWorkspaceRoot
    ? normalizedWorkspaceRootKey(dependencies.activeWorkspaceRoot)
    : null;
  const projects = useMemo(
    () =>
      projectDescriptors(
        version,
        coordinator,
        activeRootKey,
        dependencies.activeWorkspaceRepositories,
        dependencies.activeIsolationPolicy,
      ),
    [
      activeRootKey,
      coordinator,
      dependencies.activeIsolationPolicy,
      dependencies.activeWorkspaceRepositories,
      version,
    ],
  );

  const overflowRootPaths = useMemo(
    () => overflowSnapshot(version, coordinator),
    [coordinator, version],
  );
  const projectsLoaded = useMemo(
    () => loadedSnapshot(version, coordinator),
    [coordinator, version],
  );

  return useMemo(
    () => ({
      projects,
      projectsLoaded,
      overflowRootPaths,
      refreshProject: coordinator.refreshProject,
      trustProject: coordinator.refreshProject,
      deferOpenedProjectTrust: coordinator.deferOpenedProjectTrust,
      grantProjectTrust: coordinator.grantProjectTrust,
      releaseProject: coordinator.releaseProject,
      closeWorkspaceProject: coordinator.closeWorkspaceProject,
      ensureProjectLease: coordinator.ensureProjectLease,
      ensureProjectLaunchIdentity: coordinator.ensureProjectLaunchIdentity,
      launchIdentityForProject: coordinator.launchIdentityForProject,
      isCurrentRepositoryOwner: coordinator.isCurrentRepositoryOwner,
      noteDispatchTrustRejected: coordinator.noteDispatchTrustRejected,
    }),
    [coordinator, overflowRootPaths, projects, projectsLoaded],
  );
}

function loadedSnapshot(_revision: number, coordinator: AgentProjectsCoordinator): boolean {
  return coordinator.projectsLoaded();
}

function overflowSnapshot(
  _revision: number,
  coordinator: AgentProjectsCoordinator,
): ReadonlyArray<string> {
  return coordinator.overflowRootPaths();
}

function projectDescriptors(
  _revision: number,
  coordinator: AgentProjectsCoordinator,
  activeRootKey: string | null,
  activeRepositories: ReadonlyArray<ResolvedGitRepository>,
  activeIsolationPolicy: AgentIsolationPolicy,
): ReadonlyArray<AgentProjectDescriptor> {
  return coordinator.projects(activeRootKey, activeRepositories, activeIsolationPolicy);
}
