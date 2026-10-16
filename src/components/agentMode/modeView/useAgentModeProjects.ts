import { useCallback, useMemo } from "react";
import type { AgentRailProjectCollapsePreferencePort } from "../../../application/agentRailProjectCollapsePreferencePort";
import type { AgentRailProjectFocusPreferencePort } from "../../../application/agentRailProjectFocusPreferencePort";
import type { AgentRailWorkingSectionPreferencePort } from "../../../application/agentRailWorkingSectionPreferencePort";
import { agentTurnLogEvidence } from "../../../application/agentTurnLogStatusStore";
import { useAgentProjectGrouping } from "../../../application/useAgentProjectGrouping";
import { useAgentProjectIdentities } from "../../../application/useAgentProjectIdentities";
import { useAgentThreadBranchMemory } from "../../../application/useAgentThreadBranchMemory";
import { useRemoteProjectLinks } from "../../../application/useRemoteProjectLinks";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentTurnLogEvidenceLookup } from "../../../domain/agentTurnContentLoss";
import { useAgentWorkbenchPorts } from "../../agentWorkbenchPortsContext";
import { groupedEnvironmentProjects } from "../agentEnvironmentProjects";
import { agentProjectGroups } from "../agentModePresentation";
import { agentRailScopeEntries } from "../agentSidebarPresentation";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentProjectRename } from "../useAgentProjectRename";
import { useAgentRailProjectDisclosure } from "../useAgentRailProjectDisclosure";
import { useAgentRailProjectFocus } from "../useAgentRailProjectFocus";
import { useAgentRailWorkingRail } from "../useAgentRailWorkingRail";
import { useAgentThreadPresentationViews } from "../useAgentThreadPresentationViews";
import type { AgentModeAgents } from "./agentModeViewProps";

export interface AgentModeProjectsOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectCollapsePreference: AgentRailProjectCollapsePreferencePort | null;
  readonly projectFocusPreference: AgentRailProjectFocusPreferencePort | null;
  readonly workingSectionPreference: AgentRailWorkingSectionPreferencePort | null;
}

export function useAgentModeProjects({
  agents,
  chrome,
  projects,
  projectCollapsePreference,
  projectFocusPreference,
  workingSectionPreference,
}: AgentModeProjectsOptions) {
  const presentationThreads = useAgentThreadPresentationViews(agents.threads);
  const projectLinks = useRemoteProjectLinks();
  const projectGrouping = useAgentProjectGrouping();
  const executionGroups = useMemo(
    () => agentProjectGroups(projects, presentationThreads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, presentationThreads],
  );

  const ports = useAgentWorkbenchPorts();
  const repositoryIdentities = useAgentProjectIdentities(
    projects,
    projectLinks,
    ports.projectIdentity,
    ports.remoteRepositoryIdentity,
  );
  const environmentGroups = useMemo(
    () =>
      groupedEnvironmentProjects(
        executionGroups,
        projects,
        projectLinks,
        repositoryIdentities,
        projectGrouping,
      ),
    [executionGroups, projects, projectLinks, repositoryIdentities, projectGrouping],
  );
  const projectRename = useAgentProjectRename({
    groups: environmentGroups,
    executionGroups,
    projects,
    catalog: agents.catalog,
  });
  const groups = projectRename.groups;
  const displayProjects = projectRename.projects;
  const turnEvidenceOf = useCallback<AgentTurnLogEvidenceLookup>(
    (turnId) => agentTurnLogEvidence(agents.turnLog?.factsOf(turnId) ?? null),
    [agents.turnLog],
  );
  const railScopeEntries = useMemo(() => agentRailScopeEntries(groups), [groups]);
  const projectDisclosure = useAgentRailProjectDisclosure(projectCollapsePreference);
  const projectFocus = useAgentRailProjectFocus(projectFocusPreference);
  const workingRail = useAgentRailWorkingRail(workingSectionPreference);
  const threadBranchMemory = useAgentThreadBranchMemory(chrome.threadBranchMemory ?? null);
  return {
    presentationThreads,
    projectLinks,
    executionGroups,
    repositoryIdentities,
    projectRename,
    groups,
    displayProjects,
    turnEvidenceOf,
    railScopeEntries,
    projectDisclosure,
    projectFocus,
    workingRail,
    threadBranchMemory,
  };
}

export type AgentModeProjects = ReturnType<typeof useAgentModeProjects>;
