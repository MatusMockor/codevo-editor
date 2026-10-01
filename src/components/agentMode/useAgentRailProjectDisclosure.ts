import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRailProjectCollapsePreferencePort } from "../../application/agentRailProjectCollapsePreferencePort";
import {
  NO_COLLAPSED_PROJECTS,
  collapseAgentRailProject,
  expandAgentRailProject,
  type AgentRailCollapsedProjects,
} from "../../domain/agentRailProjectCollapse";
import type { AgentRailProjectDisclosureState } from "./agentRailProjectLayout";

export interface AgentRailProjectDisclosure {
  readonly state: AgentRailProjectDisclosureState;
  toggleCollapsed(projectRootKey: string): void;
  toggleShowingAll(projectRootKey: string): void;
  expand(projectRootKey: string): void;
}

const NONE_SHOWING_ALL: ReadonlySet<string> = new Set();

export function useAgentRailProjectDisclosure(
  preference: AgentRailProjectCollapsePreferencePort | null,
): AgentRailProjectDisclosure {
  const [collapsed, setCollapsed] = useState<AgentRailCollapsedProjects>(
    () => preference?.load() ?? NO_COLLAPSED_PROJECTS,
  );
  const [showingAll, setShowingAll] = useState<ReadonlySet<string>>(NONE_SHOWING_ALL);

  const persisted = useRef(collapsed);
  useEffect(() => {
    if (persisted.current === collapsed) return;
    persisted.current = collapsed;
    preference?.save(collapsed);
  }, [collapsed, preference]);

  const toggleCollapsed = useCallback((projectRootKey: string) => {
    setCollapsed((current) =>
      current.includes(projectRootKey)
        ? expandAgentRailProject(current, projectRootKey)
        : collapseAgentRailProject(current, projectRootKey),
    );
  }, []);
  const expand = useCallback((projectRootKey: string) => {
    setCollapsed((current) => expandAgentRailProject(current, projectRootKey));
  }, []);
  const toggleShowingAll = useCallback((projectRootKey: string) => {
    setShowingAll((current) => toggledKey(current, projectRootKey));
  }, []);

  const state = useMemo<AgentRailProjectDisclosureState>(
    () => ({ collapsed: new Set(collapsed), showingAll }),
    [collapsed, showingAll],
  );
  return useMemo(
    () => ({ state, toggleCollapsed, toggleShowingAll, expand }),
    [expand, state, toggleCollapsed, toggleShowingAll],
  );
}

function toggledKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (next.delete(key)) return next;
  next.add(key);
  return next;
}
