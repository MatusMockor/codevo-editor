import {
  projectDisplayNameOfflineRootKeys,
  projectDisplayNameRootKeys,
  resolveProjectDisplayName,
  sameProjectDisplayName,
  type ProjectDisplayNameEntries,
  type ProjectDisplayNameMembers,
} from "../../domain/projectDisplayName";
import type { AgentProjectGroup } from "./agentModePresentation";

const NO_DISPLAY_LABELS: ReadonlyMap<string, string> = new Map();
const NO_ENTRIES: ProjectDisplayNameEntries = new Map();

export interface AgentProjectRenameTarget {
  readonly requestedRootKey: string;
  readonly projectRootKey: string;
  readonly memberRootKeys: ReadonlyArray<string>;
  readonly offlineRootKeys: ReadonlyArray<string>;
  readonly displayedElsewhereRootKeys: ReadonlyArray<string>;
  readonly defaultLabel: string;
  readonly displayName: string | null;
  readonly otherProjectLabels: ReadonlyArray<string>;
}

export interface AgentLabelledProject {
  readonly rootKey: string;
  readonly label: string;
}

export function agentProjectGroupDisplayName(
  group: AgentProjectGroup,
  names: ReadonlyMap<string, string>,
): string | null {
  if (group.kind !== "project") return null;
  return resolveProjectDisplayName(names, groupMembers(group));
}

export function agentProjectDisplayLabels(
  groups: ReadonlyArray<AgentProjectGroup>,
  names: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (names.size === 0) return NO_DISPLAY_LABELS;
  const labels = new Map<string, string>();
  for (const group of groups) {
    const displayName = agentProjectGroupDisplayName(group, names);
    if (displayName === null) continue;
    for (const rootKey of groupMemberRootKeys(group)) labels.set(rootKey, displayName);
  }
  if (labels.size === 0) return NO_DISPLAY_LABELS;
  return labels;
}

export function agentProjectGroupsWithDisplayLabels(
  groups: ReadonlyArray<AgentProjectGroup>,
  labels: ReadonlyMap<string, string>,
): ReadonlyArray<AgentProjectGroup> {
  if (labels.size === 0) return groups;
  const named = groups.map((group) => groupWithDisplayLabel(group, labels));
  if (named.every((group, index) => group === groups[index])) return groups;
  return named;
}

export function agentProjectGroupsWithDisplayNames(
  groups: ReadonlyArray<AgentProjectGroup>,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<AgentProjectGroup> {
  return agentProjectGroupsWithDisplayLabels(groups, agentProjectDisplayLabels(groups, names));
}

export function agentProjectsWithDisplayLabels<TProject extends AgentLabelledProject>(
  projects: ReadonlyArray<TProject>,
  labels: ReadonlyMap<string, string>,
): ReadonlyArray<TProject> {
  if (labels.size === 0) return projects;
  const named = projects.map((project) => projectWithDisplayLabel(project, labels));
  if (named.every((project, index) => project === projects[index])) return projects;
  return named;
}

export function agentProjectRenameTarget(
  groups: ReadonlyArray<AgentProjectGroup>,
  names: ReadonlyMap<string, string>,
  requestedRootKey: string,
  entries: ProjectDisplayNameEntries = NO_ENTRIES,
): AgentProjectRenameTarget | null {
  const projectGroups = groups.filter((candidate) => candidate.kind === "project");
  const group = projectGroups.find((candidate) =>
    groupMemberRootKeys(candidate).includes(requestedRootKey),
  );
  if (group === undefined) return null;
  const others = projectGroups.filter((candidate) => candidate !== group);
  const memberRootKeys = projectDisplayNameRootKeys(groupMembers(group));
  const displayedElsewhereRootKeys = others.flatMap(groupMemberRootKeys);
  return {
    requestedRootKey,
    projectRootKey: group.projectRootKey,
    memberRootKeys,
    offlineRootKeys: projectDisplayNameOfflineRootKeys(
      entries,
      memberRootKeys,
      new Set(displayedElsewhereRootKeys),
    ),
    displayedElsewhereRootKeys,
    defaultLabel: group.label,
    displayName: agentProjectGroupDisplayName(group, names),
    otherProjectLabels: others.map(
      (candidate) => agentProjectGroupDisplayName(candidate, names) ?? candidate.label,
    ),
  };
}

export function agentProjectRenameConflict(
  target: AgentProjectRenameTarget,
  name: string,
): string | null {
  return target.otherProjectLabels.find((label) => sameProjectDisplayName(label, name)) ?? null;
}

function groupWithDisplayLabel(
  group: AgentProjectGroup,
  labels: ReadonlyMap<string, string>,
): AgentProjectGroup {
  if (group.kind !== "project") return group;
  const displayName = labels.get(group.projectRootKey);
  if (displayName === undefined || displayName === group.label) return group;
  return { ...group, label: displayName, defaultLabel: group.label };
}

function projectWithDisplayLabel<TProject extends AgentLabelledProject>(
  project: TProject,
  labels: ReadonlyMap<string, string>,
): TProject {
  const displayName = labels.get(project.rootKey);
  if (displayName === undefined || displayName === project.label) return project;
  return { ...project, label: displayName };
}

function groupMemberRootKeys(group: AgentProjectGroup): ReadonlyArray<string> {
  return [...new Set([group.projectRootKey, ...(group.memberProjectRootKeys ?? [])])];
}

function groupMembers(group: AgentProjectGroup): ProjectDisplayNameMembers {
  return {
    representativeRootKey: group.projectRootKey,
    memberRootKeys: group.memberProjectRootKeys ?? [group.projectRootKey],
  };
}
