import type { AgentThreadView } from "../../application/agentThreadPorts";
import { ALL_PROJECTS_FILTER, type AgentRailFilter } from "../../domain/agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

export { ALL_PROJECTS_FILTER, type AgentRailFilter };

export const ALL_PROJECTS_LABEL = "All projects";

export function agentRailFilterKey(filter: AgentRailFilter): string {
  return filter.kind === "all" ? "all" : `project:${filter.projectRootKey}`;
}

export function agentThreadsInFilter(
  views: ReadonlyArray<AgentThreadView>,
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlyArray<AgentThreadView> {
  return views.filter((view) => {
    const owner = owningEntry(entries, view.thread.owner.rootKey);
    if (owner === null) return false;
    return filter.kind === "all" || owner.projectRootKey === filter.projectRootKey;
  });
}

export function reconcileAgentRailFilter(
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailFilter {
  if (filter.kind === "all") return filter;
  if (entries.some((entry) => entry.projectRootKey === filter.projectRootKey)) return filter;
  return ALL_PROJECTS_FILTER;
}

export function agentRailFilterLabel(
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): string {
  if (filter.kind === "all") return ALL_PROJECTS_LABEL;
  return (
    entries.find((entry) => entry.projectRootKey === filter.projectRootKey)?.label ??
    ALL_PROJECTS_LABEL
  );
}

export function agentProjectMonogram(label: string): string {
  const first = [...label].find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

function owningEntry(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  rootKey: string,
): AgentRailScopeEntry | null {
  return (
    entries.find(
      (entry) =>
        entry.projectRootKey === rootKey || entry.memberProjectRootKeys?.includes(rootKey) === true,
    ) ?? null
  );
}
