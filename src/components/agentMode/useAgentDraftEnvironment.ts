import { useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { ComposerScope } from "./agentComposerTarget";
import { environmentComposerScope, projectRunsOn } from "./agentEnvironmentProjects";
import type { AgentProjectGroup } from "./agentModePresentation";

export interface AgentDraftEnvironmentOptions {
  readonly scope: ComposerScope | null;
  readonly selectedThread: AgentThreadView | null;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly displayProjects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedServerId: string | null;
  readonly repositoryIdentities: ReadonlyMap<string, string>;
  readonly projectLinks: ReadonlyMap<string, string>;
}

export interface AgentDraftEnvironment {
  readonly scope: ComposerScope | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly rootKey: string | null;
}

export function useAgentDraftEnvironment({
  scope,
  selectedThread,
  groups,
  projects,
  displayProjects,
  selectedServerId,
  repositoryIdentities,
  projectLinks,
}: AgentDraftEnvironmentOptions): AgentDraftEnvironment {
  const drafting = selectedThread === null;
  const draftScope = useMemo(
    () =>
      environmentComposerScope(
        scope,
        groups,
        projects,
        selectedServerId,
        repositoryIdentities,
        projectLinks,
      ),
    [scope, groups, projects, selectedServerId, repositoryIdentities, projectLinks],
  );
  const draftProjects = useMemo(() => {
    if (!drafting) return displayProjects;
    return displayProjects.filter((project) => projectRunsOn(project.rootKey, selectedServerId));
  }, [drafting, displayProjects, selectedServerId]);
  return {
    scope: drafting ? draftScope : scope,
    projects: draftProjects,
    rootKey: draftRootKey(draftScope),
  };
}

function draftRootKey(scope: ComposerScope | null): string | null {
  if (scope === null || scope.kind === "missing") return null;
  return scope.projectRootKey;
}
