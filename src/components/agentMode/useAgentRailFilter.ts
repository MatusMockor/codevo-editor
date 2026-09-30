import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRailFilterPreferencePort } from "../../application/agentRailFilterPreferencePort";
import { remoteAgentProjectServerId } from "../../application/remoteAgentProjection";
import {
  ALL_PROJECTS_FILTER,
  reconcileAgentRailFilter,
  type AgentRailFilter,
} from "./agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

export interface AgentRailFilterOptions {
  readonly preference: AgentRailFilterPreferencePort | null;
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly projectsLoaded: boolean;
  readonly authoritativeRemoteProjectKeys: ReadonlySet<string>;
}

export interface AgentRailFilterState {
  readonly filter: AgentRailFilter;
  setFilter(filter: AgentRailFilter): void;
}

export function useAgentRailFilter({
  authoritativeRemoteProjectKeys,
  entries,
  preference,
  projectsLoaded,
}: AgentRailFilterOptions): AgentRailFilterState {
  const [stored, setStored] = useState<AgentRailFilter>(
    () => preference?.load() ?? ALL_PROJECTS_FILTER,
  );
  const filter = reconcileAgentRailFilter(stored, entries);
  const vanished =
    filter !== stored &&
    stored.kind === "project" &&
    projectListLoaded(stored.projectRootKey, projectsLoaded, authoritativeRemoteProjectKeys);
  if (vanished) setStored(ALL_PROJECTS_FILTER);

  const persisted = useRef(stored);
  useEffect(() => {
    if (persisted.current === stored) return;
    persisted.current = stored;
    preference?.save(stored);
  }, [preference, stored]);

  return useMemo(() => ({ filter, setFilter: setStored }), [filter]);
}

function projectListLoaded(
  projectRootKey: string,
  projectsLoaded: boolean,
  authoritativeRemoteProjectKeys: ReadonlySet<string>,
): boolean {
  if (!projectsLoaded) return false;
  const serverId = remoteAgentProjectServerId(projectRootKey);
  if (serverId === null) return true;
  for (const key of authoritativeRemoteProjectKeys) {
    if (remoteAgentProjectServerId(key) === serverId) return true;
  }
  return false;
}
