import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";
import { agentRailOwnedViews } from "./agentRailProjectLayout";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

export interface AgentHistoryCatalogProject {
  readonly rootKey: string;
  readonly label: string;
}

export interface AgentHistoryCatalogRailEntry {
  readonly projectRootKey: string;
  readonly memberProjectRootKeys?: ReadonlyArray<string>;
}

export interface AgentHistoryCatalogRail {
  readonly focus: AgentRailProjectFocus;
  readonly visibleEntries: ReadonlyArray<AgentHistoryCatalogRailEntry>;
  readonly currentProjectRootKey: string | null;
}

export type AgentHistoryCatalogScope =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      readonly projects: ReadonlyArray<AgentHistoryCatalogProject>;
      readonly defaultRootKey: string;
    };

const UNAVAILABLE: AgentHistoryCatalogScope = Object.freeze({ kind: "unavailable" });

export function agentHistoryCatalogScope(
  catalogProjects: ReadonlyArray<AgentHistoryCatalogProject>,
  rail: AgentHistoryCatalogRail,
): AgentHistoryCatalogScope {
  const projects = scopedProjects(catalogProjects, rail);
  const first = projects[0];
  if (first === undefined) return UNAVAILABLE;
  const preferred = currentProject(projects, rail) ?? first;
  return { kind: "available", projects, defaultRootKey: preferred.rootKey };
}

export function agentHistoryCatalogScopeIncludes(
  scope: AgentHistoryCatalogScope,
  rootKey: string | null,
): boolean {
  if (rootKey === null || scope.kind === "unavailable") return false;
  return scope.projects.some((project) => project.rootKey === rootKey);
}

export function agentHistoryCatalogRailThreadIds(
  views: ReadonlyArray<AgentThreadView>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  rootKey: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (rootKey === null) return ids;
  for (const view of agentRailOwnedViews(views, entries)) {
    if (view.thread.archived || view.thread.owner.rootKey !== rootKey) continue;
    ids.add(view.thread.threadId);
  }
  return ids;
}

function scopedProjects(
  catalogProjects: ReadonlyArray<AgentHistoryCatalogProject>,
  rail: AgentHistoryCatalogRail,
): ReadonlyArray<AgentHistoryCatalogProject> {
  if (rail.focus === "all" || rail.currentProjectRootKey === null) return catalogProjects;
  const visible = new Set(rail.visibleEntries.flatMap(entryRootKeys));
  return catalogProjects.filter((project) => visible.has(project.rootKey));
}

function currentProject(
  projects: ReadonlyArray<AgentHistoryCatalogProject>,
  rail: AgentHistoryCatalogRail,
): AgentHistoryCatalogProject | undefined {
  const current = rail.currentProjectRootKey;
  if (current === null) return undefined;
  const exact = projects.find((project) => project.rootKey === current);
  if (exact !== undefined) return exact;
  const members = new Set(
    rail.visibleEntries
      .filter((entry) => entryRootKeys(entry).includes(current))
      .flatMap(entryRootKeys),
  );
  return projects.find((project) => members.has(project.rootKey));
}

function entryRootKeys(entry: AgentHistoryCatalogRailEntry): ReadonlyArray<string> {
  return [entry.projectRootKey, ...(entry.memberProjectRootKeys ?? [])];
}
